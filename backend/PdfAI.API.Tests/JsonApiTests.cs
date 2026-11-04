using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;

namespace PdfAI.API.Tests;

public class JsonApiTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client;

    public JsonApiTests(WebApplicationFactory<Program> factory)
    {
        _client = factory.CreateClient();
    }

    [Fact]
    public async Task FileResult_ComesBackAsBase64WithItsNameAndType()
    {
        var (status, json) = await Post("text-to-pdf", new { files = new[] { TextFile("hello from json") } });

        status.Should().Be(HttpStatusCode.OK);
        json.GetProperty("fileName").GetString().Should().Be("note.pdf");
        json.GetProperty("contentType").GetString().Should().Be("application/pdf");
        var pdf = Convert.FromBase64String(json.GetProperty("data").GetString()!);
        Encoding.ASCII.GetString(pdf, 0, 4).Should().Be("%PDF");
        json.GetProperty("bytes").GetInt64().Should().Be(pdf.Length);
    }

    [Fact]
    public async Task SingleFileRoutes_AndOptionsWork()
    {
        var pdf = await CreatePdfBase64();

        var (status, json) = await Post("rotate", new { file = new { name = "a.pdf", data = pdf }, degrees = 180 });

        status.Should().Be(HttpStatusCode.OK);
        json.GetProperty("fileName").GetString().Should().Be("a.pdf");
    }

    [Fact]
    public async Task DataUrlsAreAccepted()
    {
        var pdf = await CreatePdfBase64();

        var (status, _) = await Post("rotate", new { file = new { data = $"data:application/pdf;base64,{pdf}" } });

        status.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task ArraysOfFilesAndOfStringsReachTheRoute()
    {
        var pdf = await CreatePdfBase64();

        var (merged, _) = await Post("merge", new { files = new[] { new { name = "a.pdf", data = pdf }, new { name = "b.pdf", data = pdf } } });
        var (redacted, json) = await Post("redact", new { file = new { name = "a.pdf", data = pdf }, terms = new[] { "not present", "also absent" } });

        merged.Should().Be(HttpStatusCode.OK);
        redacted.Should().Be((HttpStatusCode)422, "the route ran and found neither term");
        json.GetProperty("error").GetString().Should().Contain("nothing was redacted");
    }

    [Fact]
    public async Task JsonResultsPassThroughUnchanged()
    {
        var (status, json) = await Post("metadata", new { file = new { name = "a.pdf", data = await CreatePdfBase64() } });

        status.Should().Be(HttpStatusCode.OK);
        json.GetProperty("pages").GetInt32().Should().Be(1);
        json.TryGetProperty("data", out _).Should().BeFalse();
    }

    [Fact]
    public async Task ToJson_ReturnsStructuredContent()
    {
        var (status, json) = await Post("any-to-json", new { file = new { name = "a.pdf", data = await CreatePdfBase64() } });

        status.Should().Be(HttpStatusCode.OK);
        var page = json.GetProperty("pages")[0];
        page.GetProperty("number").GetInt32().Should().Be(1);
        page.GetProperty("blocks")[0].GetProperty("type").GetString().Should().Be("paragraph");
        page.GetProperty("blocks")[0].GetProperty("text").GetString().Should().Contain("hello from json");
    }

    [Fact]
    public async Task ToJson_AcceptsTextFilesAsWell()
    {
        var (status, json) = await Post("any-to-json", new { file = TextFile("plain text input") });

        status.Should().Be(HttpStatusCode.OK);
        json.GetProperty("pages")[0].GetProperty("blocks")[0].GetProperty("text").GetString().Should().Contain("plain text input");
    }

    [Fact]
    public async Task ToJson_RejectsUnknownFileTypes()
    {
        var (status, json) = await Post("any-to-json", new { file = new { name = "a.exe", data = Convert.ToBase64String([1, 2, 3]) } });

        status.Should().Be(HttpStatusCode.BadRequest);
        json.GetProperty("error").GetString().Should().Contain("Unsupported");
    }

    [Theory]
    [InlineData("{not json", "isn't valid JSON")]
    [InlineData("[1,2]", "must be an object")]
    [InlineData("""{"file":{"data":"###"}}""", "valid base64")]
    [InlineData("""{"file":{"data":""}}""", "is empty")]
    public async Task BadBodiesExplainThemselves(string body, string expected)
    {
        using var response = await _client.PostAsync("/api/json/rotate", new StringContent(body, Encoding.UTF8, "application/json"));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString().Should().Contain(expected);
    }

    [Fact]
    public async Task FileNamesCannotCarryAPath()
    {
        var (status, json) = await Post("any-to-json", new { file = new { name = "../../etc/hello.txt", data = Convert.ToBase64String(Encoding.UTF8.GetBytes("safe name")) } });

        status.Should().Be(HttpStatusCode.OK, "the name is reduced to hello.txt");
        json.GetProperty("pageCount").GetInt32().Should().Be(1);
    }

    [Fact]
    public async Task NonJsonContentTypeIsRejected()
    {
        using var response = await _client.PostAsync("/api/json/rotate", new StringContent("x", Encoding.UTF8, "text/plain"));

        response.StatusCode.Should().Be(HttpStatusCode.UnsupportedMediaType);
    }

    [Fact]
    public async Task UnknownOperationReturnsNotFound()
    {
        using var response = await _client.PostAsync("/api/json/nope", new StringContent("{}", Encoding.UTF8, "application/json"));

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task BrowserPreflightForJsonIsAllowed()
    {
        using var request = new HttpRequestMessage(HttpMethod.Options, "/api/json/rotate");
        request.Headers.Add("Origin", "https://app.example.com");
        request.Headers.Add("Access-Control-Request-Method", "POST");
        request.Headers.Add("Access-Control-Request-Headers", "content-type");

        using var response = await _client.SendAsync(request);

        response.IsSuccessStatusCode.Should().BeTrue();
        response.Headers.GetValues("Access-Control-Allow-Origin").Should().Contain("*");
    }

    [Fact]
    public async Task JsonResponsesCarryCorsHeaders()
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/json/text-to-pdf")
        {
            Content = JsonContent.Create(new { files = new[] { TextFile("cors") } })
        };
        request.Headers.Add("Origin", "https://app.example.com");

        using var response = await _client.SendAsync(request);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.Headers.GetValues("Access-Control-Allow-Origin").Should().Contain("*");
    }

    [Theory]
    [InlineData("report.docx", "report.pdf")]
    [InlineData("Q3 v2.1 FINAL.txt", "Q3 v2.1 FINAL.pdf")]
    [InlineData("C:\\Users\\me\\notes.txt", "notes.pdf")]
    [InlineData("../../etc/passwd.txt", "passwd.pdf")]
    public async Task ResultsAreNamedAfterTheUpload(string uploaded, string expected)
    {
        var isWord = uploaded.EndsWith(".docx", StringComparison.Ordinal);
        var (status, json) = await Post(isWord ? "rotate" : "any-to-pdf", new { file = new { name = uploaded, data = isWord ? await CreatePdfBase64() : Convert.ToBase64String(Encoding.UTF8.GetBytes("text")) } });

        status.Should().Be(HttpStatusCode.OK);
        json.GetProperty("fileName").GetString().Should().Be(expected);
    }

    [Fact]
    public async Task SeveralFilesAreNamedMerged()
    {
        var pdf = await CreatePdfBase64();

        var (_, json) = await Post("text-to-pdf", new { files = new[] { TextFile("one"), TextFile("two") } });

        json.GetProperty("fileName").GetString().Should().Be("merged.pdf");
        pdf.Should().NotBeEmpty();
    }

    [Fact]
    public async Task MultipartRoutesStillWork()
    {
        var form = new MultipartFormDataContent { { new ByteArrayContent(Encoding.UTF8.GetBytes("hello")), "files", "a.txt" } };

        using var response = await _client.PostAsync("/api/pdf/text-to-pdf", form);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.Content.Headers.ContentType!.MediaType.Should().Be("application/pdf");
    }

    private async Task<string> CreatePdfBase64()
    {
        var (_, json) = await Post("text-to-pdf", new { files = new[] { TextFile("hello from json") } });
        return json.GetProperty("data").GetString()!;
    }

    private static object TextFile(string text) => new { name = "note.txt", data = Convert.ToBase64String(Encoding.UTF8.GetBytes(text)) };

    private async Task<(HttpStatusCode Status, JsonElement Json)> Post(string operation, object body)
    {
        using var response = await _client.PostAsJsonAsync($"/api/json/{operation}", body);
        var text = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(text);
        return (response.StatusCode, document.RootElement.Clone());
    }
}
