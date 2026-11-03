using FluentAssertions;
using Microsoft.Extensions.Logging;
using Moq;
using PdfAI.API.Services;
using PdfSharp.Drawing;
using PdfSharp.Pdf;
using SkiaSharp;

namespace PdfAI.API.Tests;

public class PdfCompressionServiceTests
{
    private readonly PdfCompressionService _service = new(
        new PdfToolRunner(TestServices.EmptyConfiguration()),
        Mock.Of<ILogger<PdfCompressionService>>());

    [Fact]
    public async Task Compress_NeverReturnsALargerFile()
    {
        var pdf = CreatePdfWithImage(16);

        var result = await _service.CompressAsync(pdf, "less");

        result.Length.Should().BeLessThanOrEqualTo(pdf.Length);
    }

    [Fact]
    public async Task Compress_LowerQualityProducesSmallerFilesOnImages()
    {
        var pdf = CreatePdfWithImage(1600);

        var less = await _service.CompressAsync(pdf, "less");
        var extreme = await _service.CompressAsync(pdf, "extreme");

        less.Length.Should().BeLessThan(pdf.Length);
        extreme.Length.Should().BeLessThan(less.Length);
        using var stream = new MemoryStream(extreme);
        PdfSharp.Pdf.IO.PdfReader.Open(stream, PdfSharp.Pdf.IO.PdfDocumentOpenMode.Import).PageCount.Should().Be(1);
    }

    [Fact]
    public async Task Compress_RejectsUnknownQuality()
    {
        var act = () => _service.CompressAsync(CreatePdfWithImage(16), "ultra");

        await act.Should().ThrowAsync<ArgumentException>().WithMessage("*less, recommended or extreme*");
    }

    private static byte[] CreatePdfWithImage(int side)
    {
        var random = new Random(7);
        using var bitmap = new SKBitmap(side, side);
        for (var y = 0; y < side; y++)
        {
            for (var x = 0; x < side; x++)
                bitmap.SetPixel(x, y, new SKColor((byte)(x * 255 / side), (byte)(y * 255 / side), (byte)random.Next(256)));
        }

        using var encoded = bitmap.Encode(SKEncodedImageFormat.Jpeg, 98);
        using var document = new PdfDocument();
        var page = document.AddPage();
        using (var graphics = XGraphics.FromPdfPage(page))
        using (var imageStream = new MemoryStream(encoded.ToArray(), 0, (int)encoded.Size, false, publiclyVisible: true))
        using (var image = XImage.FromStream(imageStream))
        {
            graphics.DrawImage(image, 0, 0, page.Width.Point, page.Height.Point);
        }

        using var output = new MemoryStream();
        document.Save(output);
        return output.ToArray();
    }
}
