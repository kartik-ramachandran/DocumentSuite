using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using UglyToad.PdfPig;
using UglyToad.PdfPig.Content;
using UglyToad.PdfPig.Core;
using UglyToad.PdfPig.DocumentLayoutAnalysis.WordExtractor;

namespace PdfAI.API.Services;

/// <summary>Reads each page's real text and images, using OCR for pages that have no text layer.</summary>
public partial class PdfLayoutService
{
    private const int OcrDpi = 300;
    private const int CropDpi = 150;
    private const int MinNativeLetters = 20;
    private const int MinScanWords = 15;
    private const int MinCurvesForChart = 20;
    private const double MinImageSide = 4;
    private static readonly TimeSpan OcrPageTimeout = TimeSpan.FromMinutes(2);

    private readonly PdfToolRunner _tools;
    private readonly ILogger<PdfLayoutService> _logger;

    public PdfLayoutService(PdfToolRunner tools, ILogger<PdfLayoutService> logger)
    {
        _tools = tools;
        _logger = logger;
    }

    /// <param name="includeImages">Also extract pictures and chart regions for the Office conversions.</param>
    /// <param name="requireOcr">Fail when a page needs OCR and it can't run. Otherwise that page keeps only its image.</param>
    public async Task<IReadOnlyList<LayoutPage>> ExtractAsync(byte[] pdfBytes, bool includeImages, bool requireOcr, CancellationToken cancellationToken = default)
    {
        var tempDirectory = Directory.CreateTempSubdirectory("pdfsuite-layout-");
        try
        {
            var pdfPath = Path.Combine(tempDirectory.FullName, "input.pdf");
            await File.WriteAllBytesAsync(pdfPath, pdfBytes, cancellationToken);

            var scans = ReadPages(pdfBytes, includeImages, cancellationToken);

            // Rendering and OCR are the slow steps, so they run in parallel, each with its own output files.
            var options = new ParallelOptions
            {
                MaxDegreeOfParallelism = Math.Clamp(Environment.ProcessorCount / 2, 1, 8),
                CancellationToken = cancellationToken
            };
            await Parallel.ForEachAsync(scans, options, async (scan, token) =>
            {
                foreach (var crop in scan.Crops)
                    scan.Images.Add(await RenderCropAsync(pdfPath, scan.Number, crop, token));
                if (scan.NeedsOcr && await RunOcrAsync(pdfPath, scan, requireOcr, token) is { } ocrWords && ocrWords.Count >= scan.Words.Count)
                {
                    scan.Words = ocrWords;
                    scan.WasOcr = true;
                }
            });

            return scans.Select(BuildPage).ToList();
        }
        finally
        {
            tempDirectory.Delete(true);
        }
    }

    /// <summary>Returns all the document's text in reading order, with no length limit.</summary>
    public async Task<string> ExtractTextAsync(byte[] pdfBytes, CancellationToken cancellationToken = default)
    {
        var pages = await ExtractAsync(pdfBytes, includeImages: false, requireOcr: true, cancellationToken);
        var text = new StringBuilder();

        foreach (var page in pages)
        {
            text.Append("Page ").Append(page.Number).AppendLine(page.WasOcr ? " (OCR)" : string.Empty);
            foreach (var block in page.Blocks)
            {
                switch (block)
                {
                    case ParagraphBlock paragraph:
                        foreach (var line in paragraph.Lines)
                            text.AppendLine(line.Text);
                        break;
                    case TableBlock table:
                        foreach (var row in table.Rows)
                            text.AppendLine(string.Join('\t', row.Select(cell => cell.Text)));
                        break;
                }
            }

            text.AppendLine();
        }

        return text.ToString();
    }

    public List<int> FindPagesNeedingOcr(byte[] pdfBytes)
    {
        using var document = PdfDocument.Open(pdfBytes);
        return document.GetPages()
            .Where(page => NeedsOcr(page, page.Letters.Count(letter => !string.IsNullOrWhiteSpace(letter.Value))))
            .Select(page => page.Number)
            .ToList();
    }

    // A page with no pictures or drawings has nothing OCR could read.
    private static bool NeedsOcr(Page page, int letterCount) =>
        letterCount < MinNativeLetters && (page.NumberOfImages > 0 || page.Paths.Count > 0);

