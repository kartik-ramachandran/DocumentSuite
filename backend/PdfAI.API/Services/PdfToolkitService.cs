using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using PdfSharp.Drawing;
using PdfSharp.Pdf;
using PdfSharp.Pdf.AcroForms;
using PdfSharp.Pdf.IO;
using PdfAI.API.Services.Ocr;
using SkiaSharp;
using PigDocument = UglyToad.PdfPig.PdfDocument;

namespace PdfAI.API.Services;

public sealed record PdfMetadata(
    int Pages,
    string? Title,
    string? Author,
    string? Subject,
    string? Keywords,
    string? Creator,
    string? Producer,
    DateTime? Created,
    DateTime? Modified);

public sealed record PdfFormField(string Name, string Type, string? Value, bool ReadOnly);

public sealed record RedactionResult(byte[] Pdf, int RedactedWords, int RedactedPages);

public sealed record SearchableResult(byte[] Pdf, int OcrPages);

/// <summary>Thrown when redaction finds nothing, so a caller can't mistake an unchanged file for a redacted one.</summary>
public sealed class NoRedactionMatchException()
    : InvalidOperationException("None of the terms were found, so nothing was redacted.");

/// <summary>Page organising, searchable PDFs, redaction, metadata, image extraction, cropping, forms and stamps.</summary>
public class PdfToolkitService
{
    private const int RedactionDpi = 200;
    private const int RedactionJpegQuality = 85;
    private const double RedactionPadding = 1.5;   // points
    private const double RenderSizeTolerance = 3;  // pixels

    private readonly PdfLayoutService _layout;
    private readonly PdfToolRunner _tools;
    private readonly ILogger<PdfToolkitService> _logger;

    public PdfToolkitService(PdfLayoutService layout, PdfToolRunner tools, ILogger<PdfToolkitService> logger)
    {
        _layout = layout;
        _tools = tools;
        _logger = logger;
    }

    // ── Pages ────────────────────────────────────────────────────────

    /// <summary>Builds a new PDF from pages in the listed order. Pages not listed are dropped.</summary>
    public byte[] OrganizePages(byte[] pdfBytes, string? pages)
    {
        using var input = OpenForImport(pdfBytes);
        return BuildFromPages(input, PageSelection.Parse(pages, input.PageCount));
    }

    public byte[] RemovePages(byte[] pdfBytes, string? pages)
    {
        using var input = OpenForImport(pdfBytes);
        var removed = PageSelection.Parse(pages, input.PageCount).ToHashSet();
        var kept = Enumerable.Range(1, input.PageCount).Where(page => !removed.Contains(page)).ToList();
        if (kept.Count == 0)
            throw new ArgumentException("A PDF needs at least one page, so not every page can be removed.");

        return BuildFromPages(input, kept);
    }

    /// <summary>Returns a ZIP with one PDF per range ("1-3,4,5-9"), or one PDF per <paramref name="everyPages"/> pages.</summary>
    public byte[] SplitIntoFiles(byte[] pdfBytes, string? ranges, int? everyPages)
    {
        using var input = OpenForImport(pdfBytes);
        List<List<int>> groups;
        if (everyPages is { } size)
        {
            if (size < 1)
                throw new ArgumentException("everyPages must be at least 1.");
            groups = Enumerable.Range(1, input.PageCount).Chunk(size).Select(chunk => chunk.ToList()).ToList();
        }
        else
        {
            groups = PageSelection.ParseGroups(ranges, input.PageCount);
        }

        var files = groups.Select((group, index) => (
            Name: string.Create(CultureInfo.InvariantCulture, $"part_{index + 1:000}_pages_{group[0]}-{group[^1]}.pdf"),
            Content: BuildFromPages(input, group)));

        return ImageArchive.CreateNamed(files, compress: true);
    }

    private static byte[] BuildFromPages(PdfDocument input, IEnumerable<int> pages)
    {
        using var output = new PdfDocument();
        foreach (var page in pages)
            output.AddPage(input.Pages[page - 1]);
        return Save(output);
    }

    // ── Searchable PDF ───────────────────────────────────────────────

    /// <summary>
    /// Adds selectable, searchable text to scanned pages and to text inside pictures, as an invisible layer over the original page,
    /// which stays exactly as it was. Text that's already selectable is left alone.
    /// </summary>
    public async Task<SearchableResult> MakeSearchableAsync(byte[] pdfBytes, CancellationToken cancellationToken = default) =>
        await MakeSearchableAsync(pdfBytes, null, cancellationToken);

