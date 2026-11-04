using Microsoft.AspNetCore.Mvc;
using PdfAI.API.Services;

namespace PdfAI.API.Controllers;

[Route("api/pdf")]
public class PdfGenerateController : PdfBaseController
{
    private readonly PdfProcessingService _pdfService;
    private readonly ILogger<PdfGenerateController> _logger;

    public PdfGenerateController(PdfProcessingService pdfService, ILogger<PdfGenerateController> logger)
    {
        _pdfService = pdfService;
        _logger = logger;
    }

    [HttpPost("word-to-pdf")]
    [RequestSizeLimit(104857600)]
    public async Task<IActionResult> WordToPdf(List<IFormFile> files)
    {
        try
        {
            var result = await ConvertFilesToPdf(files,
                async f => await _pdfService.ConvertWordToPdf(await ReadBytes(f), Path.GetExtension(f.FileName), HttpContext.RequestAborted));
            return File(result, "application/pdf", CombinedName(files));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error converting Word to PDF");
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("excel-to-pdf")]
    [RequestSizeLimit(104857600)]
    public async Task<IActionResult> ExcelToPdf(List<IFormFile> files)
    {
        try
        {
            var result = await ConvertFilesToPdf(files,
                async f => await _pdfService.ConvertExcelToPdf(await ReadBytes(f), Path.GetExtension(f.FileName), HttpContext.RequestAborted));
            return File(result, "application/pdf", CombinedName(files));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error converting Excel to PDF");
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("powerpoint-to-pdf")]
    [RequestSizeLimit(104857600)]
    public async Task<IActionResult> PowerPointToPdf(List<IFormFile> files)
    {
        try
        {
            var result = await ConvertFilesToPdf(files,
                async f => await _pdfService.ConvertPowerPointToPdf(await ReadBytes(f), Path.GetExtension(f.FileName), HttpContext.RequestAborted));
            return File(result, "application/pdf", CombinedName(files));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error converting PowerPoint to PDF");
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("html-to-pdf")]
    [RequestSizeLimit(104857600)]
    public async Task<IActionResult> HtmlToPdf(List<IFormFile> files)
    {
        try
        {
            var result = await ConvertFilesToPdf(files,
                async f => _pdfService.ConvertHtmlToPdf(await ReadBytes(f)));
            return File(result, "application/pdf", CombinedName(files));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error converting HTML to PDF");
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("markdown-to-pdf")]
    [RequestSizeLimit(104857600)]
    public async Task<IActionResult> MarkdownToPdf(List<IFormFile> files)
    {
        try
        {
            var result = await ConvertFilesToPdf(files,
                async f => _pdfService.ConvertMarkdownToPdf(await ReadBytes(f)));
            return File(result, "application/pdf", CombinedName(files));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error converting Markdown to PDF");
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("text-to-pdf")]
    [RequestSizeLimit(104857600)]
    public async Task<IActionResult> TextToPdf(List<IFormFile> files)
    {
        try
        {
            var result = await ConvertFilesToPdf(files,
                async f => _pdfService.ConvertTextToPdf(await ReadBytes(f)));
            return File(result, "application/pdf", CombinedName(files));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error converting text to PDF");
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("images-to-pdf")]
    [RequestSizeLimit(104857600)]
    public async Task<IActionResult> ImagesToPdf(List<IFormFile> files)
    {
        try
        {
            var imageBytes = new List<byte[]>();
            foreach (var file in files)
                imageBytes.Add(await ReadBytes(file));

            var result = _pdfService.ConvertImagesToPdf(imageBytes);
            return File(result, "application/pdf", CombinedName(files));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error converting images to PDF");
            return BadRequest(new { error = ex.Message });
        }
    }

    // Several files have no single name to keep, so the result says what it is.
    private static string CombinedName(List<IFormFile> files) => files.Count > 1 ? "merged.pdf" : OutputName(files.FirstOrDefault(), ".pdf");

    private async Task<byte[]> ConvertFilesToPdf(List<IFormFile> files, Func<IFormFile, Task<byte[]>> convert)
    {
        if (files.Count == 0)
            throw new ArgumentException("At least one file is required.", nameof(files));

        var pdfs = new List<byte[]>();
        foreach (var file in files)
            pdfs.Add(await convert(file));

        return pdfs.Count == 1 ? pdfs[0] : await _pdfService.MergePdfs(pdfs);
    }

}
