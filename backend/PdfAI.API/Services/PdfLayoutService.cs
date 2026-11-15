using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using UglyToad.PdfPig;
using UglyToad.PdfPig.Content;
using UglyToad.PdfPig.Core;
using UglyToad.PdfPig.DocumentLayoutAnalysis.WordExtractor;
using PdfAI.API.Services.Ocr;

namespace PdfAI.API.Services;

/// <summary>What to read from a document, and how.</summary>
/// <param name="IncludeImages">Also extract pictures and chart regions, for the Office conversions and JSON.</param>
/// <param name="RequireOcr">Fail when a page needs OCR and it can't run. Otherwise that page keeps only its image.</param>
/// <param name="ReadImageText">Also read text inside pictures on pages that have real text.</param>
/// <param name="FindTables">Use the configured layout model to find tables on scanned pages.</param>
public sealed record ExtractOptions(bool IncludeImages, bool RequireOcr, bool ReadImageText, bool FindTables, OcrOverrides? Ocr = null)
{
    /// <summary>Plain text, such as the OCR endpoint and AI review.</summary>
    public static ExtractOptions ForText(OcrOverrides? ocr = null) => new(false, true, true, true, ocr);

    /// <summary>Word, Excel and PowerPoint, which keep pictures as pictures, so the text in them isn't repeated.</summary>
    public static ExtractOptions ForOffice(OcrOverrides? ocr = null) => new(true, false, false, true, ocr);

    /// <summary>Structured JSON, which lists pictures and the text inside them.</summary>
    public static ExtractOptions ForStructure(OcrOverrides? ocr = null) => new(true, false, true, true, ocr);

    /// <summary>Word positions, for redaction, searchable PDFs and the viewer's text selection.</summary>
    public static ExtractOptions ForPositions(bool requireOcr, OcrOverrides? ocr = null) => new(false, requireOcr, true, false, ocr);
}

/// <summary>Reads each page's real text and images, using OCR for pages that have no text layer and for text inside pictures.</summary>
public partial class PdfLayoutService
{
    private const int CropDpi = 150;
    private const int MinNativeLetters = 20;
    private const int MinScanWords = 15;
    private const int MinCurvesForChart = 20;
    private const double MinImageSide = 4;
    private const double MinTextImageWidth = 40;    // points; smaller pictures rarely hold readable text
    private const double MinTextImageHeight = 12;   // points
    private const double MinTextImageArea = 2000;   // square points
    private const int MaxTextImagesPerPage = 12;
    private const double DuplicateOverlap = 0.3;    // share of an OCR word covered by real text that marks it as a repeat

    private readonly PdfToolRunner _tools;
    private readonly OcrService _ocr;
    private readonly ILogger<PdfLayoutService> _logger;

    public PdfLayoutService(PdfToolRunner tools, OcrService ocr, ILogger<PdfLayoutService> logger)
    {
        _tools = tools;
        _ocr = ocr;
        _logger = logger;
    }

