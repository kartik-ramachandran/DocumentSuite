using PdfSharp.Pdf;
using PdfSharp.Pdf.IO;
using PdfSharp.Pdf.Security;
using PdfSharp.Drawing;

namespace PdfAI.API.Services;

public class PdfProcessingService
{
    private const double DefaultWatermarkOpacity = 80d / 255;
    private const double DefaultWatermarkFontSize = 48;
    private const double PageNumberMargin = 16;
    private const double PageNumberHeight = 16;

    private readonly DocumentConversionService _conversionService;
    private readonly PdfLayoutService _layoutService;
    private readonly PdfCompressionService _compressionService;
    private readonly ILogger<PdfProcessingService> _logger;

    public PdfProcessingService(
        DocumentConversionService conversionService,
        PdfLayoutService layoutService,
        PdfCompressionService compressionService,
        ILogger<PdfProcessingService> logger)
    {
        _conversionService = conversionService;
        _layoutService = layoutService;
        _compressionService = compressionService;
        _logger = logger;
    }

    public async Task<byte[]> MergePdfs(List<byte[]> pdfFiles)
    {
        if (pdfFiles.Count == 0)
        {
            throw new ArgumentException("At least one PDF is required.", nameof(pdfFiles));
        }

        using var outputDocument = new PdfDocument();
        foreach (var pdfBytes in pdfFiles)
        {
            using var inputStream = new MemoryStream(pdfBytes);
            using var inputDocument = PdfReader.Open(inputStream, PdfDocumentOpenMode.Import);
            foreach (var page in inputDocument.Pages)
            {
                outputDocument.AddPage(page);
            }
        }

        using var outputStream = new MemoryStream();
        outputDocument.Save(outputStream);
        return await Task.FromResult(outputStream.ToArray());
    }

    public async Task<List<byte[]>> SplitPdf(byte[] pdfBytes, string splitType)
    {
        if (!splitType.Equals("pages", StringComparison.OrdinalIgnoreCase))
        {
            throw new NotSupportedException("Only page-by-page splitting is currently supported.");
        }

        using var inputStream = new MemoryStream(pdfBytes);
        using var inputDocument = PdfReader.Open(inputStream, PdfDocumentOpenMode.Import);
        var results = new List<byte[]>();

        foreach (var page in inputDocument.Pages)
        {
            using var outputDocument = new PdfDocument();
            outputDocument.AddPage(page);
            using var outputStream = new MemoryStream();
            outputDocument.Save(outputStream);
            results.Add(outputStream.ToArray());
        }

        return await Task.FromResult(results);
    }

    public async Task<byte[]> ExtractPdfPages(byte[] pdfBytes, IReadOnlyCollection<int> pageNumbers)
    {
        if (pageNumbers.Count == 0)
        {
            throw new ArgumentException("Select at least one page to extract.", nameof(pageNumbers));
        }

        using var inputStream = new MemoryStream(pdfBytes);
        using var inputDocument = PdfReader.Open(inputStream, PdfDocumentOpenMode.Import);
        using var outputDocument = new PdfDocument();

        foreach (var pageNumber in pageNumbers.Distinct().OrderBy(page => page))
        {
            if (pageNumber < 1 || pageNumber > inputDocument.PageCount)
            {
                throw new ArgumentOutOfRangeException(nameof(pageNumbers), $"Page {pageNumber} is outside the PDF page range.");
            }

            outputDocument.AddPage(inputDocument.Pages[pageNumber - 1]);
        }

        using var outputStream = new MemoryStream();
        outputDocument.Save(outputStream);
        return await Task.FromResult(outputStream.ToArray());
    }

