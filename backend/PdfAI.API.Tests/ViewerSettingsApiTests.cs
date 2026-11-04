using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace PdfAI.API.Tests;

public sealed class ViewerSettingsApiTests : IClassFixture<WebApplicationFactory<Program>>, IDisposable
{
    private const string Route = "/api/settings";
    private readonly WebApplicationFactory<Program> _factory;
    private readonly string _folder = Path.Combine(Path.GetTempPath(), $"viewer-settings-{Guid.NewGuid():N}");

    public ViewerSettingsApiTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory;
    }

    public void Dispose()
    {
        if (Directory.Exists(_folder)) Directory.Delete(_folder, recursive: true);
    }

    private HttpClient CreateClient(string environment = "Development", string? writeKey = null) =>
        _factory.WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment(environment);
            builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Settings:Path"] = _folder,
                ["Settings:WriteKey"] = writeKey,
            }));
        }).CreateClient();

    private static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");

    [Fact]
    public async Task Get_ReturnsAnEmptyObject_WhenNothingIsSaved()
    {
        using var response = await CreateClient().GetAsync($"{Route}/nothing-here");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await response.Content.ReadAsStringAsync()).Should().Be("{}");
        response.Headers.CacheControl!.NoStore.Should().BeTrue();
    }

    [Fact]
    public async Task Put_SavesSettings_AndAFreshInstanceReadsThem()
    {
        using var put = await CreateClient().PutAsync($"{Route}/team-a", Json("""{"clickAction":"menu","allowRename":true,"initialZoom":1.5}"""));
        put.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var saved = JsonDocument.Parse(await CreateClient().GetStringAsync($"{Route}/team-a")).RootElement;

        saved.GetProperty("clickAction").GetString().Should().Be("menu");
        saved.GetProperty("allowRename").GetBoolean().Should().BeTrue();
        saved.GetProperty("initialZoom").GetDouble().Should().Be(1.5);
    }

    [Fact]
    public async Task Scopes_AreSeparate()
    {
        var client = CreateClient();
        await client.PutAsync($"{Route}/one", Json("""{"theme":"dark"}"""));
        await client.PutAsync($"{Route}/two", Json("""{"theme":"light"}"""));

        (await client.GetStringAsync($"{Route}/one")).Should().Contain("dark");
        (await client.GetStringAsync($"{Route}/two")).Should().Contain("light");
    }

    [Fact]
    public async Task Put_ReplacesEverythingSavedBefore()
    {
        var client = CreateClient();
        await client.PutAsync($"{Route}/replace", Json("""{"theme":"dark"}"""));
        await client.PutAsync($"{Route}/replace", Json("""{"allowRename":true}"""));

        (await client.GetStringAsync($"{Route}/replace")).Should().Be("""{"allowRename":true}""");
        Directory.GetFiles(_folder).Should().ContainSingle("no temporary files should be left behind");
    }

    [Fact]
    public async Task Delete_RemovesSettings()
    {
        var client = CreateClient();
        await client.PutAsync($"{Route}/gone", Json("""{"theme":"dark"}"""));

        using var delete = await client.DeleteAsync($"{Route}/gone");

        delete.StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await client.GetStringAsync($"{Route}/gone")).Should().Be("{}");
    }

    [Theory]
    [InlineData("[1,2]")]
    [InlineData("\"text\"")]
    [InlineData("""{"nested":{"a":1}}""")]
    [InlineData("""{"list":[1]}""")]
    [InlineData("{not json")]
    public async Task Put_RejectsAnythingButAFlatObject(string body)
    {
        using var response = await CreateClient().PutAsync($"{Route}/bad-body", Json(body));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        Directory.Exists(_folder).Should().BeFalse();
    }

    [Fact]
    public async Task Put_RejectsOtherContentTypes()
    {
        using var response = await CreateClient().PutAsync($"{Route}/plain", new StringContent("""{"theme":"dark"}""", Encoding.UTF8, "text/plain"));

        response.StatusCode.Should().Be(HttpStatusCode.UnsupportedMediaType);
    }

    [Theory]
    [InlineData("a.b")]
    [InlineData("..%2F..%2Fescape")]
    [InlineData("..%5Cescape")]
    [InlineData("has%20space")]
    public async Task Scopes_ThatCouldLeaveTheFolder_AreRejected(string scope)
    {
        var client = CreateClient();

        using var put = await client.PutAsync($"{Route}/{scope}", Json("""{"theme":"dark"}"""));
        using var get = await client.GetAsync($"{Route}/{scope}");

        put.IsSuccessStatusCode.Should().BeFalse();
        get.IsSuccessStatusCode.Should().BeFalse();
        Directory.Exists(_folder).Should().BeFalse();
    }

    [Fact]
    public async Task Scopes_LongerThanTheLimit_AreRejected()
    {
        using var response = await CreateClient().GetAsync($"{Route}/{new string('a', 65)}");

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Put_RejectsOversizedBodies()
    {
        var huge = $$"""{"value":"{{new string('a', 70_000)}}"}""";

        using var response = await CreateClient().PutAsync($"{Route}/huge", Json(huge));

        response.StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge);
        Directory.Exists(_folder).Should().BeFalse();
    }

    [Fact]
    public async Task Production_WithNoKey_RefusesChanges_ButStillReads()
    {
        var client = CreateClient("Production");

        using var put = await client.PutAsync($"{Route}/locked", Json("""{"theme":"dark"}"""));
        using var delete = await client.DeleteAsync($"{Route}/locked");
        using var get = await client.GetAsync($"{Route}/locked");

        put.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        delete.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        get.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Theory]
    [InlineData("Development")]
    [InlineData("Production")]
    public async Task WriteKey_IsRequired_WhenSet(string environment)
    {
        var client = CreateClient(environment, "the-right-key");

        using var missing = await client.PutAsync($"{Route}/keyed", Json("""{"theme":"dark"}"""));
        missing.StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        using var wrong = new HttpRequestMessage(HttpMethod.Put, $"{Route}/keyed") { Content = Json("""{"theme":"dark"}""") };
        wrong.Headers.Authorization = new AuthenticationHeaderValue("Bearer", "the-wrong-key");
        (await client.SendAsync(wrong)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        using var right = new HttpRequestMessage(HttpMethod.Put, $"{Route}/keyed") { Content = Json("""{"theme":"dark"}""") };
        right.Headers.Authorization = new AuthenticationHeaderValue("Bearer", "the-right-key");
        (await client.SendAsync(right)).StatusCode.Should().Be(HttpStatusCode.NoContent);
    }
}
