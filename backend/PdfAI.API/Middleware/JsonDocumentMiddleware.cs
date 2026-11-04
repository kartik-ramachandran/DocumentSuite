using System.Text.Json;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Extensions.Primitives;
using Microsoft.Net.Http.Headers;

namespace PdfAI.API.Middleware;

/// <summary>
/// Lets every /api/pdf route also be called with JSON at /api/json. Files are sent as
/// {"file":{"name":"a.docx","data":"base64"}} and any other property becomes a normal form field.
/// A file result comes back as {"fileName","contentType","bytes","data"}, and JSON results and errors are returned as they are.
/// </summary>
public class JsonDocumentMiddleware
{
    private const string JsonPrefix = "/api/json";
    private const string PdfPrefix = "/api/pdf";
    private const int DefaultMaxFileSizeMb = 100;
    private const double Base64Overhead = 1.4; // base64 is about 4/3 of the file size, plus JSON around it

    private static readonly JsonSerializerOptions ResponseOptions = new(JsonSerializerDefaults.Web);

    private readonly RequestDelegate _next;
    private readonly long _maxDecodedBytes;

    public JsonDocumentMiddleware(RequestDelegate next, IConfiguration configuration)
    {
        _next = next;
        _maxDecodedBytes = configuration.GetValue("MaxFileSizeMB", DefaultMaxFileSizeMb) * 1024L * 1024L;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        if (!context.Request.Path.StartsWithSegments(JsonPrefix, out var remainder))
        {
            await _next(context);
            return;
        }

        if (!HttpMethods.IsPost(context.Request.Method))
        {
            await WriteError(context, StatusCodes.Status405MethodNotAllowed, "Use POST.");
            return;
        }

        if (context.Request.ContentType?.StartsWith("application/json", StringComparison.OrdinalIgnoreCase) != true)
        {
            await WriteError(context, StatusCodes.Status415UnsupportedMediaType, "Send a JSON body with Content-Type: application/json.");
            return;
        }

        // Base64 makes the request larger than the file itself, so the limit is raised here and enforced on decoded bytes below.
        var sizeFeature = context.Features.Get<IHttpMaxRequestBodySizeFeature>();
        if (sizeFeature is { IsReadOnly: false })
            sizeFeature.MaxRequestBodySize = (long)(_maxDecodedBytes * Base64Overhead);

        FormCollection form;
        try
        {
            using var document = await JsonDocument.ParseAsync(context.Request.Body, cancellationToken: context.RequestAborted);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
                throw new JsonDocumentException("The JSON body must be an object.");
            form = BuildForm(document.RootElement);
        }
        catch (JsonDocumentException ex)
        {
            await WriteError(context, ex.StatusCode, ex.Message);
            return;
        }
        catch (JsonException)
        {
            await WriteError(context, StatusCodes.Status400BadRequest, "The request body isn't valid JSON.");
            return;
        }
        catch (BadHttpRequestException ex) when (ex.StatusCode == StatusCodes.Status413PayloadTooLarge)
        {
            await WriteError(context, StatusCodes.Status413PayloadTooLarge, "The request is too large.");
            return;
        }

        context.Request.Path = PdfPrefix + remainder;
        context.Request.ContentType = "multipart/form-data; boundary=json";
        context.Features.Set<IFormFeature>(new FormFeature(form));

        var originalBody = context.Response.Body;
        await using var captured = new MemoryStream();
        context.Response.Body = captured;
        try
        {
            await _next(context);
        }
        finally
        {
            context.Response.Body = originalBody;
        }

        await WriteResult(context, captured);
    }

