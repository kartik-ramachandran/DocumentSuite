using System.ComponentModel;
using System.Text.Json;
using ModelContextProtocol;
using ModelContextProtocol.Server;
using PdfAI.API.Services;
using UglyToad.PdfPig;

namespace PdfAI.API.Mcp;

/// <summary>
/// PDF tools for AI clients, designed to use as few tokens as possible. There are only a few tools with
/// short descriptions, files are passed by path, and results are short summaries rather than document
/// contents. All paths are relative to the workspace folder.
/// </summary>
[McpServerToolType]
public sealed class PdfMcpTools
{
    private const int DefaultDpi = 150;
    private const int MinDpi = 36;
    private const int MaxDpi = 600;
    private const int MaxPreviewChars = 2000;
    private const int PagesCheckedForText = 5;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly PdfProcessingService _pdf;
    private readonly PdfCompareService _compare;
    private readonly McpWorkspace _workspace;

    public PdfMcpTools(PdfProcessingService pdf, PdfCompareService compare, McpWorkspace workspace)
    {
        _pdf = pdf;
        _compare = compare;
        _workspace = workspace;
    }

    [McpServerTool(Name = "pdf_info"), Description("Page count, size, encryption and whether a PDF has a text layer.")]
    public Task<string> Info(string input, CancellationToken cancellationToken) => Run(async () =>
    {
        var bytes = await _workspace.ReadAsync(input, cancellationToken);
        try
        {
            using var document = PdfDocument.Open(bytes);
            var hasText = document.GetPages().Take(PagesCheckedForText).Any(page => page.Letters.Count > 0);
            return new { pages = document.NumberOfPages, bytes = bytes.Length, encrypted = false, hasText };
        }
        catch (Exception ex) when (ex.GetType().Name.Contains("Encrypt", StringComparison.OrdinalIgnoreCase))
        {
            return (object)new { bytes = bytes.Length, encrypted = true };
        }
    });

    [McpServerTool(Name = "pdf_convert"), Description("Convert a PDF to docx, xlsx, pptx, txt, html, md, jpg or png. Several image pages are zipped.")]
    public Task<string> Convert(string input, string to, string? output = null, int dpi = DefaultDpi, CancellationToken cancellationToken = default) => Run(async () =>
    {
        if (dpi is < MinDpi or > MaxDpi)
            throw new ArgumentException($"dpi must be between {MinDpi} and {MaxDpi}.");

        var bytes = await _workspace.ReadAsync(input, cancellationToken);
        var format = to.Trim().TrimStart('.').ToLowerInvariant();
        var (content, extension) = format switch
        {
            "docx" or "word" => (await _pdf.ConvertPdfToWord(bytes, cancellationToken), "docx"),
            "xlsx" or "excel" => (await _pdf.ConvertPdfToExcel(bytes, cancellationToken), "xlsx"),
            "pptx" or "powerpoint" => (await _pdf.ConvertPdfToPowerPoint(bytes, cancellationToken), "pptx"),
            "txt" or "text" => (_pdf.ConvertPdfToText(bytes), "txt"),
            "html" => (_pdf.ConvertPdfToHtml(bytes), "html"),
            "md" or "markdown" => (_pdf.ConvertPdfToMarkdown(bytes), "md"),
            "jpg" or "jpeg" => await RenderImages(bytes, "jpg", dpi, cancellationToken),
            "png" => await RenderImages(bytes, "png", dpi, cancellationToken),
            _ => throw new ArgumentException($"Unsupported format '{to}'. Use docx, xlsx, pptx, txt, html, md, jpg or png.")
        };

        return await Save(output, input, extension, content, cancellationToken);
    });

    [McpServerTool(Name = "pdf_create"), Description("Combine files into one PDF, in order. Accepts pdf, docx, doc, xlsx, xls, pptx, ppt, html, md, txt, png, jpg.")]
    public Task<string> Create(string[] inputs, string? output = null, CancellationToken cancellationToken = default) => Run(async () =>
    {
        if (inputs.Length == 0)
            throw new ArgumentException("At least one input file is required.");

        var pdfs = new List<byte[]>();
        foreach (var input in inputs)
            pdfs.Add(await ToPdf(input, await _workspace.ReadAsync(input, cancellationToken), cancellationToken));

        var content = pdfs.Count == 1 ? pdfs[0] : await _pdf.MergePdfs(pdfs);
        return await Save(output, inputs[0], "pdf", content, cancellationToken);
    });