    private List<PageScan> ReadPages(byte[] pdfBytes, bool includeImages, CancellationToken cancellationToken)
    {
        var scans = new List<PageScan>();
        using var document = PdfDocument.Open(pdfBytes);

        foreach (var page in document.GetPages())
        {
            cancellationToken.ThrowIfCancellationRequested();

            var letters = page.Letters.Where(letter => !string.IsNullOrWhiteSpace(letter.Value)).ToList();
            var invisible = letters.Count(letter => letter.RenderingMode is TextRenderingMode.Neither or TextRenderingMode.NeitherClip);
            var frame = TextFrame.Detect(letters, page.Width, page.Height);
            var scan = new PageScan(page.Number, frame.Width, frame.Height)
            {
                IsRotated = frame.IsRotated,
                NeedsOcr = NeedsOcr(page, letters.Count),
                // A hidden text layer sits over a scan, so the picture would duplicate the text.
                HasHiddenTextLayer = letters.Count >= MinNativeLetters && invisible > letters.Count / 2,
                Words = ReadWords(letters, frame)
            };

            if (includeImages || scan.NeedsOcr)
                ReadImages(page, scan, frame);
            if (includeImages && !frame.IsRotated)
                FindChartRegion(page, scan);

            scans.Add(scan);
        }

        return scans;
    }

    private static List<LayoutWord> ReadWords(List<Letter> letters, TextFrame frame)
    {
        var words = new List<LayoutWord>();

        var mainText = letters.Where(frame.Contains).ToList();
        foreach (var word in NearestNeighbourWordExtractor.Instance.GetWords(mainText))
        {
            if (!string.IsNullOrWhiteSpace(word.Text))
                words.Add(ToLayoutWord(word, frame));
        }

        // Text at another angle (watermarks, sideways labels) can't join a line, so it's kept as a final line.
        var otherText = letters.Where(letter => !frame.Contains(letter)).ToList();
        if (otherText.Count > 0)
        {
            var bottom = words.Count > 0 ? words.Max(word => word.Baseline) : 0;
            var size = Math.Max(otherText[0].PointSize, 8);
            var text = string.Concat(otherText.Select(letter => letter.Value));
            words.Add(new LayoutWord(text, 36, 36 + text.Length * size * 0.5, bottom + size * 2, size, FontName: CleanFontName(otherText[0].FontName), IsPositioned: false));
        }

        return words;
    }

    private static LayoutWord ToLayoutWord(Word word, TextFrame frame)
    {
        var first = word.Letters[0];
        var last = word.Letters[word.Letters.Count - 1];
        var (startX, baseline) = frame.Map(first.StartBaseLine.X, first.StartBaseLine.Y);
        var (endX, _) = frame.Map(last.EndBaseLine.X, last.EndBaseLine.Y);
        var size = first.PointSize > 0 ? first.PointSize : 10;
        var fontName = first.FontName ?? string.Empty;

        return new LayoutWord(
            word.Text,
            Math.Min(startX, endX),
            Math.Max(startX, endX),
            baseline,
            Math.Round(size * 2) / 2,
            BoldFontName().IsMatch(fontName),
            ItalicFontName().IsMatch(fontName),
            CleanFontName(fontName),
            ToHex(first));
    }

    private static string? ToHex(Letter letter)
    {
        if (letter.Color is null)
            return null;
        var (r, g, b) = letter.Color.ToRGBValues();
        var hex = $"{ToByte(r):X2}{ToByte(g):X2}{ToByte(b):X2}";
        return hex == "000000" ? null : hex;

        static int ToByte(double value) => (int)Math.Clamp(Math.Round(value * 255), 0, 255);
    }

    private static string? CleanFontName(string? fontName)
    {
        if (string.IsNullOrWhiteSpace(fontName))
            return null;
        var name = fontName.Contains('+') ? fontName[(fontName.IndexOf('+') + 1)..] : fontName;
        name = name.Split('-', ',')[0];
        name = FontNameSuffix().Replace(name, string.Empty);
        name = FontNameWordBreak().Replace(name, " ");
        return string.IsNullOrWhiteSpace(name) ? null : name;
    }

    private void ReadImages(Page page, PageScan scan, TextFrame frame)
    {
        IEnumerable<IPdfImage> images;
        try
        {
            images = page.GetImages().ToList();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not read images on page {Page}", page.Number);
            return;
        }

        foreach (var image in images)
        {
            var bounds = image.BoundingBox;
            var corners = new[] { bounds.TopLeft, bounds.TopRight, bounds.BottomLeft, bounds.BottomRight }.Select(corner => frame.Map(corner.X, corner.Y)).ToList();
            var left = corners.Min(corner => corner.X);
            var top = corners.Min(corner => corner.Baseline);
            var width = corners.Max(corner => corner.X) - left;
            var height = corners.Max(corner => corner.Baseline) - top;
            if (image.IsImageMask || width < MinImageSide || height < MinImageSide)
                continue;

            scan.ImageArea += width * height;
            var raw = image.RawMemory.Span;
            if (raw.Length > 2 && raw[0] == 0xFF && raw[1] == 0xD8)
                scan.Images.Add(new LayoutImage(raw.ToArray(), true, left, top, width, height));
            else if (image.TryGetPng(out var png))
                scan.Images.Add(new LayoutImage(png, false, left, top, width, height));
            else if (!frame.IsRotated)
                scan.Crops.Add((left, top, width, height));
        }
    }