    public async Task<IReadOnlyList<LayoutPage>> ExtractAsync(byte[] pdfBytes, ExtractOptions extract, CancellationToken cancellationToken = default)
    {
        var settings = _ocr.Resolve(extract.Ocr);
        var tempDirectory = Directory.CreateTempSubdirectory("pdfsuite-layout-");
        try
        {
            var pdfPath = Path.Combine(tempDirectory.FullName, "input.pdf");
            await File.WriteAllBytesAsync(pdfPath, pdfBytes, cancellationToken);

            var scans = ReadPages(pdfBytes, extract.IncludeImages, extract.ReadImageText && settings.ReadTextInImages, cancellationToken);

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

                if (scan.NeedsOcr)
                {
                    var result = await _ocr.ReadPageAsync(pdfPath, scan.Number, (scan.Width, scan.Height), settings, extract.FindTables, extract.RequireOcr, token);
                    if (result is not null && result.Words.Count >= scan.Words.Count)
                    {
                        scan.Words = result.Words;
                        scan.Tables = result.Tables;
                        scan.Frame = result.Frame;
                        scan.Width = result.Frame.Width;
                        scan.Height = result.Frame.Height;
                        scan.OcrEngine = result.Engine;
                        scan.Warnings.AddRange(result.Warnings);
                        scan.WasOcr = true;
                    }
                }

                foreach (var region in scan.TextImages)
                {
                    var words = await _ocr.ReadRegionAsync(pdfPath, scan.Number, region, settings, token);
                    var added = words.Where(word => !CoveredByRealText(word, scan.Words)).ToList();
                    if (added.Count == 0)
                        continue;
                    scan.ImageWords.AddRange(added);
                    scan.OcrEngine ??= settings.Engine;
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
    public async Task<string> ExtractTextAsync(byte[] pdfBytes, OcrOverrides? ocr = null, CancellationToken cancellationToken = default)
    {
        var pages = await ExtractAsync(pdfBytes, ExtractOptions.ForText(ocr), cancellationToken);
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

    private List<PageScan> ReadPages(byte[] pdfBytes, bool includeImages, bool readImageText, CancellationToken cancellationToken)
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
            if (readImageText && !scan.NeedsOcr && !scan.HasHiddenTextLayer && !frame.IsRotated)
                FindTextImages(page, scan);
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

    // Pictures big enough to hold text, in page points. Their text is read with OCR and kept alongside the real text.
    private void FindTextImages(Page page, PageScan scan)
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

        foreach (var image in images.OrderByDescending(image => image.BoundingBox.Area).Take(MaxTextImagesPerPage))
        {
            var box = image.BoundingBox;
            var left = Math.Max(box.Left, 0);
            var right = Math.Min(box.Right, page.Width);
            var top = Math.Max(page.Height - box.Top, 0);
            var bottom = Math.Min(page.Height - box.Bottom, page.Height);
            var (width, height) = (right - left, bottom - top);
            if (image.IsImageMask || width < MinTextImageWidth || height < MinTextImageHeight || width * height < MinTextImageArea)
                continue;
            scan.TextImages.Add((left, top, width, height));
        }
    }

    // Real text drawn over a picture would otherwise be read twice.
    private static bool CoveredByRealText(LayoutWord word, IReadOnlyList<LayoutWord> realWords)
    {
        var area = (word.Right - word.Left) * (word.Bottom - word.Top);
        if (area <= 0)
            return true;
        foreach (var real in realWords)
        {
            var overlapWidth = Math.Min(word.Right, real.Right) - Math.Max(word.Left, real.Left);
            var overlapHeight = Math.Min(word.Bottom, real.Bottom) - Math.Max(word.Top, real.Top);
            if (overlapWidth > 0 && overlapHeight > 0 && overlapWidth * overlapHeight >= area * DuplicateOverlap)
                return true;
        }

        return false;
    }

    /// <summary>Converts Tesseract's TSV output to words, in points, ignoring low-confidence noise.</summary>
    public static List<LayoutWord> ParseTesseractTsv(string tsv, int dpi) =>
        OcrService.ToLayoutWords(TesseractOcrEngine.ParseTsv(tsv), dpi, minConfidence: 0.3);

    private static LayoutPage BuildPage(PageScan scan)
    {
        var isScan = scan.HasHiddenTextLayer || (scan.WasOcr && scan.Words.Count >= MinScanWords);
        var coversPage = scan.ImageArea >= scan.Width * scan.Height * 0.6;
        var images = isScan && coversPage ? [] : scan.Images;

        var words = scan.Words.Concat(scan.ImageWords).ToList();
        IReadOnlyList<LayoutBlock> tables = [];
        if (scan.Tables.Count > 0)
        {
            var merged = OcrTableMerger.Merge(words, scan.Tables);
            words = merged.RemainingWords;
            tables = merged.Tables;
            scan.Warnings.AddRange(merged.Warnings);
        }

        return new LayoutPage(
            scan.Number,
            scan.Width,
            scan.Height,
            PdfLayoutAnalyzer.BuildBlocks(words, images, scan.Width, tables),
            scan.WasOcr,
            scan.IsRotated,
            scan.Frame,
            scan.OcrEngine,
            scan.Warnings.Count > 0 ? scan.Warnings : null);
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
        public double Width { get; set; } = width;
        public double Height { get; set; } = height;
        public OcrFrame? Frame { get; set; }
        public string? OcrEngine { get; set; }
        public List<string> Warnings { get; } = [];
        public List<OcrTableRegion> Tables { get; set; } = [];
        public List<LayoutWord> ImageWords { get; } = [];
        public List<(double Left, double Top, double Width, double Height)> TextImages { get; } = [];
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
