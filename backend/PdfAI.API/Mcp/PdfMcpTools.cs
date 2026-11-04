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
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull };

    private readonly PdfProcessingService _pdf;
    private readonly PdfCompareService _compare;
    private readonly PdfToolkitService _toolkit;
    private readonly McpWorkspace _workspace;

    public PdfMcpTools(PdfProcessingService pdf, PdfCompareService compare, PdfToolkitService toolkit, McpWorkspace workspace)
    {
        _pdf = pdf;
        _compare = compare;
        _toolkit = toolkit;
        _workspace = workspace;
    }

    [McpServerTool(Name = "pdf_info"), Description("Page count, size, encryption, title, author, form field count and whether a PDF has a text layer.")]
    public Task<string> Info(string input, CancellationToken cancellationToken) => Run(async () =>
    {
        var bytes = await _workspace.ReadAsync(input, cancellationToken);
        try
        {
            using var document = PdfDocument.Open(bytes);
            var hasText = document.GetPages().Take(PagesCheckedForText).Any(page => page.Letters.Count > 0);
            var metadata = _toolkit.ReadMetadata(bytes);
            return new { pages = document.NumberOfPages, bytes = bytes.Length, encrypted = false, hasText, title = metadata.Title, author = metadata.Author, formFields = _toolkit.ListFormFields(bytes).Count };
        }
        catch (Exception ex) when (ex.GetType().Name.Contains("Encrypt", StringComparison.OrdinalIgnoreCase) || ex.Message.Contains("password", StringComparison.OrdinalIgnoreCase))
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
            pdfs.Add(await _pdf.ConvertAnyToPdf(input, await _workspace.ReadAsync(input, cancellationToken), cancellationToken));

        var content = pdfs.Count == 1 ? pdfs[0] : await _pdf.MergePdfs(pdfs);
        return await Save(output, inputs[0], "pdf", content, cancellationToken);
    });

    [McpServerTool(Name = "pdf_edit"), Description("Edit a PDF. action: compress (quality: less|recommended|extreme), split or organize (pages in output order: 3,1,5-8), remove_pages (pages), split_files (pages: 1-3,4-6, gives a zip), rotate (degrees, pages), watermark (text), page_numbers, redact (terms; permanent), searchable (OCR scans into selectable text), extract_images (gives a zip), clear_metadata, repair, protect (password, owner_password), unlock (password).")]
    public Task<string> Edit(
        string input,
        string action,
        string? output = null,
        string? quality = null,
        string? pages = null,
        int degrees = 90,
        string? text = null,
        string[]? terms = null,
        string? password = null,
        string? owner_password = null,
        CancellationToken cancellationToken = default) => Run(async () =>
    {
        var bytes = await _workspace.ReadAsync(input, cancellationToken);
        var name = action.Trim().ToLowerInvariant();
        object? extra = null;
        var extension = "pdf";
        byte[] content;
        switch (name)
        {
            case "compress": content = await _pdf.CompressPdf(bytes, quality ?? "recommended", cancellationToken); break;
            case "split" or "organize": content = _toolkit.OrganizePages(bytes, pages); break;
            case "remove_pages": content = _toolkit.RemovePages(bytes, pages); break;
            case "split_files": content = _toolkit.SplitIntoFiles(bytes, pages, null); extension = "zip"; break;
            case "rotate": content = await _pdf.RotatePdf(bytes, degrees, pages); break;
            case "watermark": content = await _pdf.AddWatermark(bytes, Require(text, "text")); break;
            case "page_numbers": content = _pdf.AddPageNumbers(bytes); break;
            case "repair": content = _pdf.RepairPdf(bytes); break;
            case "protect": content = _pdf.ProtectPdf(bytes, Require(password, "password"), owner_password ?? Require(password, "password")); break;
            case "unlock": content = _pdf.UnlockPdf(bytes, password); break;
            case "clear_metadata": content = _toolkit.UpdateMetadata(bytes, null, null, null, null, clear: true); break;
            case "extract_images": content = _toolkit.ExtractImages(bytes); extension = "zip"; break;
            case "redact":
                var redacted = await _toolkit.RedactAsync(bytes, terms ?? [], cancellationToken: cancellationToken);
                content = redacted.Pdf;
                extra = new { redacted.RedactedWords, redacted.RedactedPages };
                break;
            case "searchable":
                var searchable = await _toolkit.MakeSearchableAsync(bytes, cancellationToken);
                content = searchable.Pdf;
                extra = new { searchable.OcrPages };
                break;
            default:
                throw new ArgumentException($"Unknown action '{action}'.");
        }

        var defaultName = Path.Combine(Path.GetDirectoryName(input) ?? string.Empty, $"{Path.GetFileNameWithoutExtension(input)}_{name}.{extension}");
        var saved = await _workspace.WriteAsync(output, defaultName, extension, content, cancellationToken);
        return new { output = saved, bytes = content.Length, details = extra };
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

    private async Task<object> Save(string? output, string source, string extension, byte[] content, CancellationToken cancellationToken)
    {
        var saved = await _workspace.WriteAsync(output, source, extension, content, cancellationToken);
        return new { output = saved, bytes = content.Length };
    }

    private static string Require(string? value, string name) =>
        string.IsNullOrEmpty(value) ? throw new ArgumentException($"{name} is required for this action.") : value;

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