    public async Task<PdfInspectionResult> InspectPdf(byte[] pdfBytes)
    {
        using var inputStream = new MemoryStream(pdfBytes);
        using var inputDocument = PdfReader.Open(inputStream, PdfDocumentOpenMode.Import);
        var pageCount = inputDocument.PageCount;
        var pagePreviews = await _conversionService.RenderPdfPreviewImages(pdfBytes);

        return new PdfInspectionResult(
            pageCount,
            pagePreviews.Select((bytes, index) => new PdfPagePreview(
                index + 1,
                $"data:image/jpeg;base64,{Convert.ToBase64String(bytes)}")).ToList());
    }

    public Task<byte[]> CompressPdf(byte[] pdfBytes, string quality = "recommended", CancellationToken cancellationToken = default)
    {
        return _compressionService.CompressAsync(pdfBytes, quality, cancellationToken);
    }

    public Task<byte[]> ConvertPdfToWord(byte[] pdfBytes, CancellationToken cancellationToken = default)
    {
        return _conversionService.ConvertPdfToWord(pdfBytes, cancellationToken);
    }

    public Task<byte[]> ConvertPdfToExcel(byte[] pdfBytes, CancellationToken cancellationToken = default)
    {
        return _conversionService.ConvertPdfToExcel(pdfBytes, cancellationToken);
    }

    public Task<byte[]> ConvertPdfToPowerPoint(byte[] pdfBytes, CancellationToken cancellationToken = default)
    {
        return _conversionService.ConvertPdfToPowerPoint(pdfBytes, cancellationToken);
    }

    public Task<List<byte[]>> ConvertPdfToImages(byte[] pdfBytes, string format = "jpg", int dpi = 220, CancellationToken cancellationToken = default)
    {
        return _conversionService.ConvertPdfToImages(pdfBytes, format, dpi, cancellationToken);
    }

    public byte[] ConvertPdfToHtml(byte[] pdfBytes)
    {
        return _conversionService.ConvertPdfToHtml(pdfBytes);
    }

    public byte[] ConvertPdfToMarkdown(byte[] pdfBytes)
    {
        return _conversionService.ConvertPdfToMarkdown(pdfBytes);
    }

    public byte[] ConvertPdfToText(byte[] pdfBytes)
    {
        return _conversionService.ConvertPdfToText(pdfBytes);
    }

    public Task<byte[]> ConvertWordToPdf(byte[] docxBytes, string extension = ".docx", CancellationToken cancellationToken = default)
    {
        return _conversionService.ConvertWordToPdf(docxBytes, extension, cancellationToken);
    }

    public Task<byte[]> ConvertExcelToPdf(byte[] xlsxBytes, string extension = ".xlsx", CancellationToken cancellationToken = default)
    {
        return _conversionService.ConvertExcelToPdf(xlsxBytes, extension, cancellationToken);
    }

    public Task<byte[]> ConvertPowerPointToPdf(byte[] pptxBytes, string extension = ".pptx", CancellationToken cancellationToken = default)
    {
        return _conversionService.ConvertPowerPointToPdf(pptxBytes, extension, cancellationToken);
    }

    /// <summary>Converts any supported document to PDF, based on its file name. PDFs are returned as they are.</summary>
    public async Task<byte[]> ConvertAnyToPdf(string fileName, byte[] bytes, CancellationToken cancellationToken = default)
    {
        var extension = Path.GetExtension(fileName).ToLowerInvariant();
        return extension switch
        {
            ".pdf" => bytes,
            ".docx" or ".doc" => await ConvertWordToPdf(bytes, extension, cancellationToken),
            ".xlsx" or ".xls" => await ConvertExcelToPdf(bytes, extension, cancellationToken),
            ".pptx" or ".ppt" => await ConvertPowerPointToPdf(bytes, extension, cancellationToken),
            ".html" or ".htm" => ConvertHtmlToPdf(bytes),
            ".md" or ".markdown" => ConvertMarkdownToPdf(bytes),
            ".txt" => ConvertTextToPdf(bytes),
            ".png" or ".jpg" or ".jpeg" => ConvertImagesToPdf([bytes]),
            _ => throw new ArgumentException($"Unsupported file type '{extension}'. Use pdf, docx, doc, xlsx, xls, pptx, ppt, html, md, txt, png or jpg.")
        };
    }

