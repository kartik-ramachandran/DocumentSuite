using PdfSharp.Pdf;
using PdfSharp.Pdf.Advanced;
using PdfSharp.Pdf.IO;
using SkiaSharp;

namespace PdfAI.API.Services;

/// <summary>Shrinks PDFs by re-encoding images and optimising structure. The result is never larger than the input.</summary>
public class PdfCompressionService
{
    private sealed record Profile(int JpegQuality, int MaxDpi);

    private static readonly Dictionary<string, Profile> Profiles = new(StringComparer.OrdinalIgnoreCase)
    {
        ["less"] = new Profile(80, 200),
        ["recommended"] = new Profile(65, 144),
        ["extreme"] = new Profile(40, 96)
    };

    private const double MinImageSavings = 0.9; // keep the original image unless the new one is at least 10% smaller
    private static readonly TimeSpan QpdfTimeout = TimeSpan.FromMinutes(3);

    private readonly PdfToolRunner _tools;
    private readonly ILogger<PdfCompressionService> _logger;

    public PdfCompressionService(PdfToolRunner tools, ILogger<PdfCompressionService> logger)
    {
        _tools = tools;
        _logger = logger;
    }

    public async Task<byte[]> CompressAsync(byte[] pdfBytes, string quality = "recommended", CancellationToken cancellationToken = default)
    {
        if (!Profiles.TryGetValue(quality, out var profile))
            throw new ArgumentException($"Unknown compression quality '{quality}'. Use less, recommended or extreme.", nameof(quality));

        var recompressed = RecompressImages(pdfBytes, profile);
        var optimized = await OptimizeStructureAsync(recompressed, cancellationToken);

        return new[] { pdfBytes, recompressed, optimized }.MinBy(candidate => candidate.Length)!;
    }

    private byte[] RecompressImages(byte[] pdfBytes, Profile profile)
    {
        using var input = new MemoryStream(pdfBytes);
        using var document = PdfReader.Open(input, PdfDocumentOpenMode.Modify);
        document.Options.CompressContentStreams = true;
        document.Options.NoCompression = false;
        document.Options.FlateEncodeMode = PdfFlateEncodeMode.BestCompression;

        var longestPageInches = document.Pages.Cast<PdfPage>().Max(page => Math.Max(page.Width.Point, page.Height.Point)) / 72d;
        var maxPixels = (int)Math.Ceiling(longestPageInches * profile.MaxDpi);

        foreach (var image in document.Internals.GetAllObjects().OfType<PdfDictionary>().Where(IsImage))
        {
            try
            {
                RecompressImage(image, profile, maxPixels);
            }
            catch (Exception ex)
            {
                // Leaving one image unchanged is always safe, so the rest of the file still gets compressed.
                _logger.LogDebug(ex, "Skipped an image during compression");
            }
        }

        using var output = new MemoryStream();
        document.Save(output);
        return output.ToArray();
    }

    private static bool IsImage(PdfDictionary dictionary) =>
        dictionary.Stream is not null && dictionary.Elements.GetName("/Subtype") == "/Image";

    private static void RecompressImage(PdfDictionary image, Profile profile, int maxPixels)
    {
        using var bitmap = DecodeImage(image);
        if (bitmap is null)
            return;

        var scale = Math.Min(1d, maxPixels / (double)Math.Max(bitmap.Width, bitmap.Height));
        var width = Math.Max(1, (int)Math.Round(bitmap.Width * scale));
        var height = Math.Max(1, (int)Math.Round(bitmap.Height * scale));

        using var resized = scale < 1
            ? bitmap.Resize(new SKImageInfo(width, height, SKColorType.Rgba8888, SKAlphaType.Opaque), new SKSamplingOptions(SKCubicResampler.Mitchell))
            : null;
        using var encoded = (resized ?? bitmap).Encode(SKEncodedImageFormat.Jpeg, profile.JpegQuality);
        if (encoded is null || encoded.Size >= image.Stream.Length * MinImageSavings)
            return;

        image.Stream.Value = encoded.ToArray();
        image.Elements.SetInteger("/Length", image.Stream.Value.Length);
        image.Elements.SetInteger("/Width", width);
        image.Elements.SetInteger("/Height", height);
        image.Elements.SetInteger("/BitsPerComponent", 8);
        image.Elements.SetName("/ColorSpace", "/DeviceRGB");
        image.Elements.SetName("/Filter", "/DCTDecode");
        image.Elements.Remove("/DecodeParms");
    }

