using Microsoft.AspNetCore.Mvc;
using PdfAI.API.Models;
using PdfAI.API.Services;
// UploadedDocument is defined in ValidationAgentService.cs (same Services namespace)

namespace PdfAI.API.Controllers;

[ApiController]
[Consumes("multipart/form-data")]
public abstract class PdfBaseController : ControllerBase
{
    private const int MaxPagesInRange = 100_000;

    protected static async Task<byte[]> ReadBytes(IFormFile file)
    {
        using var stream = new MemoryStream();
        await file.CopyToAsync(stream);
        return stream.ToArray();
    }

    protected static async Task<UploadedDocument> ReadUploadedDocument(IFormFile file)
    {
        using var stream = new MemoryStream();
        await file.CopyToAsync(stream);
        return new UploadedDocument(file.FileName, file.ContentType, stream.ToArray());
    }

    protected static List<int> ParsePageSelection(string? pages)
    {
        if (string.IsNullOrWhiteSpace(pages))
            throw new ArgumentException("Select at least one page to split.");

        var selected = new SortedSet<int>();
        foreach (var part in pages.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (part.Contains('-', StringComparison.Ordinal))
            {
                var range = part.Split('-', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                if (range.Length != 2 || !int.TryParse(range[0], out var start) || !int.TryParse(range[1], out var end) || start <= 0 || end < start)
                    throw new ArgumentException($"Invalid page range '{part}'.");
                if (end - start >= MaxPagesInRange)
                    throw new ArgumentException($"Page range '{part}' is too large.");

                for (var page = start; page <= end; page++)
                    selected.Add(page);
            }
            else if (int.TryParse(part, out var page) && page > 0)
            {
                selected.Add(page);
            }
            else
            {
                throw new ArgumentException($"Invalid page number '{part}'.");
            }
        }

        return selected.ToList();
    }
}