    [McpServerTool(Name = "pdf_edit"), Description("Edit a PDF. action: compress (quality: less|recommended|extreme), split (pages: 1,3,5-8), rotate (degrees), watermark (text), page_numbers, repair, protect (password, owner_password), unlock (password).")]
    public Task<string> Edit(
        string input,
        string action,
        string? output = null,
        string? quality = null,
        string? pages = null,
        int degrees = 90,
        string? text = null,
        string? password = null,
        string? owner_password = null,
        CancellationToken cancellationToken = default) => Run(async () =>
    {
        var bytes = await _workspace.ReadAsync(input, cancellationToken);
        var content = action.Trim().ToLowerInvariant() switch
        {
            "compress" => await _pdf.CompressPdf(bytes, quality ?? "recommended", cancellationToken),
            "split" => await _pdf.ExtractPdfPages(bytes, ParsePages(pages)),
            "rotate" => await _pdf.RotatePdf(bytes, degrees),
            "watermark" => await _pdf.AddWatermark(bytes, Require(text, "text")),
            "page_numbers" => _pdf.AddPageNumbers(bytes),
            "repair" => _pdf.RepairPdf(bytes),
            "protect" => _pdf.ProtectPdf(bytes, Require(password, "password"), owner_password ?? Require(password, "password")),
            "unlock" => _pdf.UnlockPdf(bytes, password),
            _ => throw new ArgumentException($"Unknown action '{action}'.")
        };

        var defaultName = Path.Combine(Path.GetDirectoryName(input) ?? string.Empty, $"{Path.GetFileNameWithoutExtension(input)}_{action.Trim().ToLowerInvariant()}.pdf");
        return await Save(output, defaultName, "pdf", content, cancellationToken);
    });

    [McpServerTool(Name = "pdf_text"), Description("Save a PDF's full text to a file, using OCR on scanned pages. Set preview_chars only if you need some of the text inline.")]
    public Task<string> Text(string input, string? output = null, int preview_chars = 0, CancellationToken cancellationToken = default) => Run(async () =>
    {
        var text = await _pdf.OcrPdf(await _workspace.ReadAsync(input, cancellationToken), cancellationToken);
        var saved = await _workspace.WriteAsync(output, input, "txt", System.Text.Encoding.UTF8.GetBytes(text), cancellationToken);
        var previewLength = Math.Clamp(preview_chars, 0, Math.Min(MaxPreviewChars, text.Length));
        return previewLength > 0
            ? new { output = saved, chars = text.Length, preview = text[..previewLength] }
            : (object)new { output = saved, chars = text.Length };
    });

    [McpServerTool(Name = "pdf_compare"), Description("Compare two PDFs. Returns change counts and saves the full page-by-page report as JSON.")]
    public Task<string> Compare(string left, string right, string? output = null, CancellationToken cancellationToken = default) => Run(async () =>
    {
        var result = await _compare.CompareAsync(
            await _workspace.ReadAsync(left, cancellationToken),
            await _workspace.ReadAsync(right, cancellationToken));

        var defaultName = Path.Combine(Path.GetDirectoryName(left) ?? string.Empty, $"{Path.GetFileNameWithoutExtension(left)}_compare.json");
        var report = await _workspace.WriteAsync(output, defaultName, "json", JsonSerializer.SerializeToUtf8Bytes(result, Json), cancellationToken);
        return new { report, summary = result.Summary };
    });

    private async Task<(byte[] Content, string Extension)> RenderImages(byte[] pdf, string format, int dpi, CancellationToken cancellationToken)
    {
        var images = await _pdf.ConvertPdfToImages(pdf, format, dpi, cancellationToken);
        return images.Count == 1 ? (images[0], format) : (ImageArchive.Create(images, format), "zip");
    }

    private async Task<byte[]> ToPdf(string input, byte[] bytes, CancellationToken cancellationToken)
    {
        var extension = Path.GetExtension(input).ToLowerInvariant();
        return extension switch
        {
            ".pdf" => bytes,
            ".docx" or ".doc" => await _pdf.ConvertWordToPdf(bytes, extension, cancellationToken),
            ".xlsx" or ".xls" => await _pdf.ConvertExcelToPdf(bytes, extension, cancellationToken),
            ".pptx" or ".ppt" => await _pdf.ConvertPowerPointToPdf(bytes, extension, cancellationToken),
            ".html" or ".htm" => _pdf.ConvertHtmlToPdf(bytes),
            ".md" or ".markdown" => _pdf.ConvertMarkdownToPdf(bytes),
            ".txt" => _pdf.ConvertTextToPdf(bytes),
            ".png" or ".jpg" or ".jpeg" => _pdf.ConvertImagesToPdf([bytes]),
            _ => throw new ArgumentException($"Unsupported input file type '{extension}'.")
        };
    }

    private async Task<object> Save(string? output, string source, string extension, byte[] content, CancellationToken cancellationToken)
    {
        var saved = await _workspace.WriteAsync(output, source, extension, content, cancellationToken);
        return new { output = saved, bytes = content.Length };
    }

    private static string Require(string? value, string name) =>
        string.IsNullOrEmpty(value) ? throw new ArgumentException($"{name} is required for this action.") : value;

    private static List<int> ParsePages(string? pages)
    {
        var selected = new SortedSet<int>();
        foreach (var part in Require(pages, "pages").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var range = part.Split('-', StringSplitOptions.TrimEntries);
            if (range.Length > 2 || !int.TryParse(range[0], out var first) || !int.TryParse(range[^1], out var last) || first < 1 || last < first)
                throw new ArgumentException($"Invalid page selection '{part}'.");
            for (var page = first; page <= last; page++)
                selected.Add(page);
        }

        return selected.ToList();
    }

    // The MCP SDK hides ordinary exception messages from the client, so they're passed on to let the model correct itself.
    private static async Task<string> Run<T>(Func<Task<T>> action)
    {
        try
        {
            return JsonSerializer.Serialize<object?>(await action(), Json);
        }
        catch (Exception ex) when (ex is not OperationCanceledException and not McpException)
        {
            throw new McpException(ex.Message, ex);
        }
    }
}