    // Returns null for images that can't be re-encoded without risking a change in appearance:
    // stencil masks, inverted or indexed colour, CMYK, and formats such as JBIG2 or JPEG 2000.
    private static SKBitmap? DecodeImage(PdfDictionary image)
    {
        var elements = image.Elements;
        if (elements.GetBoolean("/ImageMask") || elements.ContainsKey("/Decode") || elements.ContainsKey("/Mask"))
            return null;

        var components = GetComponentCount(elements.GetObject("/ColorSpace") ?? elements.GetValue("/ColorSpace"));
        if (components is not (1 or 3))
            return null;

        var filter = GetSingleFilter(image);
        if (filter == "/DCTDecode")
            return SKBitmap.Decode(image.Stream.Value);
        if (filter is not ("/FlateDecode" or null) || elements.GetInteger("/BitsPerComponent") != 8)
            return null;

        var width = elements.GetInteger("/Width");
        var height = elements.GetInteger("/Height");
        var raw = image.Stream.UnfilteredValue;
        if (width <= 0 || height <= 0 || raw.Length != (long)width * height * components)
            return null;

        var bitmap = new SKBitmap(new SKImageInfo(width, height, SKColorType.Rgba8888, SKAlphaType.Opaque));
        var pixels = bitmap.GetPixelSpan();
        for (int source = 0, target = 0; target < pixels.Length; target += 4, source += components)
        {
            pixels[target] = raw[source];
            pixels[target + 1] = raw[components == 3 ? source + 1 : source];
            pixels[target + 2] = raw[components == 3 ? source + 2 : source];
            pixels[target + 3] = 255;
        }

        return bitmap;
    }

    private static string? GetSingleFilter(PdfDictionary image)
    {
        var filter = image.Elements.GetValue("/Filter");
        if (filter is PdfReference reference)
            filter = reference.Value;
        return filter switch
        {
            null => null,
            PdfName name => name.Value,
            PdfArray { Elements.Count: 1 } array => array.Elements.GetName(0),
            _ => "unsupported"
        };
    }

    private static int GetComponentCount(PdfItem? colorSpace)
    {
        if (colorSpace is PdfReference reference)
            colorSpace = reference.Value;

        switch (colorSpace)
        {
            case PdfName name:
                return name.Value switch { "/DeviceRGB" => 3, "/DeviceGray" => 1, _ => 0 };
            case PdfArray { Elements.Count: >= 2 } array when array.Elements.GetName(0) == "/ICCBased":
                return array.Elements.GetDictionary(1)?.Elements.GetInteger("/N") ?? 0;
            default:
                return 0;
        }
    }

    private async Task<byte[]> OptimizeStructureAsync(byte[] pdfBytes, CancellationToken cancellationToken)
    {
        var tempDirectory = Directory.CreateTempSubdirectory("pdfforge-qpdf-");
        try
        {
            var inputPath = Path.Combine(tempDirectory.FullName, "input.pdf");
            var outputPath = Path.Combine(tempDirectory.FullName, "output.pdf");
            await File.WriteAllBytesAsync(inputPath, pdfBytes, cancellationToken);

            var result = await _tools.RunAsync(
                _tools.QpdfPath,
                ["--object-streams=generate", "--compress-streams=y", "--recompress-flate", "--compression-level=9", inputPath, outputPath],
                QpdfTimeout,
                cancellationToken: cancellationToken);

            // qpdf exit code 3 means it succeeded with warnings.
            if (result.ExitCode is 0 or 3 && File.Exists(outputPath))
                return await File.ReadAllBytesAsync(outputPath, cancellationToken);

            _logger.LogWarning("qpdf exited with {Code}: {Error}", result.ExitCode, result.Error);
            return pdfBytes;
        }
        catch (ToolNotAvailableException ex)
        {
            _logger.LogWarning(ex, "qpdf is unavailable, so structural optimisation was skipped");
            return pdfBytes;
        }
        finally
        {
            tempDirectory.Delete(true);
        }
    }
}