    /// <summary>Returns a document's pages, paragraphs, tables and pictures as structured data.</summary>
    public async Task<object> ConvertToStructuredData(string fileName, byte[] bytes, bool includeImages, CancellationToken cancellationToken = default)
    {
        var pdf = await ConvertAnyToPdf(fileName, bytes, cancellationToken);
        var pages = await _layoutService.ExtractAsync(pdf, includeImages: true, requireOcr: false, cancellationToken);
        return DocumentJsonMapper.ToJson(pages, includeImages);
    }

    public byte[] ConvertHtmlToPdf(byte[] htmlBytes)
    {
        return _conversionService.ConvertHtmlToPdf(htmlBytes);
    }

    public byte[] ConvertMarkdownToPdf(byte[] markdownBytes)
    {
        return _conversionService.ConvertMarkdownToPdf(markdownBytes);
    }

    public byte[] ConvertTextToPdf(byte[] textBytes)
    {
        return _conversionService.ConvertTextToPdf(textBytes);
    }

    public byte[] ConvertImagesToPdf(IReadOnlyList<byte[]> imageBytes)
    {
        return _conversionService.ConvertImagesToPdf(imageBytes);
    }

    public async Task<byte[]> AddWatermark(byte[] pdfBytes, string watermarkText, double opacity = DefaultWatermarkOpacity, double fontSize = DefaultWatermarkFontSize)
    {
        using var inputStream = new MemoryStream(pdfBytes);
        using var document = PdfReader.Open(inputStream, PdfDocumentOpenMode.Modify);
        if (opacity is <= 0 or > 1)
            throw new ArgumentException("opacity must be above 0 and at most 1.", nameof(opacity));
        if (fontSize <= 0)
            throw new ArgumentException("fontSize must be greater than 0.", nameof(fontSize));

        var font = new XFont("Arial", fontSize, XFontStyleEx.Bold);
        var brush = new XSolidBrush(XColor.FromArgb((int)Math.Round(opacity * 255), 80, 80, 80));

        foreach (var page in document.Pages)
        {
            using var graphics = XGraphics.FromPdfPage(page, XGraphicsPdfPageOptions.Append);
            graphics.TranslateTransform(page.Width.Point / 2, page.Height.Point / 2);
            graphics.RotateTransform(-35);
            graphics.DrawString(watermarkText, font, brush, new XPoint(0, 0), XStringFormats.Center);
        }

        using var outputStream = new MemoryStream();
        document.Save(outputStream);
        return await Task.FromResult(outputStream.ToArray());
    }

    public async Task<byte[]> RotatePdf(byte[] pdfBytes, int degrees, string? pages = null)
    {
        if (degrees % 90 != 0)
        {
            throw new ArgumentException("Rotation must be a multiple of 90 degrees.", nameof(degrees));
        }

        using var inputStream = new MemoryStream(pdfBytes);
        using var document = PdfReader.Open(inputStream, PdfDocumentOpenMode.Modify);
        var selected = string.IsNullOrWhiteSpace(pages)
            ? Enumerable.Range(1, document.PageCount)
            : PageSelection.Parse(pages, document.PageCount).Distinct();
        foreach (var number in selected)
        {
            var page = document.Pages[number - 1];
            page.Rotate = NormalizeRotation(page.Rotate + degrees);
        }

        using var outputStream = new MemoryStream();
        document.Save(outputStream);
        return await Task.FromResult(outputStream.ToArray());
    }

