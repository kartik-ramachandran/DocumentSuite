using System.Net;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Moq;
using PdfAI.API.Services;

namespace PdfAI.API.Tests;

public class ViewerApiTests : IClassFixture<WebApplicationFactory<Program>>
{
    private const string Route = "/api/pdf/viewer/documents";
    private readonly HttpClient _client;

    public ViewerApiTests(WebApplicationFactory<Program> factory)
    {
        _client = factory.CreateClient();
    }

    [Fact]
    public async Task Upload_ConvertsNonPdfFilesAndReportsPageSizes()
    {
        var document = await Upload("hello viewer");

        document.GetProperty("id").GetString().Should().HaveLength(64);
        document.GetProperty("pageCount").GetInt32().Should().Be(1);
        document.GetProperty("pages")[0].GetProperty("width").GetDouble().Should().BeGreaterThan(0);
    }

    [Fact]
    public async Task Text_ReturnsPositionedWords()
    {
        var id = (await Upload("hello viewer")).GetProperty("id").GetString();

        using var response = await _client.GetAsync($"{Route}/{id}/pages/1/text");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var words = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
        words.EnumerateArray().Select(word => word.GetProperty("text").GetString()).Should().Contain("hello");
        words[0].GetProperty("width").GetDouble().Should().BeGreaterThan(0);
    }

    [Fact]
    public async Task File_ReturnsThePdf_AndDeleteRemovesIt()
    {
        var id = (await Upload("hello viewer")).GetProperty("id").GetString();

        using var file = await _client.GetAsync($"{Route}/{id}/file");
        file.Content.Headers.ContentType!.MediaType.Should().Be("application/pdf");

        using var deleted = await _client.DeleteAsync($"{Route}/{id}");
        deleted.StatusCode.Should().Be(HttpStatusCode.NoContent);

        using var gone = await _client.GetAsync($"{Route}/{id}/file");
        gone.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Theory]
    [InlineData("does-not-exist")]
    [InlineData("..%2F..%2Fetc%2Fpasswd")]
    public async Task UnknownIds_AreNotFound(string id)
    {
        using var response = await _client.GetAsync($"{Route}/{id}/file");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Theory]
    [InlineData("pages/99", HttpStatusCode.NotFound)]
    [InlineData("pages/0", HttpStatusCode.NotFound)]
    [InlineData("pages/1?dpi=9000", HttpStatusCode.BadRequest)]
    [InlineData("pages/1?dpi=1", HttpStatusCode.BadRequest)]
    public async Task BadPageRequests_AreRejected(string path, HttpStatusCode expected)
    {
        var id = (await Upload("hello viewer")).GetProperty("id").GetString();

        using var response = await _client.GetAsync($"{Route}/{id}/{path}");

        response.StatusCode.Should().Be(expected);
    }

    [Fact]
    public async Task Upload_AlsoWorksThroughTheJsonApi()
    {
        var body = JsonSerializer.Serialize(new { file = new { name = "a.txt", data = Convert.ToBase64String(Encoding.UTF8.GetBytes("json upload")) } });

        using var response = await _client.PostAsync("/api/json/viewer/documents", new StringContent(body, Encoding.UTF8, "application/json"));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.GetProperty("pageCount").GetInt32().Should().Be(1);
    }

    [Fact]
    public async Task ToPdf_ReturnsAPdfForAnySupportedFile()
    {
        var form = new MultipartFormDataContent { { new ByteArrayContent(Encoding.UTF8.GetBytes("any file")), "file", "note.txt" } };

        using var response = await _client.PostAsync("/api/pdf/any-to-pdf", form);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        Encoding.ASCII.GetString(await response.Content.ReadAsByteArrayAsync(), 0, 4).Should().Be("%PDF");
    }

    [Fact]
    public async Task Store_RemovesIdleDocuments_AndKeepsRecentOnes()
    {
        using var store = CreateStore(maxDocuments: 10, lifetimeMinutes: 30);
        var oldDocument = await store.AddAsync([1], [], CancellationToken.None);
        var recentDocument = await store.AddAsync([2], [], CancellationToken.None);
        oldDocument.LastUsed = DateTimeOffset.UtcNow.AddHours(-1);

        store.RemoveExpired(DateTimeOffset.UtcNow).Should().Be(1);

        store.Find(oldDocument.Id).Should().BeNull();
        File.Exists(oldDocument.Path).Should().BeFalse();
        store.Find(recentDocument.Id).Should().NotBeNull();
    }

    [Fact]
    public async Task Store_EvictsLeastRecentlyUsedAtTheLimit()
    {
        using var store = CreateStore(maxDocuments: 2, lifetimeMinutes: 30);
        var first = await store.AddAsync([1], [], CancellationToken.None);
        first.LastUsed = DateTimeOffset.UtcNow.AddMinutes(-5);
        var second = await store.AddAsync([2], [], CancellationToken.None);
        var third = await store.AddAsync([3], [], CancellationToken.None);

        store.Count.Should().Be(2);
        store.Find(first.Id).Should().BeNull();
        store.Find(second.Id).Should().NotBeNull();
        store.Find(third.Id).Should().NotBeNull();
    }

    private static ViewerDocumentStore CreateStore(int maxDocuments, int lifetimeMinutes)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Viewer:MaxDocuments"] = maxDocuments.ToString(),
            ["Viewer:DocumentLifetimeMinutes"] = lifetimeMinutes.ToString()
        }).Build();
        return new ViewerDocumentStore(configuration, Mock.Of<ILogger<ViewerDocumentStore>>());
    }

    private async Task<JsonElement> Upload(string text)
    {
        var form = new MultipartFormDataContent { { new ByteArrayContent(Encoding.UTF8.GetBytes(text)), "file", "note.txt" } };
        using var response = await _client.PostAsync(Route, form);
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.Clone();
    }
}