    // Charts drawn with vector curves have no text or image data to copy, so that region is kept as a picture.
    private static void FindChartRegion(Page page, PageScan scan)
    {
        var curved = new List<PdfRectangle>();
        foreach (var path in page.Paths)
        {
            foreach (var subpath in path)
            {
                if (subpath.Commands.Any(command => command is PdfSubpath.BezierCurve) && subpath.GetBoundingRectangle() is { } box)
                    curved.Add(box);
            }
        }

        if (curved.Count < MinCurvesForChart)
            return;

        var left = Math.Max(curved.Min(box => box.Left), 0);
        var right = Math.Min(curved.Max(box => box.Right), page.Width);
        var top = Math.Max(page.Height - curved.Max(box => box.Top), 0);
        var bottom = Math.Min(page.Height - curved.Min(box => box.Bottom), page.Height);
        if (right - left >= MinImageSide && bottom - top >= MinImageSide)
            scan.Crops.Add((left, top, right - left, bottom - top));
    }

    private async Task<LayoutImage> RenderCropAsync(string pdfPath, int pageNumber, (double Left, double Top, double Width, double Height) crop, CancellationToken cancellationToken)
    {
        var bytes = await _tools.RenderPageAsync(pdfPath, pageNumber, "jpg", CropDpi, crop, cancellationToken);
        return new LayoutImage(bytes, true, crop.Left, crop.Top, crop.Width, crop.Height);
    }

    private async Task<List<LayoutWord>?> RunOcrAsync(string pdfPath, PageScan scan, bool requireOcr, CancellationToken cancellationToken)
    {
        var tempDirectory = Directory.CreateTempSubdirectory("pdfsuite-ocr-");
        try
        {
            var imagePath = Path.Combine(tempDirectory.FullName, "page.png");
            var outputBase = Path.Combine(tempDirectory.FullName, "page");
            var pageImage = await _tools.RenderPageAsync(pdfPath, scan.Number, "png", OcrDpi, cancellationToken: cancellationToken);
            await File.WriteAllBytesAsync(imagePath, pageImage, cancellationToken);

            await _tools.RunCheckedAsync(
                _tools.TesseractPath,
                [imagePath, outputBase, "--dpi", OcrDpi.ToString(CultureInfo.InvariantCulture), "-l", "eng", "tsv"],
                OcrPageTimeout,
                new Dictionary<string, string> { ["OMP_THREAD_LIMIT"] = "1" },
                cancellationToken);

            return ParseTesseractTsv(await File.ReadAllTextAsync($"{outputBase}.tsv", cancellationToken), OcrDpi);
        }
        catch (ToolNotAvailableException ex) when (!requireOcr)
        {
            _logger.LogWarning(ex, "OCR is unavailable, so page {Page} keeps its image without editable text", scan.Number);
            return null;
        }
        catch (ToolNotAvailableException ex)
        {
            throw new InvalidOperationException($"Page {scan.Number} is scanned and needs OCR, but Tesseract is not installed on this server.", ex);
        }
        finally
        {
            tempDirectory.Delete(true);
        }
    }