    /// <param name="position">top-left, top-center, top-right, bottom-left, bottom-center or bottom-right.</param>
    /// <param name="startAt">The number shown on the first page.</param>
    public byte[] AddPageNumbers(byte[] pdfBytes, string position = "bottom-center", int startAt = 1)
    {
        using var inputStream = new MemoryStream(pdfBytes);
        using var document = PdfReader.Open(inputStream, PdfDocumentOpenMode.Modify);
        var (isTop, format) = position.ToLowerInvariant() switch
        {
            "top-left" => (true, XStringFormats.CenterLeft),
            "top-center" => (true, XStringFormats.Center),
            "top-right" => (true, XStringFormats.CenterRight),
            "bottom-left" => (false, XStringFormats.CenterLeft),
            "bottom-center" => (false, XStringFormats.Center),
            "bottom-right" => (false, XStringFormats.CenterRight),
            _ => throw new ArgumentException($"Unknown position '{position}'. Use top-left, top-center, top-right, bottom-left, bottom-center or bottom-right.", nameof(position))
        };

        var font = new XFont("Arial", 9);
        var brush = XBrushes.DarkSlateGray;

        for (var index = 0; index < document.Pages.Count; index++)
        {
            var page = document.Pages[index];
            using var graphics = XGraphics.FromPdfPage(page, XGraphicsPdfPageOptions.Append);
            var label = $"{index + startAt} / {document.Pages.Count + startAt - 1}";
            var top = isTop ? PageNumberMargin : page.Height.Point - PageNumberMargin - PageNumberHeight;
            graphics.DrawString(label, font, brush, new XRect(PageNumberMargin, top, page.Width.Point - PageNumberMargin * 2, PageNumberHeight), format);
        }

        using var outputStream = new MemoryStream();
        document.Save(outputStream);
        return outputStream.ToArray();
    }

    public byte[] RepairPdf(byte[] pdfBytes)
    {
        using var inputStream = new MemoryStream(pdfBytes);
        using var sourceDocument = PdfReader.Open(inputStream, PdfDocumentOpenMode.Import);
        using var repairedDocument = new PdfDocument();

        foreach (var page in sourceDocument.Pages)
        {
            repairedDocument.AddPage(page);
        }

        using var outputStream = new MemoryStream();
        repairedDocument.Save(outputStream);
        return outputStream.ToArray();
    }

    public Task<string> OcrPdf(byte[] pdfBytes, CancellationToken cancellationToken = default)
    {
        return _layoutService.ExtractTextAsync(pdfBytes, cancellationToken);
    }

    public byte[] UnlockPdf(byte[] pdfBytes, string? password = null)
    {
        using var inputStream = new MemoryStream(pdfBytes);
        using var outputStream = new MemoryStream();

        try
        {
            var document = string.IsNullOrEmpty(password)
                ? PdfReader.Open(inputStream, PdfDocumentOpenMode.Import)
                : PdfReader.Open(inputStream, password, PdfDocumentOpenMode.Import);

            var newDocument = new PdfDocument();
            foreach (var page in document.Pages)
            {
                newDocument.AddPage(page);
            }

            newDocument.Save(outputStream);
            return outputStream.ToArray();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error unlocking PDF");
            throw new InvalidOperationException("Could not unlock PDF. Password may be incorrect.", ex);
        }
    }

    public byte[] ProtectPdf(byte[] pdfBytes, string userPassword, string ownerPassword)
    {
        using var inputStream = new MemoryStream(pdfBytes);
        using var outputStream = new MemoryStream();

        var document = PdfReader.Open(inputStream, PdfDocumentOpenMode.Modify);

        var securitySettings = document.SecuritySettings;
        securitySettings.UserPassword = userPassword;
        securitySettings.OwnerPassword = ownerPassword;

        document.Save(outputStream);
        return outputStream.ToArray();
    }

    private static int NormalizeRotation(int degrees)
    {
        var normalized = degrees % 360;
        return normalized < 0 ? normalized + 360 : normalized;
    }
}

public record PdfInspectionResult(int PageCount, IReadOnlyList<PdfPagePreview> Pages);

public record PdfPagePreview(int PageNumber, string PreviewDataUrl);
