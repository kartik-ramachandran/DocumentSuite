using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using UglyToad.PdfPig;

namespace PdfAI.API.Services;

public sealed class ToolNotAvailableException(string tool, Exception inner)
    : InvalidOperationException($"{tool} is not installed or could not be started.", inner);

public readonly record struct ToolResult(int ExitCode, string Output, string Error);

/// <summary>Runs the external command-line tools (Poppler, Tesseract, qpdf) with a timeout and cancellation.</summary>
public class PdfToolRunner
{
    private static readonly TimeSpan DefaultTimeout = TimeSpan.FromMinutes(5);
    private const int MinPagesForParallelRender = 8;

    private readonly IConfiguration _configuration;

    public PdfToolRunner(IConfiguration configuration)
    {
        _configuration = configuration;
    }

    public string TesseractPath => ResolveTool("Tools:Tesseract:Path", "tesseract");
    public string QpdfPath => ResolveTool("Tools:Qpdf:Path", "qpdf");
    private string PdfToPpmPath => ResolveTool("Tools:Poppler:PdfToPpmPath", "pdftoppm");

    public async Task<ToolResult> RunAsync(
        string executable,
        IEnumerable<string> arguments,
        TimeSpan? timeout = null,
        IReadOnlyDictionary<string, string>? environment = null,
        CancellationToken cancellationToken = default)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = executable,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false
        };
        foreach (var argument in arguments)
            startInfo.ArgumentList.Add(argument);
        if (environment is not null)
        {
            foreach (var (key, value) in environment)
                startInfo.Environment[key] = value;
        }

        Process process;
        try
        {
            process = Process.Start(startInfo) ?? throw new InvalidOperationException($"Could not start {executable}.");
        }
        catch (Win32Exception ex)
        {
            throw new ToolNotAvailableException(executable, ex);
        }

        using (process)
        {
            using var timeoutSource = new CancellationTokenSource(timeout ?? DefaultTimeout);
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutSource.Token);

            // Both streams are drained concurrently so a chatty tool can't block on a full pipe.
            var output = process.StandardOutput.ReadToEndAsync(CancellationToken.None);
            var error = process.StandardError.ReadToEndAsync(CancellationToken.None);

            try
            {
                await process.WaitForExitAsync(linked.Token);
            }
            catch (OperationCanceledException)
            {
                process.Kill(entireProcessTree: true);
                cancellationToken.ThrowIfCancellationRequested();
                throw new TimeoutException($"{Path.GetFileName(executable)} did not finish within {(timeout ?? DefaultTimeout).TotalSeconds:0} seconds.");
            }

            return new ToolResult(process.ExitCode, await output, await error);
        }
    }

    public async Task RunCheckedAsync(
        string executable,
        IEnumerable<string> arguments,
        TimeSpan? timeout = null,
        IReadOnlyDictionary<string, string>? environment = null,
        CancellationToken cancellationToken = default)
    {
        var result = await RunAsync(executable, arguments, timeout, environment, cancellationToken);
        if (result.ExitCode != 0)
            throw new InvalidOperationException($"{Path.GetFileName(executable)} failed with exit code {result.ExitCode}. {result.Error}".Trim());
    }

    /// <summary>Renders every page, using one pdftoppm process per core for longer documents.</summary>
    public async Task<List<byte[]>> RenderPagesAsync(byte[] pdfBytes, string format, int dpi, CancellationToken cancellationToken = default)
    {
        var isJpeg = format.Equals("jpg", StringComparison.OrdinalIgnoreCase) || format.Equals("jpeg", StringComparison.OrdinalIgnoreCase);
        var extension = isJpeg ? "jpg" : "png";
        var tempDirectory = Directory.CreateTempSubdirectory("pdfsuite-render-");

        try
        {
            var inputPath = Path.Combine(tempDirectory.FullName, "input.pdf");
            var outputPrefix = Path.Combine(tempDirectory.FullName, "page");
            await File.WriteAllBytesAsync(inputPath, pdfBytes, cancellationToken);

            var options = new ParallelOptions { MaxDegreeOfParallelism = Environment.ProcessorCount, CancellationToken = cancellationToken };
            await Parallel.ForEachAsync(GetRenderRanges(pdfBytes), options, async (range, token) =>
            {
                var arguments = new List<string> { isJpeg ? "-jpeg" : "-png", "-r", Invariant(dpi) };
                if (isJpeg)
                    arguments.AddRange(["-jpegopt", "quality=85"]);
                if (range is { } pages)
                    arguments.AddRange(["-f", Invariant(pages.First), "-l", Invariant(pages.Last)]);
                arguments.AddRange([inputPath, outputPrefix]);
                await RunCheckedAsync(PdfToPpmPath, arguments, cancellationToken: token);
            });

            return Directory.GetFiles(tempDirectory.FullName, $"page-*.{extension}")
                .OrderBy(path => path, StringComparer.OrdinalIgnoreCase)
                .Select(File.ReadAllBytes)
                .ToList();
        }
        finally
        {
            tempDirectory.Delete(true);
        }
    }

    /// <summary>Renders one page, or a region of it when <paramref name="region"/> is set (in points, top-left origin).</summary>
    public async Task<byte[]> RenderPageAsync(
        string pdfPath,
        int pageNumber,
        string format,
        int dpi,
        (double Left, double Top, double Width, double Height)? region = null,
        CancellationToken cancellationToken = default)
    {
        var isJpeg = format.Equals("jpg", StringComparison.OrdinalIgnoreCase);
        var tempDirectory = Directory.CreateTempSubdirectory("pdfsuite-page-");

        try
        {
            var outputPrefix = Path.Combine(tempDirectory.FullName, "page");
            var arguments = new List<string>
            {
                isJpeg ? "-jpeg" : "-png", "-r", Invariant(dpi), "-f", Invariant(pageNumber), "-l", Invariant(pageNumber), "-singlefile"
            };
            if (region is { } r)
            {
                var scale = dpi / 72d;
                arguments.AddRange([
                    "-x", Invariant((int)Math.Floor(r.Left * scale)),
                    "-y", Invariant((int)Math.Floor(r.Top * scale)),
                    "-W", Invariant((int)Math.Ceiling(r.Width * scale)),
                    "-H", Invariant((int)Math.Ceiling(r.Height * scale))
                ]);
            }

            arguments.AddRange([pdfPath, outputPrefix]);
            await RunCheckedAsync(PdfToPpmPath, arguments, cancellationToken: cancellationToken);
            return await File.ReadAllBytesAsync($"{outputPrefix}.{(isJpeg ? "jpg" : "png")}", cancellationToken);
        }
        finally
        {
            tempDirectory.Delete(true);
        }
    }

    private static IEnumerable<(int First, int Last)?> GetRenderRanges(byte[] pdfBytes)
    {
        int pageCount;
        try
        {
            using var document = PdfDocument.Open(pdfBytes);
            pageCount = document.NumberOfPages;
        }
        catch (Exception)
        {
            // PdfPig can't read this file (e.g. it is encrypted), so let pdftoppm handle or reject it as one job.
            return [null];
        }

        if (pageCount < MinPagesForParallelRender || Environment.ProcessorCount == 1)
            return [null];

        var rangeSize = Math.Max(1, (int)Math.Ceiling(pageCount / (double)Environment.ProcessorCount));
        return Enumerable.Range(0, (pageCount + rangeSize - 1) / rangeSize)
            .Select(index => ((int First, int Last)?)(index * rangeSize + 1, Math.Min((index + 1) * rangeSize, pageCount)))
            .ToList();
    }

    // A configured path that doesn't exist on this machine (such as a Windows path inside
    // a Linux container) falls back to finding the tool on PATH.
    private string ResolveTool(string configurationKey, string toolName)
    {
        var configured = _configuration[configurationKey];
        return !string.IsNullOrWhiteSpace(configured) && File.Exists(configured) ? configured : toolName;
    }

    private static string Invariant(int value) => value.ToString(CultureInfo.InvariantCulture);
}
