using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using PdfAI.API.Services;

namespace PdfAI.API.Controllers;

[Route("api/pdf")]
public class PdfToolsController : PdfBaseController
{
    private const string PdfType = "application/pdf";
    private const string ZipType = "application/zip";

    private readonly PdfToolkitService _toolkit;
    private readonly ILogger<PdfToolsController> _logger;

    public PdfToolsController(PdfToolkitService toolkit, ILogger<PdfToolsController> logger)
    {
        _toolkit = toolkit;
        _logger = logger;
    }

    [HttpPost("organize")]
    public Task<IActionResult> Organize(IFormFile file, [FromForm] string? pages) => Run(async () =>
        File(_toolkit.OrganizePages(await ReadBytes(file), pages), PdfType, "organized.pdf"));

    [HttpPost("remove-pages")]
    public Task<IActionResult> RemovePages(IFormFile file, [FromForm] string? pages) => Run(async () =>
        File(_toolkit.RemovePages(await ReadBytes(file), pages), PdfType, "pages_removed.pdf"));

    [HttpPost("split/ranges")]
    public Task<IActionResult> SplitRanges(IFormFile file, [FromForm] string? ranges = null, [FromForm] int? everyPages = null) => Run(async () =>
        File(_toolkit.SplitIntoFiles(await ReadBytes(file), ranges, everyPages), ZipType, "split.zip"));

    [HttpPost("searchable")]
    public Task<IActionResult> Searchable(IFormFile file) => Run(async () =>
    {
        var result = await _toolkit.MakeSearchableAsync(await ReadBytes(file), HttpContext.RequestAborted);
        Response.Headers["X-Ocr-Page-Count"] = result.OcrPages.ToString();
        return File(result.Pdf, PdfType, "searchable.pdf");
    });

    [HttpPost("redact")]
    public Task<IActionResult> Redact(IFormFile file, [FromForm] List<string> terms, [FromForm] bool matchCase = false) => Run(async () =>
    {
        var result = await _toolkit.RedactAsync(await ReadBytes(file), terms, matchCase, HttpContext.RequestAborted);
        Response.Headers["X-Redacted-Word-Count"] = result.RedactedWords.ToString();
        Response.Headers["X-Redacted-Page-Count"] = result.RedactedPages.ToString();
        return File(result.Pdf, PdfType, "redacted.pdf");
    });

    [HttpPost("metadata")]
    public Task<IActionResult> Metadata(IFormFile file) => Run(async () =>
        Ok(_toolkit.ReadMetadata(await ReadBytes(file))));

    [HttpPost("metadata/update")]
    public Task<IActionResult> UpdateMetadata(
        IFormFile file,
        [FromForm] string? title = null,
        [FromForm] string? author = null,
        [FromForm] string? subject = null,
        [FromForm] string? keywords = null,
        [FromForm] bool clear = false) => Run(async () =>
        File(_toolkit.UpdateMetadata(await ReadBytes(file), title, author, subject, keywords, clear), PdfType, "metadata.pdf"));

    [HttpPost("extract-images")]
    public Task<IActionResult> ExtractImages(IFormFile file) => Run(async () =>
        File(_toolkit.ExtractImages(await ReadBytes(file)), ZipType, "images.zip"));

    [HttpPost("stamp-image")]
    public Task<IActionResult> StampImage(
        IFormFile file,
        IFormFile image,
        [FromForm] double x,
        [FromForm] double y,
        [FromForm] double width,
        [FromForm] string? pages = null) => Run(async () =>
        File(_toolkit.StampImage(await ReadBytes(file), await ReadBytes(image), x, y, width, pages), PdfType, "stamped.pdf"));

    [HttpPost("crop")]
    public Task<IActionResult> Crop(
        IFormFile file,
        [FromForm] double left = 0,
        [FromForm] double right = 0,
        [FromForm] double top = 0,
        [FromForm] double bottom = 0,
        [FromForm] string? pages = null) => Run(async () =>
        File(_toolkit.CropPages(await ReadBytes(file), left, right, top, bottom, pages), PdfType, "cropped.pdf"));

    [HttpPost("forms")]
    public Task<IActionResult> Forms(IFormFile file) => Run(async () =>
        Ok(_toolkit.ListFormFields(await ReadBytes(file))));

    /// <param name="values">A JSON object of field names and values, for example {"name":"Ada","agree":"true"}.</param>
    [HttpPost("forms/fill")]
    public Task<IActionResult> FillForm(IFormFile file, [FromForm] string values, [FromForm] bool flatten = false) => Run(async () =>
    {
        var parsed = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(values)
            ?? throw new ArgumentException("values must be a JSON object of field names and values.");
        var fields = parsed.ToDictionary(entry => entry.Key, entry => entry.Value.ValueKind == JsonValueKind.String ? entry.Value.GetString()! : entry.Value.GetRawText());
        return File(await _toolkit.FillFormAsync(await ReadBytes(file), fields, flatten, HttpContext.RequestAborted), PdfType, "filled.pdf");
    });

    private async Task<IActionResult> Run(Func<Task<IActionResult>> action)
    {
        try
        {
            return await action();
        }
        catch (NoRedactionMatchException ex)
        {
            return UnprocessableEntity(new { error = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "PDF tool failed");
            return BadRequest(new { error = ex.Message });
        }
    }
}
