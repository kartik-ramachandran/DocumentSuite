using Microsoft.AspNetCore.Mvc;
using PdfAI.API.Services;

namespace PdfAI.API.Controllers;

[Route("api/pdf/convert")]
public class PdfConvertController : PdfBaseController
{
    private const int DefaultImageDpi = 150;
    private const int MinImageDpi = 36;
    private const int MaxImageDpi = 600;

    private readonly PdfProcessingService _pdfService;
    private readonly ILogger<PdfConvertController> _logger;

    public PdfConvertController(PdfProcessingService pdfService, ILogger<PdfConvertController> logger)
    {
        _pdfService = pdfService;
        _logger = logger;
    }

    [HttpPost("word")]
    public async Task<IActionResult> ToWord(IFormFile file)
    {
        try
        {
            var result = await _pdfService.ConvertPdfToWord(await ReadBytes(file), HttpContext.RequestAborted);
            return File(result, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "converted.docx");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error converting PDF to Word");
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("excel")]
    public async Task<IActionResult> ToExcel(IFormFile file)
    {
        try
        {
            var result = await _pdfService.ConvertPdfToExcel(await ReadBytes(file), HttpContext.RequestAborted);
            return File(result, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "converted.xlsx");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error converting PDF to Excel");
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("powerpoint")]
    public async Task<IActionResult> ToPowerPoint(IFormFile file)
    {
        try
        {
            var result = await _pdfService.ConvertPdfToPowerPoint(await ReadBytes(file), HttpContext.RequestAborted);
            return File(result, "application/vnd.openxmlformats-officedocument.presentationml.presentation", "converted.pptx");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error converting PDF to PowerPoint");
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("images")]
    public async Task<IActionResult> ToImages(IFormFile file, [FromForm] string format = "jpg", [FromForm] int dpi = DefaultImageDpi)
    {
        try
        {
            var extension = format.ToLowerInvariant() switch
            {
                "png" => "png",
                "jpg" or "jpeg" => "jpg",
                _ => throw new ArgumentException($"Unsupported image format '{format}'. Use jpg or png.")
            };
            if (dpi is < MinImageDpi or > MaxImageDpi)
                throw new ArgumentException($"dpi must be between {MinImageDpi} and {MaxImageDpi}.");

            var results = await _pdfService.ConvertPdfToImages(await ReadBytes(file), extension, dpi, HttpContext.RequestAborted);
            if (results.Count == 1)
                return File(results[0], extension == "png" ? "image/png" : "image/jpeg", $"page_1.{extension}");

            return File(ImageArchive.Create(results, extension), "application/zip", "pages.zip");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error converting PDF to images");
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("html")]
    public async Task<IActionResult> ToHtml(IFormFile file)
    {
        try
        {
            var result = _pdfService.ConvertPdfToHtml(await ReadBytes(file));
            return File(result, "text/html; charset=utf-8", "converted.html");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error converting PDF to HTML");
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("markdown")]
    public async Task<IActionResult> ToMarkdown(IFormFile file)
    {
        try
        {
            var result = _pdfService.ConvertPdfToMarkdown(await ReadBytes(file));
            return File(result, "text/markdown; charset=utf-8", "converted.md");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error converting PDF to Markdown");
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("text")]
    public async Task<IActionResult> ToText(IFormFile file)
    {
        try
        {
            var result = _pdfService.ConvertPdfToText(await ReadBytes(file));
            return File(result, "text/plain; charset=utf-8", "converted.txt");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error converting PDF to text");
            return BadRequest(new { error = ex.Message });
        }
    }
}
