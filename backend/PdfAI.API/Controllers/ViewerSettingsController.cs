using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using PdfAI.API.Services;

namespace PdfAI.API.Controllers;

/// <summary>Saves the viewer's settings on the server. A scope can be an app, a team or a user.</summary>
[ApiController]
[Route("api/settings/{scope}")]
public class ViewerSettingsController : ControllerBase
{
    private const int MaxBodyBytes = 64 * 1024;

    private readonly ViewerSettingsStore _store;
    private readonly IConfiguration _configuration;
    private readonly IHostEnvironment _environment;

    public ViewerSettingsController(ViewerSettingsStore store, IConfiguration configuration, IHostEnvironment environment)
    {
        _store = store;
        _configuration = configuration;
        _environment = environment;
    }

    /// <summary>The saved settings. An empty object if nothing has been saved.</summary>
    [HttpGet]
    public async Task<IActionResult> Get(string scope, CancellationToken cancellationToken)
    {
        if (!ViewerSettingsStore.IsValidScope(scope)) return InvalidScope();

        Response.Headers.CacheControl = "no-store";
        return Content(await _store.ReadAsync(scope, cancellationToken) ?? "{}", "application/json");
    }

    /// <summary>Replaces the saved settings with a flat JSON object.</summary>
    [HttpPut]
    [Consumes("application/json")]
    [RequestSizeLimit(MaxBodyBytes)]
    public async Task<IActionResult> Put(string scope, CancellationToken cancellationToken)
    {
        if (!ViewerSettingsStore.IsValidScope(scope)) return InvalidScope();
        if (WriteRefusal() is { } refusal) return refusal;

        var body = await ReadLimitedBody(cancellationToken);
        if (body is null) return StatusCode(StatusCodes.Status413PayloadTooLarge, new { error = "Settings can be up to 64 KB." });

        string json;
        try
        {
            using var document = JsonDocument.Parse(body);
            if (document.RootElement.ValueKind != JsonValueKind.Object || document.RootElement.EnumerateObject().Any(setting => setting.Value.ValueKind is JsonValueKind.Object or JsonValueKind.Array))
            {
                return BadRequest(new { error = "Settings must be a JSON object of names and simple values." });
            }
            json = document.RootElement.GetRawText();
        }
        catch (JsonException)
        {
            return BadRequest(new { error = "Settings must be valid JSON." });
        }

        return await _store.WriteAsync(scope, json, cancellationToken)
            ? NoContent()
            : StatusCode(StatusCodes.Status507InsufficientStorage, new { error = "Too many sets of settings have been saved." });
    }

    /// <summary>Deletes the saved settings.</summary>
    [HttpDelete]
    public async Task<IActionResult> Delete(string scope, CancellationToken cancellationToken)
    {
        if (!ViewerSettingsStore.IsValidScope(scope)) return InvalidScope();
        if (WriteRefusal() is { } refusal) return refusal;

        await _store.DeleteAsync(scope, cancellationToken);
        return NoContent();
    }

    /// <summary>Returns null if the body is over the limit, including when it doesn't declare its length up front.</summary>
    private async Task<byte[]?> ReadLimitedBody(CancellationToken cancellationToken)
    {
        if (Request.ContentLength > MaxBodyBytes) return null;

        using var buffer = new MemoryStream();
        var chunk = new byte[8192];
        int read;
        while ((read = await Request.Body.ReadAsync(chunk, cancellationToken)) > 0)
        {
            if (buffer.Length + read > MaxBodyBytes) return null;
            buffer.Write(chunk, 0, read);
        }
        return buffer.ToArray();
    }

    private BadRequestObjectResult InvalidScope() =>
        BadRequest(new { error = "A scope can only contain letters, numbers, hyphens and underscores, up to 64 characters." });

    /// <summary>With no key set, only development instances accept changes, so a deployed one can't be changed by accident.</summary>
    private IActionResult? WriteRefusal()
    {
        var key = _configuration["Settings:WriteKey"];
        if (string.IsNullOrWhiteSpace(key))
        {
            return _environment.IsDevelopment()
                ? null
                : StatusCode(StatusCodes.Status403Forbidden, new { error = "Saving settings is turned off. Set Settings:WriteKey on the server to allow it." });
        }

        var header = Request.Headers.Authorization.ToString();
        var supplied = header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) ? header["Bearer ".Length..].Trim() : "";
        var matches = CryptographicOperations.FixedTimeEquals(SHA256.HashData(Encoding.UTF8.GetBytes(supplied)), SHA256.HashData(Encoding.UTF8.GetBytes(key)));
        return matches ? null : Unauthorized(new { error = "Saving settings needs the write key." });
    }
}
