using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Moq;
using PdfAI.API.Services;

namespace PdfAI.API.Tests;

internal static class TestServices
{
    public static IConfiguration EmptyConfiguration() => new ConfigurationBuilder().Build();

    public static PdfProcessingService CreateProcessingService(IConfiguration? configuration = null)
    {
        var config = configuration ?? EmptyConfiguration();
        var tools = new PdfToolRunner(config);
        var layout = new PdfLayoutService(tools, Mock.Of<ILogger<PdfLayoutService>>());
        var conversion = new DocumentConversionService(
            new DocumentExtractionService(),
            config,
            Mock.Of<ILogger<DocumentConversionService>>(),
            tools,
            layout);

        return new PdfProcessingService(
            conversion,
            layout,
            new PdfCompressionService(tools, Mock.Of<ILogger<PdfCompressionService>>()),
            Mock.Of<ILogger<PdfProcessingService>>());
    }
}
