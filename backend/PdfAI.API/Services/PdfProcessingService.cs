using PdfSharp.Pdf;
using PdfSharp.Pdf.IO;
using PdfSharp.Pdf.Security;
using PdfSharp.Drawing;

namespace PdfAI.API.Services;

public class PdfProcessingService
{
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

    public async Task<byte[]> AddWatermark(byte[] pdfBytes, string watermarkText)
    {
        using var inputStream = new MemoryStream(pdfBytes);
        using var document = PdfReader.Open(inputStream, PdfDocumentOpenMode.Modify);
        var font = new XFont("Arial", 48, XFontStyleEx.Bold);
        var brush = new XSolidBrush(XColor.FromArgb(80, 80, 80, 80));

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

    public async Task<byte[]> RotatePdf(byte[] pdfBytes, int degrees)
    {
        if (degrees % 90 != 0)
        {
            throw new ArgumentException("Rotation must be a multiple of 90 degrees.", nameof(degrees));
        }

        using var inputStream = new MemoryStream(pdfBytes);
        using var document = PdfReader.Open(inputStream, PdfDocumentOpenMode.Modify);
        foreach (var page in document.Pages)
        {
            page.Rotate = NormalizeRotation(page.Rotate + degrees);
        }

        using var outputStream = new MemoryStream();
        document.Save(outputStream);
        return await Task.FromResult(outputStream.ToArray());
    }

    public byte[] AddPageNumbers(byte[] pdfBytes)
    {
        using var inputStream = new MemoryStream(pdfBytes);
        using var document = PdfReader.Open(inputStream, PdfDocumentOpenMode.Modify);
        var font = new XFont("Arial", 9);
        var brush = XBrushes.DarkSlateGray;

        for (var index = 0; index < document.Pages.Count; index++)
        {
            var page = document.Pages[index];
            using var graphics = XGraphics.FromPdfPage(page, XGraphicsPdfPageOptions.Append);
            var label = $"{index + 1} / {document.Pages.Count}";
            graphics.DrawString(label, font, brush, new XRect(0, page.Height.Point - 32, page.Width.Point, 16), XStringFormats.Center);
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
