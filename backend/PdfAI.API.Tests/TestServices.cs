using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Moq;
using PdfAI.API.Services;
using PdfAI.API.Services.Ocr;

namespace PdfAI.API.Tests;

internal static class TestServices
{
    public static IConfiguration EmptyConfiguration() => new ConfigurationBuilder().Build();

    public static IConfiguration Configuration(params (string Key, string Value)[] values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values.Select(value => new KeyValuePair<string, string?>(value.Key, value.Value))).Build();

    /// <summary>The OCR service with the given engines, or the real Tesseract and sidecar engines when none are given.</summary>
    public static OcrService CreateOcrService(IConfiguration? configuration = null, params IOcrEngine[] engines)
    {
        var config = configuration ?? EmptyConfiguration();
        var tools = new PdfToolRunner(config);
        IOcrEngine[] chosen = engines.Length > 0 ? engines : [new TesseractOcrEngine(tools), new SidecarOcrEngine(new HttpClient(), config)];
        return new OcrService(chosen, tools, config, Mock.Of<ILogger<OcrService>>());
    }

    public static PdfLayoutService CreateLayoutService(IConfiguration? configuration = null, params IOcrEngine[] engines)
    {
        var config = configuration ?? EmptyConfiguration();
        return new PdfLayoutService(new PdfToolRunner(config), CreateOcrService(config, engines), Mock.Of<ILogger<PdfLayoutService>>());
    }

    public static PdfToolkitService CreateToolkit(IConfiguration? configuration = null, params IOcrEngine[] engines)
    {
        var config = configuration ?? EmptyConfiguration();
        return new PdfToolkitService(CreateLayoutService(config, engines), new PdfToolRunner(config), Mock.Of<ILogger<PdfToolkitService>>());
    }

    public static PdfProcessingService CreateProcessingService(IConfiguration? configuration = null, params IOcrEngine[] engines)
    {
        var config = configuration ?? EmptyConfiguration();
        var tools = new PdfToolRunner(config);
        var layout = CreateLayoutService(config, engines);
        var conversion = new DocumentConversionService(
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

/// <summary>An OCR engine that returns whatever the test says, for any image.</summary>
internal sealed class FakeOcrEngine(string name, Func<byte[], OcrRequest, OcrResult> recognize, bool supportsTables = false) : IOcrEngine
{
    public List<OcrRequest> Requests { get; } = [];
    public string Name { get; } = name;
    public bool SupportsTables { get; } = supportsTables;

    public Task<OcrResult> RecognizeAsync(byte[] png, OcrRequest request, CancellationToken cancellationToken)
    {
        lock (Requests)
            Requests.Add(request);
        return Task.FromResult(recognize(png, request));
    }

    public static FakeOcrEngine Tesseract(params OcrWord[] words) =>
        new(TesseractOcrEngine.EngineName, (_, _) => new OcrResult(TesseractOcrEngine.EngineName, words, []));
}
