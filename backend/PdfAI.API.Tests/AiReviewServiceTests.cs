using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Moq;
using PdfAI.API.Models;
using PdfAI.API.Services;

namespace PdfAI.API.Tests;

public class AiReviewServiceTests
{
    [Fact]
    public async Task ReviewAsync_ShouldThrow_WhenNotConfigured()
    {
        var config = new ConfigurationBuilder().Build(); // no AzureOpenAI keys
        var service = new AiReviewService(config, Mock.Of<ILogger<AiReviewService>>());

        var act = () => service.ReviewAsync(new DocumentReviewRequest("test.pdf", 1, "some text"));
        await act.Should().ThrowAsync<InvalidOperationException>()
            .WithMessage("*Azure OpenAI*");
    }

    [Fact]
    public async Task ReviewAsync_ShouldThrow_WhenEndpointMissingApiKey()
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["AzureOpenAI:Endpoint"] = "https://example.openai.azure.com/",
                ["AzureOpenAI:ApiKey"] = "" // empty key
            })
            .Build();

        var service = new AiReviewService(config, Mock.Of<ILogger<AiReviewService>>());

        var act = () => service.ReviewAsync(new DocumentReviewRequest("test.pdf", 1, "some text"));
        await act.Should().ThrowAsync<InvalidOperationException>();
    }
}
