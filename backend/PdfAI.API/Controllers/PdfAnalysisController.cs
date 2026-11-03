using Microsoft.AspNetCore.Mvc;
using PdfAI.API.Models;
using PdfAI.API.Services;

namespace PdfAI.API.Controllers;

[Route("api/pdf")]
public class PdfAnalysisController : PdfBaseController
{
    private readonly PdfProcessingService _pdfService;
    private readonly PdfCompareService _compareService;
    private readonly ValidationAgentService _validationService;
    private readonly AiReviewService _aiReviewService;
    private readonly IConfiguration _configuration;
    private readonly ILogger<PdfAnalysisController> _logger;

    public PdfAnalysisController(
        PdfProcessingService pdfService,
        PdfCompareService compareService,
        ValidationAgentService validationService,
        AiReviewService aiReviewService,
        IConfiguration configuration,
        ILogger<PdfAnalysisController> logger)
    {
        _pdfService = pdfService;
        _compareService = compareService;
        _validationService = validationService;
        _aiReviewService = aiReviewService;
        _configuration = configuration;
        _logger = logger;
    }

    [HttpPost("compare")]
    [RequestSizeLimit(104857600)]
    public async Task<IActionResult> Compare(IFormFile leftFile, IFormFile rightFile)
    {
        try
        {
            if (leftFile.Length == 0 || rightFile.Length == 0)
                return BadRequest(new { error = "Both PDF files are required." });

            var left = await ReadBytes(leftFile);
            var right = await ReadBytes(rightFile);
            var result = await _compareService.CompareAsync(left, right);
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error comparing PDFs");
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("validate")]
    [RequestSizeLimit(104857600)]
    public async Task<IActionResult> Validate(
        [FromForm] string operation,
        List<IFormFile> originalFiles,
        IFormFile? outputFile = null,
        [FromForm] string? optionsJson = null,
        [FromForm] string? warningsJson = null,
        [FromForm] string? resultJson = null)
    {
        try
        {
            var originals = new List<UploadedDocument>();
            foreach (var file in originalFiles)
                originals.Add(await ReadUploadedDocument(file));

            var output = outputFile is null ? null : await ReadUploadedDocument(outputFile);
            var result = _validationService.Validate(operation, originals, output, optionsJson, warningsJson, resultJson);
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error validating PDF outcome");
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("review")]
    public async Task<IActionResult> Review(IFormFile file)
    {
        if (!_configuration.GetValue<bool>("Features:AiReview"))
            return StatusCode(503, new { error = "AI review is disabled. Set Features:AiReview to true in appsettings to enable it." });

        try
        {
            var pdfBytes = await ReadBytes(file);
            var text = await _pdfService.OcrPdf(pdfBytes);

            using var stream = new MemoryStream(pdfBytes);
            var doc = PdfSharp.Pdf.IO.PdfReader.Open(stream, PdfSharp.Pdf.IO.PdfDocumentOpenMode.Import);
            var result = await _aiReviewService.ReviewAsync(new DocumentReviewRequest(file.FileName, doc.PageCount, text));
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error reviewing PDF");
            return BadRequest(new { error = ex.Message });
        }
    }
}
