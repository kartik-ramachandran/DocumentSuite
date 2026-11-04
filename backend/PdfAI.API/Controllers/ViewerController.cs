using Microsoft.AspNetCore.Mvc;
using PdfAI.API.Services;
using UglyToad.PdfPig;

namespace PdfAI.API.Controllers;

/// <summary>Server mode for the viewer: upload a document once, then fetch page images and text as they're needed.</summary>
[ApiController]
[Route("api/pdf/viewer/documents")]
public class ViewerController : ControllerBase
{
    private const int MinDpi = 36;
    private const int MaxDpi = 300;
    private const int DefaultDpi = 96;
    private const int PageCacheSeconds = 600;

    private readonly ViewerDocumentStore _store;
    private readonly PdfProcessingService _pdf;
    private readonly PdfLayoutService _layout;
    private readonly PdfToolRunner _tools;
    private readonly ILogger<ViewerController> _logger;

    public ViewerController(ViewerDocumentStore store, PdfProcessingService pdf, PdfLayoutService layout, PdfToolRunner tools, ILogger<ViewerController> logger)
    {
        _store = store;
        _pdf = pdf;
        _layout = layout;
        _tools = tools;
        _logger = logger;
    }

    /// <summary>Stores a PDF, or converts another supported document to PDF first, and returns its ID and page sizes.</summary>
    [HttpPost]
    [Consumes("multipart/form-data")]
    public async Task<IActionResult> Upload(IFormFile file)
    {
        try
        {
            await using var input = new MemoryStream();
            await file.CopyToAsync(input, HttpContext.RequestAborted);
            var bytes = input.ToArray();
            var isPdf = bytes.Length > 4 && bytes[0] == '%' && bytes[1] == 'P' && bytes[2] == 'D' && bytes[3] == 'F';
            var pdf = isPdf ? bytes : await _pdf.ConvertAnyToPdf(file.FileName, bytes, HttpContext.RequestAborted);

            using var document = PdfDocument.Open(pdf);
            var pages = document.GetPages().Select(page => new ViewerPageSize(page.Width, page.Height)).ToList();
            var stored = await _store.AddAsync(pdf, pages, HttpContext.RequestAborted);
            return Ok(new { id = stored.Id, pageCount = pages.Count, pages });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Could not open a document for viewing");
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpGet("{id}/pages/{page:int}")]
    public async Task<IActionResult> Page(string id, int page, [FromQuery] int dpi = DefaultDpi)
    {
        var document = _store.Find(id);
        if (document is null)
            return NotFound(new { error = "This document has expired or doesn't exist. Open it again." });
        if (page < 1 || page > document.Pages.Count)
            return NotFound(new { error = $"This document has {document.Pages.Count} pages." });
        if (dpi is < MinDpi or > MaxDpi)
            return BadRequest(new { error = $"dpi must be between {MinDpi} and {MaxDpi}." });

        var image = await _tools.RenderPageAsync(document.Path, page, "png", dpi, cancellationToken: HttpContext.RequestAborted);
        Response.Headers.CacheControl = $"private, max-age={PageCacheSeconds}";
        return File(image, "image/png");
    }

    /// <summary>The page's words with positions in points from the top-left. Scanned pages are read with OCR.</summary>
    [HttpGet("{id}/pages/{page:int}/text")]
    public async Task<IActionResult> Text(string id, int page)
    {
        var document = _store.Find(id);
        if (document is null)
            return NotFound(new { error = "This document has expired or doesn't exist. Open it again." });
        if (page < 1 || page > document.Pages.Count)
            return NotFound(new { error = $"This document has {document.Pages.Count} pages." });

        // Not tied to this request, since the result is shared by every later request for the document.
        document.Layout ??= _layout.ExtractAsync(await System.IO.File.ReadAllBytesAsync(document.Path, HttpContext.RequestAborted), includeImages: false, requireOcr: false, CancellationToken.None);
        var layoutPage = (await document.Layout)[page - 1];

        // Rotated pages have no reliable positions on the original page, so they get no selectable text.
        var words = layoutPage.IsRotated
            ? []
            : layoutPage.AllWords().Where(word => word.IsPositioned).Select(word => new
            {
                text = word.Text,
                left = word.Left,
                top = word.Top,
                width = word.Right - word.Left,
                height = word.Bottom - word.Top
            }).ToList();
        return Ok(words);
    }

    [HttpGet("{id}/file")]
    public IActionResult Download(string id)
    {
        var document = _store.Find(id);
        return document is null
            ? NotFound(new { error = "This document has expired or doesn't exist. Open it again." })
            : PhysicalFile(document.Path, "application/pdf", "document.pdf");
    }

    [HttpDelete("{id}")]
    public IActionResult Delete(string id) => _store.Remove(id) ? NoContent() : NotFound();
}