    /// <param name="ocr">OCR engine and languages, or null for the server's settings.</param>
    public async Task<SearchableResult> MakeSearchableAsync(byte[] pdfBytes, OcrOverrides? ocr, CancellationToken cancellationToken = default)
    {
        var pages = await _layout.ExtractAsync(pdfBytes, ExtractOptions.ForPositions(requireOcr: true, ocr), cancellationToken);
        var ocrPages = pages
            .Select(page => (page.Number, Words: PlaceOcrWords(page)))
            .Where(page => page.Words.Count > 0)
            .ToList();
        if (ocrPages.Count == 0)
            return new SearchableResult(pdfBytes, 0);

        using var stream = new MemoryStream(pdfBytes);
        using var document = PdfReader.Open(stream, PdfDocumentOpenMode.Modify);
        var font = TextLayerWriter.CreateFont(document);
        foreach (var (number, words) in ocrPages)
            TextLayerWriter.AddText(document.Pages[number - 1], font, words);

        return new SearchableResult(Save(document), ocrPages.Count);
    }

    // Only words that OCR read get a text layer. Words with no reliable position, such as unmatched table text, are skipped.
    private static List<PlacedWord> PlaceOcrWords(LayoutPage page) => page.AllWords()
        .Where(word => word.Confidence is not null && word.IsPositioned)
        .Select(word =>
        {
            var (x, y) = page.Frame?.ToPage(word.Left, word.Baseline) ?? (word.Left, word.Baseline);
            return new PlacedWord(word.Text, x, y, word.Right - word.Left, word.FontSize, page.Frame?.TextAngle ?? 0);
        })
        .ToList();

    // ── Redaction ────────────────────────────────────────────────────

    /// <summary>
    /// Permanently removes matching text. Pages with a match are flattened to pictures with black boxes drawn on them,
    /// so the text isn't merely covered. Metadata, bookmarks and annotations are dropped from the whole document.
    /// Text inside pictures is found with OCR, so pictures with a match are covered too.
    /// </summary>
    public async Task<RedactionResult> RedactAsync(byte[] pdfBytes, IReadOnlyList<string> terms, bool matchCase = false, CancellationToken cancellationToken = default)
    {
        var cleaned = terms.Select(term => term.Trim()).Where(term => term.Length > 0).ToList();
        if (cleaned.Count == 0)
            throw new ArgumentException("At least one term to redact is required.");

        var pages = await _layout.ExtractAsync(pdfBytes, ExtractOptions.ForPositions(requireOcr: true), cancellationToken);
        var matches = pages
            .Select(page => (Page: page, Words: FindRedactionMatches(page.AllWords(), cleaned, matchCase)))
            .Where(match => match.Words.Count > 0)
            .ToDictionary(match => match.Page.Number);

        if (matches.Count == 0)
            throw new NoRedactionMatchException();

        // A box in the wrong place would leave the text visible, so these cases fail rather than guess.
        foreach (var (number, match) in matches)
        {
            if (match.Page.IsRotated)
                throw new InvalidOperationException($"Page {number} is rotated, so it can't be redacted safely. Rotate it upright first.");
            if (match.Words.Any(word => !word.IsPositioned))
                throw new InvalidOperationException($"A term on page {number} is in rotated text, so it can't be redacted safely.");
        }

        var tempDirectory = Directory.CreateTempSubdirectory("pdfsuite-redact-");
        try
        {
            var pdfPath = Path.Combine(tempDirectory.FullName, "input.pdf");
            await File.WriteAllBytesAsync(pdfPath, pdfBytes, cancellationToken);

            using var input = OpenForImport(pdfBytes);
            using var output = new PdfDocument();
            for (var number = 1; number <= input.PageCount; number++)
            {
                if (!matches.TryGetValue(number, out var match))
                {
                    var kept = output.AddPage(input.Pages[number - 1]);
                    kept.Annotations.Clear();
                    continue;
                }

                var rendered = await _tools.RenderPageAsync(pdfPath, number, "png", RedactionDpi, cancellationToken: cancellationToken);
                AddRedactedPage(output, rendered, match.Page, match.Words);
            }

            return new RedactionResult(Save(output), matches.Values.Sum(match => match.Words.Count), matches.Count);
        }
        finally
        {
            tempDirectory.Delete(true);
        }
    }