    /// <summary>Converts Tesseract's TSV output to words, in points, ignoring low-confidence noise.</summary>
    public static List<LayoutWord> ParseTesseractTsv(string tsv, int dpi)
    {
        const int minConfidence = 30;
        const int wordLevel = 5;
        var scale = 72d / dpi;
        var raw = new List<(string Key, string Text, double Left, double Right, double Bottom, double Height)>();

        foreach (var row in tsv.Split('\n').Skip(1))
        {
            var fields = row.TrimEnd('\r').Split('\t');
            if (fields.Length < 12
                || fields[0] != wordLevel.ToString(CultureInfo.InvariantCulture)
                || string.IsNullOrWhiteSpace(fields[11])
                || !double.TryParse(fields[10], CultureInfo.InvariantCulture, out var confidence)
                || confidence < minConfidence)
            {
                continue;
            }

            var left = double.Parse(fields[6], CultureInfo.InvariantCulture) * scale;
            var top = double.Parse(fields[7], CultureInfo.InvariantCulture) * scale;
            var width = double.Parse(fields[8], CultureInfo.InvariantCulture) * scale;
            var height = double.Parse(fields[9], CultureInfo.InvariantCulture) * scale;
            raw.Add(($"{fields[2]}.{fields[3]}.{fields[4]}", fields[11], left, left + width, top + height, height));
        }

        if (raw.Count == 0)
            return [];

        // A word's box height varies with its letters, so sizes and baselines are taken per line,
        // then snapped to the page's typical size so body text forms paragraphs.
        var lineSizes = raw.GroupBy(word => word.Key).ToDictionary(group => group.Key, group => group.Max(word => word.Height) * 1.15);
        var pageSize = LayoutMath.Median(lineSizes.Values);
        var lineBaselines = raw.GroupBy(word => word.Key).ToDictionary(group => group.Key, group => LayoutMath.Median(group.Select(word => word.Bottom)));

        return raw.Select(word =>
        {
            var size = lineSizes[word.Key] <= pageSize * 1.4 ? pageSize : lineSizes[word.Key];
            return new LayoutWord(word.Text, word.Left, word.Right, lineBaselines[word.Key], Math.Round(size * 2) / 2);
        }).ToList();
    }

    private static LayoutPage BuildPage(PageScan scan)
    {
        var isScan = scan.HasHiddenTextLayer || (scan.WasOcr && scan.Words.Count >= MinScanWords);
        var coversPage = scan.ImageArea >= scan.Width * scan.Height * 0.6;
        var images = isScan && coversPage ? [] : scan.Images;
        return new LayoutPage(scan.Number, scan.Width, scan.Height, PdfLayoutAnalyzer.BuildBlocks(scan.Words, images, scan.Width), scan.WasOcr, scan.IsRotated);
    }

    [GeneratedRegex("bold|black|heavy|demi|semibold", RegexOptions.IgnoreCase)]
    private static partial Regex BoldFontName();

    [GeneratedRegex("italic|oblique", RegexOptions.IgnoreCase)]
    private static partial Regex ItalicFontName();

    [GeneratedRegex("(PSMT|PS|MT)$")]
    private static partial Regex FontNameSuffix();

    [GeneratedRegex("(?<=[a-z])(?=[A-Z])")]
    private static partial Regex FontNameWordBreak();

    /// <summary>
    /// Maps page coordinates so the page's main text runs left to right from a top-left origin.
    /// A sideways page therefore converts to an upright document, with its width and height swapped.
    /// </summary>
    private readonly record struct TextFrame(int DirectionX, int DirectionY, double PageWidth, double PageHeight)
    {
        public bool IsRotated => DirectionX != 1;
        public double Width => DirectionY == 0 ? PageWidth : PageHeight;
        public double Height => DirectionY == 0 ? PageHeight : PageWidth;

        public static TextFrame Detect(IReadOnlyList<Letter> letters, double pageWidth, double pageHeight)
        {
            var dominant = letters
                .Select(GetDirection)
                .GroupBy(direction => direction)
                .OrderByDescending(group => group.Count())
                .Select(group => group.Key)
                .FirstOrDefault((X: 1, Y: 0));
            return new TextFrame(dominant.X, dominant.Y, pageWidth, pageHeight);
        }

        public bool Contains(Letter letter) => GetDirection(letter) == (DirectionX, DirectionY);

        public (double X, double Baseline) Map(double x, double y) => (DirectionX, DirectionY) switch
        {
            (0, 1) => (y, x),
            (0, -1) => (PageHeight - y, PageWidth - x),
            (-1, 0) => (PageWidth - x, y),
            _ => (x, PageHeight - y)
        };

        private static (int X, int Y) GetDirection(Letter letter)
        {
            var dx = letter.EndBaseLine.X - letter.StartBaseLine.X;
            var dy = letter.EndBaseLine.Y - letter.StartBaseLine.Y;
            return Math.Abs(dx) >= Math.Abs(dy) ? (dx < 0 ? -1 : 1, 0) : (0, dy < 0 ? -1 : 1);
        }
    }

    private sealed class PageScan(int number, double width, double height)
    {
        public int Number { get; } = number;
        public double Width { get; } = width;
        public double Height { get; } = height;
        public bool NeedsOcr { get; init; }
        public bool IsRotated { get; init; }
        public bool HasHiddenTextLayer { get; init; }
        public bool WasOcr { get; set; }
        public double ImageArea { get; set; }
        public List<LayoutWord> Words { get; set; } = [];
        public List<LayoutImage> Images { get; } = [];
        public List<(double Left, double Top, double Width, double Height)> Crops { get; } = [];
    }
}