    private FormCollection BuildForm(JsonElement root)
    {
        var fields = new Dictionary<string, StringValues>();
        var files = new FormFileCollection();
        long totalBytes = 0;

        void AddFile(string fieldName, JsonElement element)
        {
            var file = DecodeFile(fieldName, element);
            totalBytes += file.Length;
            if (totalBytes > _maxDecodedBytes)
                throw new JsonDocumentException($"The files are larger than the {_maxDecodedBytes / (1024 * 1024)} MB limit.", StatusCodes.Status413PayloadTooLarge);
            files.Add(file);
        }

        foreach (var property in root.EnumerateObject())
        {
            var value = property.Value;
            if (IsFile(value))
            {
                AddFile(property.Name, value);
            }
            else if (value.ValueKind == JsonValueKind.Array && value.GetArrayLength() > 0 && value.EnumerateArray().All(IsFile))
            {
                foreach (var item in value.EnumerateArray())
                    AddFile(property.Name, item);
            }
            else if (value.ValueKind == JsonValueKind.Array)
            {
                fields[property.Name] = new StringValues(value.EnumerateArray().Select(ToFieldValue).ToArray());
            }
            else if (value.ValueKind != JsonValueKind.Null)
            {
                fields[property.Name] = ToFieldValue(value);
            }
        }

        return new FormCollection(fields, files);
    }

    private static bool IsFile(JsonElement element) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.String;

    private static FormFile DecodeFile(string fieldName, JsonElement element)
    {
        var data = element.GetProperty("data").GetString()!;

        // Also accepts data URLs such as "data:application/pdf;base64,JVBERi0".
        var comma = data.StartsWith("data:", StringComparison.OrdinalIgnoreCase) ? data.IndexOf(',') : -1;
        var base64 = comma >= 0 ? data[(comma + 1)..] : data;

        byte[] bytes;
        try
        {
            bytes = Convert.FromBase64String(base64);
        }
        catch (FormatException)
        {
            throw new JsonDocumentException($"'{fieldName}' doesn't contain valid base64 data.");
        }

        if (bytes.Length == 0)
            throw new JsonDocumentException($"'{fieldName}' is empty.");

        var name = element.TryGetProperty("name", out var nameElement) && nameElement.ValueKind == JsonValueKind.String
            ? Path.GetFileName(nameElement.GetString()!)
            : fieldName;
        var contentType = element.TryGetProperty("contentType", out var typeElement) && typeElement.ValueKind == JsonValueKind.String
            ? typeElement.GetString()!
            : "application/octet-stream";

        return new FormFile(new MemoryStream(bytes), 0, bytes.Length, fieldName, name)
        {
            Headers = new HeaderDictionary(),
            ContentType = contentType
        };
    }

    // Nested objects stay as JSON text, which is what routes such as forms/fill expect.
    private static string ToFieldValue(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.String => element.GetString()!,
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        _ => element.GetRawText()
    };

    private static async Task WriteResult(HttpContext context, MemoryStream captured)
    {
        var response = context.Response;
        var isJson = response.ContentType?.Contains("json", StringComparison.OrdinalIgnoreCase) == true;
        if (response.StatusCode is < 200 or >= 300 || isJson || captured.Length == 0)
        {
            captured.Position = 0;
            await captured.CopyToAsync(response.Body, context.RequestAborted);
            return;
        }

        var contentType = response.ContentType ?? "application/octet-stream";
        var fileName = ContentDispositionHeaderValue.TryParse(response.Headers.ContentDisposition.ToString(), out var disposition)
            ? (disposition.FileNameStar.HasValue ? disposition.FileNameStar.Value : disposition.FileName.Value)
            : null;

        response.Headers.ContentDisposition = StringValues.Empty;
        response.ContentLength = null;
        await response.WriteAsJsonAsync(new
        {
            fileName,
            contentType,
            bytes = captured.Length,
            data = Convert.ToBase64String(captured.GetBuffer(), 0, (int)captured.Length)
        }, ResponseOptions, context.RequestAborted);
    }

    private static async Task WriteError(HttpContext context, int statusCode, string message)
    {
        context.Response.StatusCode = statusCode;
        await context.Response.WriteAsJsonAsync(new { error = message }, ResponseOptions, context.RequestAborted);
    }

    private sealed class JsonDocumentException(string message, int statusCode = StatusCodes.Status400BadRequest) : Exception(message)
    {
        public int StatusCode { get; } = statusCode;
    }
}