    /// <summary>Finds every word overlapping a term. Partly matched words are redacted whole, and terms can span several words.</summary>
    public static List<LayoutWord> FindRedactionMatches(IReadOnlyList<LayoutWord> words, IReadOnlyList<string> terms, bool matchCase)
    {
        var text = new StringBuilder();
        var starts = new int[words.Count];
        for (var index = 0; index < words.Count; index++)
        {
            starts[index] = text.Length;
            text.Append(words[index].Text).Append(' ');
        }

        var comparison = matchCase ? StringComparison.Ordinal : StringComparison.OrdinalIgnoreCase;
        var haystack = text.ToString();
        var matched = new SortedSet<int>();

        foreach (var term in terms)
        {
            var needle = string.Join(' ', term.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
            if (needle.Length == 0)
                continue;

            for (var at = haystack.IndexOf(needle, comparison); at >= 0; at = haystack.IndexOf(needle, at + 1, comparison))
            {
                for (var index = 0; index < words.Count; index++)
                {
                    var wordEnd = starts[index] + words[index].Text.Length;
                    if (starts[index] < at + needle.Length && wordEnd > at)
                        matched.Add(index);
                }
            }
        }

        return matched.Select(index => words[index]).ToList();
    }

    private static void AddRedactedPage(PdfDocument output, byte[] rendered, LayoutPage page, List<LayoutWord> words)
    {
        using var source = SKBitmap.Decode(rendered);
        var scale = RedactionDpi / 72f;
        var (width, height) = (page.DisplayWidth, page.DisplayHeight);
        if (Math.Abs(source.Width - width * scale) > RenderSizeTolerance || Math.Abs(source.Height - height * scale) > RenderSizeTolerance)
            throw new InvalidOperationException($"Page {page.Number} has a crop that can't be redacted safely.");

        using var surface = new SKCanvas(source);
        using var paint = new SKPaint { Color = SKColors.Black, Style = SKPaintStyle.Fill };
        foreach (var word in words)
        {
            // OCR positions on a turned or tilted scan map back to the page as a box around the whole word.
            var (left, top, right, bottom) = page.ToPageBox(word);
            surface.DrawRect(SKRect.Create(
                (float)((left - RedactionPadding) * scale),
                (float)((top - RedactionPadding) * scale),
                (float)((right - left + RedactionPadding * 2) * scale),
                (float)((bottom - top + RedactionPadding * 2) * scale)), paint);
        }

        using var encoded = source.Encode(SKEncodedImageFormat.Jpeg, RedactionJpegQuality);
        var newPage = output.AddPage();
        newPage.Width = XUnit.FromPoint(width);
        newPage.Height = XUnit.FromPoint(height);
        using var graphics = XGraphics.FromPdfPage(newPage);
        using var image = LoadImage(encoded.ToArray());
        graphics.DrawImage(image, 0, 0, width, height);
    }

    // ── Metadata ─────────────────────────────────────────────────────

    public PdfMetadata ReadMetadata(byte[] pdfBytes)
    {
        using var stream = new MemoryStream(pdfBytes);
        using var document = PdfReader.Open(stream, PdfDocumentOpenMode.Import);
        var info = document.Info;
        return new PdfMetadata(
            document.PageCount,
            Blank(info.Title), Blank(info.Author), Blank(info.Subject), Blank(info.Keywords), Blank(info.Creator), Blank(info.Producer),
            info.CreationDate == default ? null : info.CreationDate,
            info.ModificationDate == default ? null : info.ModificationDate);

        static string? Blank(string value) => string.IsNullOrWhiteSpace(value) ? null : value;
    }

    /// <summary>Sets any provided fields. With <paramref name="clear"/>, existing metadata and embedded XMP are removed first.</summary>
    public byte[] UpdateMetadata(byte[] pdfBytes, string? title, string? author, string? subject, string? keywords, bool clear)
    {
        using var stream = new MemoryStream(pdfBytes);
        using var document = PdfReader.Open(stream, PdfDocumentOpenMode.Modify);
        if (clear)
        {
            document.Info.Elements.Clear();
            document.Internals.Catalog.Elements.Remove("/Metadata");
        }

        if (title is not null) document.Info.Title = title;
        if (author is not null) document.Info.Author = author;
        if (subject is not null) document.Info.Subject = subject;
        if (keywords is not null) document.Info.Keywords = keywords;
        return Save(document);
    }

    // ── Images ───────────────────────────────────────────────────────

    /// <summary>Returns a ZIP of the PDF's embedded pictures in their original quality, without duplicates.</summary>
    public byte[] ExtractImages(byte[] pdfBytes)
    {
        var seen = new HashSet<string>();
        var files = new List<(string Name, byte[] Content)>();
        var skipped = 0;

        using var document = PigDocument.Open(pdfBytes);
        foreach (var page in document.GetPages())
        {
            foreach (var image in page.GetImages())
            {
                if (image.IsImageMask)
                    continue;

                var raw = image.RawMemory.Span;
                byte[] content;
                string extension;
                if (raw.Length > 2 && raw[0] == 0xFF && raw[1] == 0xD8)
                {
                    content = raw.ToArray();
                    extension = "jpg";
                }
                else if (image.TryGetPng(out var png))
                {
                    content = png;
                    extension = "png";
                }
                else
                {
                    skipped++;
                    continue;
                }

                if (seen.Add(Convert.ToHexString(SHA256.HashData(content))))
                    files.Add((string.Create(CultureInfo.InvariantCulture, $"image_{files.Count + 1:000}_page_{page.Number}.{extension}"), content));
            }
        }

        if (skipped > 0)
            _logger.LogInformation("Skipped {Count} images in a format that can't be exported", skipped);
        if (files.Count == 0)
            throw new InvalidOperationException("This PDF has no pictures that can be extracted.");

        return ImageArchive.CreateNamed(files, compress: false);
    }

    /// <summary>Draws a logo or signature. Position and width are in points from the top-left, and height keeps the picture's shape.</summary>
    public byte[] StampImage(byte[] pdfBytes, byte[] imageBytes, double x, double y, double width, string? pages)
    {
        if (width <= 0)
            throw new ArgumentException("width must be greater than 0.");

        using var stream = new MemoryStream(pdfBytes);
        using var document = PdfReader.Open(stream, PdfDocumentOpenMode.Modify);
        using var image = LoadImage(imageBytes);
        var height = width * image.PixelHeight / Math.Max(image.PixelWidth, 1);

        foreach (var number in SelectedOrAllPages(pages, document.PageCount))
        {
            using var graphics = XGraphics.FromPdfPage(document.Pages[number - 1], XGraphicsPdfPageOptions.Append);
            graphics.DrawImage(image, x, y, width, height);
        }

        return Save(document);
    }

    // ── Crop ─────────────────────────────────────────────────────────

    /// <summary>Trims margins in points. Viewers hide the trimmed area, but its content stays in the file, so use redaction for secrets.</summary>
    public byte[] CropPages(byte[] pdfBytes, double left, double right, double top, double bottom, string? pages)
    {
        if (left < 0 || right < 0 || top < 0 || bottom < 0)
            throw new ArgumentException("Crop margins can't be negative.");

        using var stream = new MemoryStream(pdfBytes);
        using var document = PdfReader.Open(stream, PdfDocumentOpenMode.Modify);
        foreach (var number in SelectedOrAllPages(pages, document.PageCount))
        {
            var page = document.Pages[number - 1];
            var box = page.MediaBox;
            var newRight = box.X2 - right;
            var newTop = box.Y2 - top;
            var newLeft = box.X1 + left;
            var newBottom = box.Y1 + bottom;
            if (newRight <= newLeft || newTop <= newBottom)
                throw new ArgumentException($"Those margins leave nothing of page {number}.");

            page.CropBox = new PdfRectangle(new XPoint(newLeft, newBottom), new XPoint(newRight, newTop));
        }

        return Save(document);
    }

    // ── Forms ────────────────────────────────────────────────────────

    public IReadOnlyList<PdfFormField> ListFormFields(byte[] pdfBytes)
    {
        using var stream = new MemoryStream(pdfBytes);
        using var document = PdfReader.Open(stream, PdfDocumentOpenMode.Modify);
        if (!HasForm(document))
            return [];

        var form = document.AcroForm;
        return form.Fields.DescendantNames
            .Select(name => (Name: name, Field: form.Fields[name]))
            .Where(entry => entry.Field is not null)
            .Select(entry => new PdfFormField(entry.Name, GetFieldType(entry.Field!), GetFieldValue(entry.Field!), entry.Field!.ReadOnly))
            .ToList();
    }

    /// <summary>Fills fields by name. Checkboxes take true or false. With <paramref name="flatten"/>, values become page content and the fields are removed.</summary>
    public async Task<byte[]> FillFormAsync(byte[] pdfBytes, IReadOnlyDictionary<string, string> values, bool flatten, CancellationToken cancellationToken = default)
    {
        using var stream = new MemoryStream(pdfBytes);
        using var document = PdfReader.Open(stream, PdfDocumentOpenMode.Modify);
        if (!HasForm(document))
            throw new InvalidOperationException("This PDF has no form fields.");

        var form = document.AcroForm;

        foreach (var (name, value) in values)
        {
            var field = form.Fields[name] ?? throw new ArgumentException($"There is no form field called '{name}'.");
            switch (field)
            {
                case PdfTextField text:
                    text.Text = value;
                    break;
                case PdfCheckBoxField checkBox:
                    if (!bool.TryParse(value, out var isChecked))
                        throw new ArgumentException($"Field '{name}' is a checkbox, so its value must be true or false.");
                    checkBox.Checked = isChecked;
                    break;
                case PdfRadioButtonField radio:
                    if (!int.TryParse(value, CultureInfo.InvariantCulture, out var radioIndex))
                        throw new ArgumentException($"Field '{name}' is a radio button, so its value must be the option's number.");
                    radio.SelectedIndex = radioIndex;
                    break;
                case PdfComboBoxField combo:
                    combo.Value = new PdfString(value);
                    break;
                case PdfListBoxField list:
                    if (!int.TryParse(value, CultureInfo.InvariantCulture, out var listIndex))
                        throw new ArgumentException($"Field '{name}' is a list, so its value must be the option's number.");
                    list.SelectedIndex = listIndex;
                    break;
                default:
                    throw new ArgumentException($"Field '{name}' can't be filled.");
            }
        }

        // Tells viewers to draw the new values, since the file has no pictures of them yet.
        form.Elements.SetBoolean("/NeedAppearances", true);
        var filled = Save(document);
        return flatten ? await FlattenFormAsync(filled, cancellationToken) : filled;
    }

    // PDFsharp's Flatten only marks fields read-only, so qpdf is used to merge them into the page and remove them.
    private async Task<byte[]> FlattenFormAsync(byte[] pdfBytes, CancellationToken cancellationToken)
    {
        var tempDirectory = Directory.CreateTempSubdirectory("pdfsuite-flatten-");
        try
        {
            var inputPath = Path.Combine(tempDirectory.FullName, "input.pdf");
            var outputPath = Path.Combine(tempDirectory.FullName, "output.pdf");
            await File.WriteAllBytesAsync(inputPath, pdfBytes, cancellationToken);

            var result = await _tools.RunAsync(
                _tools.QpdfPath,
                ["--generate-appearances", "--flatten-annotations=all", inputPath, outputPath],
                cancellationToken: cancellationToken);

            // qpdf exit code 3 means it succeeded with warnings.
            if (result.ExitCode is not (0 or 3) || !File.Exists(outputPath))
                throw new InvalidOperationException($"Could not flatten the form. {result.Error}".Trim());

            return await File.ReadAllBytesAsync(outputPath, cancellationToken);
        }
        finally
        {
            tempDirectory.Delete(true);
        }
    }

    // PDFsharp's AcroForm property throws on a PDF that has no form.
    private static bool HasForm(PdfDocument document) => document.Internals.Catalog.Elements.ContainsKey("/AcroForm");

    private static string GetFieldType(PdfAcroField field) => field switch
    {
        PdfTextField => "text",
        PdfCheckBoxField => "checkbox",
        PdfRadioButtonField => "radio",
        PdfComboBoxField => "dropdown",
        PdfListBoxField => "list",
        PdfSignatureField => "signature",
        PdfPushButtonField => "button",
        _ => "unknown"
    };

    private static string? GetFieldValue(PdfAcroField field) => field switch
    {
        PdfTextField text => text.Text,
        PdfCheckBoxField checkBox => checkBox.Checked ? "true" : "false",
        PdfRadioButtonField radio => radio.SelectedIndex.ToString(CultureInfo.InvariantCulture),
        PdfListBoxField list => list.SelectedIndex.ToString(CultureInfo.InvariantCulture),
        _ => field.Value?.ToString()
    };

    // ── Shared ───────────────────────────────────────────────────────

    public static int GetPageCount(byte[] pdfBytes)
    {
        using var document = OpenForImport(pdfBytes);
        return document.PageCount;
    }

    private static IEnumerable<int> SelectedOrAllPages(string? pages, int pageCount) =>
        string.IsNullOrWhiteSpace(pages) ? Enumerable.Range(1, pageCount) : PageSelection.Parse(pages, pageCount).Distinct();

    private static PdfDocument OpenForImport(byte[] pdfBytes)
    {
        using var stream = new MemoryStream(pdfBytes);
        return PdfReader.Open(stream, PdfDocumentOpenMode.Import);
    }

    // PDFsharp reads the stream's underlying buffer, so it has to be publicly visible.
    private static XImage LoadImage(byte[] bytes) =>
        XImage.FromStream(new MemoryStream(bytes, 0, bytes.Length, false, publiclyVisible: true));

    private static byte[] Save(PdfDocument document)
    {
        using var output = new MemoryStream();
        document.Save(output);
        return output.ToArray();
    }
}
