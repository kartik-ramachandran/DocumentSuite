using Microsoft.AspNetCore.Mvc;
using PdfAI.API.Services;

namespace PdfAI.API.Controllers;

[Route("api/pdf")]
public class PdfOperationsController : PdfBaseController
{
    private readonly PdfProcessingService _pdfService;
    private readonly ILogger<PdfOperationsController> _logger;

    public PdfOperationsController(PdfProcessingService pdfService, ILogger<PdfOperationsController> logger)
    {
        _pdfService = pdfService;
        _logger = logger;
    }

    [HttpPost("merge")]
    [RequestSizeLimit(104857600)]
    public async Task<IActionResult> MergePdfs(List<IFormFile> files)
    {
        try
        {
            var pdfBytes = new List<byte[]>();
            foreach (var file in files)
                pdfBytes.Add(await ReadBytes(file));

            var result = await _pdfService.MergePdfs(pdfBytes);
            return File(result, "application/pdf", "merged.pdf");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error merging PDFs");
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("split")]
    public async Task<IActionResult> SplitPdf(IFormFile file, [FromForm] string? pages = null)
    {
        try
        {
            var pdfBytes = await ReadBytes(file);
            var selectedPages = ParsePageSelection(pages);
            var result = await _pdfService.ExtractPdfPages(pdfBytes, selectedPages);
            return File(result, "application/pdf", selectedPages.Count == 1 ? $"page_{selectedPages[0]}.pdf" : "selected_pages.pdf");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error splitting PDF");
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("split/inspect")]
    public async Task<IActionResult> InspectPdf(IFormFile file)
    {
        try
        {
            var result = await _pdfService.InspectPdf(await ReadBytes(file));
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error inspecting PDF");
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("compress")]
    public async Task<IActionResult> CompressPdf(IFormFile file, [FromForm] string quality = "recommended")
    {
        try
        {
            var result = await _pdfService.CompressPdf(await ReadBytes(file), quality, HttpContext.RequestAborted);
            return File(result, "application/pdf", "compressed.pdf");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error compressing PDF");
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("rotate")]
    public async Task<IActionResult> RotatePdf(IFormFile file, [FromForm] int degrees = 90, [FromForm] string? pages = null)
    {
        try
        {
            var result = await _pdfService.RotatePdf(await ReadBytes(file), degrees, pages);
            return File(result, "application/pdf", "rotated.pdf");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error rotating PDF");
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("watermark")]
    public async Task<IActionResult> AddWatermark(IFormFile file, [FromForm] string text, [FromForm] double opacity = 0.31, [FromForm] double fontSize = 48)
    {
        try
        {
            var result = await _pdfService.AddWatermark(await ReadBytes(file), text, opacity, fontSize);
            return File(result, "application/pdf", "watermarked.pdf");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error adding watermark");
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("page-numbers")]
    public async Task<IActionResult> AddPageNumbers(IFormFile file, [FromForm] string position = "bottom-center", [FromForm] int startAt = 1)
    {
        try
        {
            var result = _pdfService.AddPageNumbers(await ReadBytes(file), position, startAt);
            return File(result, "application/pdf", "numbered.pdf");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error adding page numbers");
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("repair")]
    public async Task<IActionResult> RepairPdf(IFormFile file)
    {
        try
        {
            var result = _pdfService.RepairPdf(await ReadBytes(file));
            return File(result, "application/pdf", "repaired.pdf");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error repairing PDF");
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("unlock")]
    public async Task<IActionResult> UnlockPdf(IFormFile file, [FromForm] string? password = null)
    {
        try
        {
            var result = _pdfService.UnlockPdf(await ReadBytes(file), password);
            return File(result, "application/pdf", "unlocked.pdf");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error unlocking PDF");
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("protect")]
    public async Task<IActionResult> ProtectPdf(IFormFile file, [FromForm] string userPassword, [FromForm] string ownerPassword)
    {
        try
        {
            var result = _pdfService.ProtectPdf(await ReadBytes(file), userPassword, ownerPassword);
            return File(result, "application/pdf", "protected.pdf");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error protecting PDF");
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("ocr")]
    public async Task<IActionResult> OcrPdf(IFormFile file)
    {
        try
        {
            var result = await _pdfService.OcrPdf(await ReadBytes(file), HttpContext.RequestAborted);
            return File(System.Text.Encoding.UTF8.GetBytes(result), "text/plain", "extracted-text.txt");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error performing OCR");
            return BadRequest(new { error = ex.Message });
        }
    }
}
