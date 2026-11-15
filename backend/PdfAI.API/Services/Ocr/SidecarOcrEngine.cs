using System.Globalization;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Serialization;

namespace PdfAI.API.Services.Ocr;

/// <summary>
/// The OCR service in <c>ocr-service/</c>, which runs PaddleOCR (Apache 2.0) in its own container:
/// PP-OCRv5 for words, plus PP-StructureV3 or PaddleOCR-VL for tables. Set <c>Ocr:ServiceUrl</c> to use it.
/// </summary>
public sealed class SidecarOcrEngine : IOcrEngine
{
    public const string EngineName = "paddle";

    private readonly HttpClient _http;
    private readonly Uri? _baseAddress;

    public SidecarOcrEngine(HttpClient http, IConfiguration configuration)
    {
        _http = http;
        var url = configuration["Ocr:ServiceUrl"];
        _baseAddress = Uri.TryCreate(url, UriKind.Absolute, out var parsed) ? parsed : null;
        _http.Timeout = TimeSpan.FromSeconds(Math.Max(10, configuration.GetValue("Ocr:ServiceTimeoutSeconds", 300)));
    }

    public string Name => EngineName;
    public bool SupportsTables => true;
    public bool IsConfigured => _baseAddress is not null;

    public async Task<OcrResult> RecognizeAsync(byte[] png, OcrRequest request, CancellationToken cancellationToken)
    {
        if (_baseAddress is null)
            throw new OcrEngineUnavailableException(EngineName, "Ocr:ServiceUrl isn't set. Start the ocr-service container and point Ocr:ServiceUrl at it.");

        using var form = new MultipartFormDataContent();
        var image = new ByteArrayContent(png);
        image.Headers.ContentType = new MediaTypeHeaderValue("image/png");
        form.Add(image, "image", "page.png");
        form.Add(new StringContent(string.Join('+', request.Languages)), "languages");
        form.Add(new StringContent(request.Words ? "true" : "false"), "words");
        form.Add(new StringContent(OcrSettings.TableModelName(request.Tables)), "tables");
        form.Add(new StringContent(request.Dpi.ToString(CultureInfo.InvariantCulture)), "dpi");

        HttpResponseMessage response;
        try
        {
            response = await _http.PostAsync(new Uri(_baseAddress, "v1/ocr"), form, cancellationToken);
        }
        catch (HttpRequestException ex)
        {
            throw new OcrEngineUnavailableException(EngineName, $"the OCR service at {_baseAddress} can't be reached.", ex);
        }
        catch (TaskCanceledException ex) when (!cancellationToken.IsCancellationRequested)
        {
            throw new OcrEngineUnavailableException(EngineName, $"the OCR service at {_baseAddress} didn't answer in time.", ex);
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                var detail = await ReadErrorAsync(response, cancellationToken);
                // 503 means the service is up but can't run this model, such as PaddleOCR-VL without a GPU.
                if (response.StatusCode is System.Net.HttpStatusCode.ServiceUnavailable or System.Net.HttpStatusCode.NotImplemented)
                    throw new OcrEngineUnavailableException(EngineName, detail);
                throw new InvalidOperationException($"The OCR service failed ({(int)response.StatusCode}). {detail}".Trim());
            }

            var body = await response.Content.ReadFromJsonAsync<SidecarResponse>(cancellationToken)
                ?? throw new InvalidOperationException("The OCR service returned an empty response.");
            return new OcrResult(
                string.IsNullOrWhiteSpace(body.Engine) ? EngineName : body.Engine,
                (body.Words ?? [])
                    .Where(word => !string.IsNullOrWhiteSpace(word.Text) && word.Width > 0 && word.Height > 0)
                    .Select(word => new OcrWord(word.Text!.Trim(), word.Left, word.Top, word.Width, word.Height, Math.Clamp(word.Confidence, 0, 1), word.Line?.ToString(CultureInfo.InvariantCulture)))
                    .ToList(),
                (body.Tables ?? [])
                    .Where(table => table.Rows is { Count: > 0 } && table.Width > 0 && table.Height > 0)
                    .Select(table => new OcrTable(table.Left, table.Top, table.Width, table.Height,
                        table.Rows!.Select(row => (IReadOnlyList<string>)(row ?? []).Select(cell => cell ?? string.Empty).ToList()).ToList()))
                    .ToList());
        }
    }

    private static async Task<string> ReadErrorAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        try
        {
            var error = await response.Content.ReadFromJsonAsync<SidecarError>(cancellationToken);
            if (!string.IsNullOrWhiteSpace(error?.Detail))
                return error.Detail;
        }
        catch (Exception)
        {
            // Not JSON, so there's no detail to show.
        }

        return response.ReasonPhrase ?? string.Empty;
    }

    private sealed record SidecarResponse(
        [property: JsonPropertyName("engine")] string? Engine,
        [property: JsonPropertyName("words")] List<SidecarWord>? Words,
        [property: JsonPropertyName("tables")] List<SidecarTable>? Tables);

    private sealed record SidecarWord(
        [property: JsonPropertyName("text")] string? Text,
        [property: JsonPropertyName("left")] double Left,
        [property: JsonPropertyName("top")] double Top,
        [property: JsonPropertyName("width")] double Width,
        [property: JsonPropertyName("height")] double Height,
        [property: JsonPropertyName("confidence")] double Confidence,
        [property: JsonPropertyName("line")] int? Line);

    private sealed record SidecarTable(
        [property: JsonPropertyName("left")] double Left,
        [property: JsonPropertyName("top")] double Top,
        [property: JsonPropertyName("width")] double Width,
        [property: JsonPropertyName("height")] double Height,
        [property: JsonPropertyName("rows")] List<List<string?>?>? Rows);

    private sealed record SidecarError([property: JsonPropertyName("detail")] string? Detail);
}
