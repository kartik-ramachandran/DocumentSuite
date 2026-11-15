using System.Globalization;
using System.Text.RegularExpressions;

namespace PdfAI.API.Services.Ocr;

/// <summary>Tesseract (Apache 2.0), which runs on the CPU inside the main container.</summary>
public sealed partial class TesseractOcrEngine : IOcrEngine
{
    public const string EngineName = "tesseract";
    private static readonly TimeSpan PageTimeout = TimeSpan.FromMinutes(2);
    private static readonly TimeSpan OrientationTimeout = TimeSpan.FromSeconds(45);

    private readonly PdfToolRunner _tools;

    public TesseractOcrEngine(PdfToolRunner tools)
    {
        _tools = tools;
    }

    public string Name => EngineName;
    public bool SupportsTables => false;

    public async Task<OcrResult> RecognizeAsync(byte[] png, OcrRequest request, CancellationToken cancellationToken)
    {
        if (request.Tables != OcrTableModel.None)
            throw new NotSupportedException("Tesseract can't find tables with a layout model.");
        if (!request.Words)
            return new OcrResult(EngineName, [], []);

        var tempDirectory = Directory.CreateTempSubdirectory("pdfsuite-tesseract-");
        try
        {
            var imagePath = Path.Combine(tempDirectory.FullName, "page.png");
            var outputBase = Path.Combine(tempDirectory.FullName, "page");
            await File.WriteAllBytesAsync(imagePath, png, cancellationToken);

            ToolResult result;
            try
            {
                result = await _tools.RunAsync(
                    _tools.TesseractPath,
                    [imagePath, outputBase, "--dpi", request.Dpi.ToString(CultureInfo.InvariantCulture), "-l", string.Join('+', request.Languages), "tsv"],
                    PageTimeout,
                    new Dictionary<string, string> { ["OMP_THREAD_LIMIT"] = "1" },
                    cancellationToken);
            }
            catch (ToolNotAvailableException ex)
            {
                throw new OcrEngineUnavailableException(EngineName, "Tesseract is not installed on this server.", ex);
            }

            if (result.ExitCode != 0)
            {
                var missing = MissingLanguage().Match(result.Error);
                throw new InvalidOperationException(missing.Success
                    ? $"The OCR language '{missing.Groups[1].Value}' isn't installed on this server. Install its Tesseract language pack, such as tesseract-ocr-{missing.Groups[1].Value.Replace('_', '-')}."
                    : $"Tesseract failed with exit code {result.ExitCode}. {result.Error}".Trim());
            }

            return new OcrResult(EngineName, ParseTsv(await File.ReadAllTextAsync($"{outputBase}.tsv", cancellationToken)), []);
        }
        finally
        {
            tempDirectory.Delete(true);
        }
    }

    /// <summary>
    /// Asks Tesseract which way up the page is. Returns the clockwise turn (0, 90, 180 or 270) that makes the text upright,
    /// or 0 when it can't tell, such as on a page with little text.
    /// </summary>
    public async Task<int> DetectRotationAsync(byte[] png, CancellationToken cancellationToken)
    {
        var tempDirectory = Directory.CreateTempSubdirectory("pdfsuite-osd-");
        try
        {
            var imagePath = Path.Combine(tempDirectory.FullName, "page.png");
            await File.WriteAllBytesAsync(imagePath, png, cancellationToken);
            var result = await _tools.RunAsync(
                _tools.TesseractPath,
                [imagePath, "stdout", "--psm", "0"],
                OrientationTimeout,
                new Dictionary<string, string> { ["OMP_THREAD_LIMIT"] = "1" },
                cancellationToken);
            return result.ExitCode == 0 ? ParseRotation(result.Output) : 0;
        }
        catch (ToolNotAvailableException)
        {
            return 0;
        }
        finally
        {
            tempDirectory.Delete(true);
        }
    }

    /// <summary>Reads the "Rotate" and "Orientation confidence" lines from Tesseract's orientation output.</summary>
    public static int ParseRotation(string osd)
    {
        const double minConfidence = 2;
        var rotate = RotateLine().Match(osd);
        var confidence = ConfidenceLine().Match(osd);
        if (!rotate.Success || !int.TryParse(rotate.Groups[1].Value, CultureInfo.InvariantCulture, out var degrees))
            return 0;
        if (confidence.Success && double.TryParse(confidence.Groups[1].Value, CultureInfo.InvariantCulture, out var value) && value < minConfidence)
            return 0;
        return degrees is 90 or 180 or 270 ? degrees : 0;
    }

    /// <summary>Converts Tesseract's TSV output to words in pixels. Words on one line share a line key.</summary>
    public static List<OcrWord> ParseTsv(string tsv)
    {
        const string wordLevel = "5";
        var words = new List<OcrWord>();

        foreach (var row in tsv.Split('\n').Skip(1))
        {
            var fields = row.TrimEnd('\r').Split('\t');
            if (fields.Length < 12
                || fields[0] != wordLevel
                || string.IsNullOrWhiteSpace(fields[11])
                || !double.TryParse(fields[10], CultureInfo.InvariantCulture, out var confidence)
                || confidence < 0)
            {
                continue;
            }

            words.Add(new OcrWord(
                fields[11].Trim(),
                double.Parse(fields[6], CultureInfo.InvariantCulture),
                double.Parse(fields[7], CultureInfo.InvariantCulture),
                double.Parse(fields[8], CultureInfo.InvariantCulture),
                double.Parse(fields[9], CultureInfo.InvariantCulture),
                Math.Clamp(confidence / 100, 0, 1),
                $"{fields[2]}.{fields[3]}.{fields[4]}"));
        }

        return words;
    }

    [GeneratedRegex(@"Failed loading language '([^']+)'")]
    private static partial Regex MissingLanguage();

    [GeneratedRegex(@"Rotate:\s*(\d+)")]
    private static partial Regex RotateLine();

    [GeneratedRegex(@"Orientation confidence:\s*([\d.]+)")]
    private static partial Regex ConfidenceLine();
}
