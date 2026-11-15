using System.Text.RegularExpressions;

namespace PdfAI.API.Services.Ocr;

/// <summary>A recognised word. Positions are in pixels of the image the engine was given, from the top-left.</summary>
/// <param name="Confidence">From 0 to 1.</param>
/// <param name="Line">Words with the same value are on the same line, when the engine reports lines.</param>
public sealed record OcrWord(string Text, double Left, double Top, double Width, double Height, double Confidence, string? Line = null);

/// <summary>A table found by a layout model, in pixels of the image. Each row lists its cells' text.</summary>
public sealed record OcrTable(double Left, double Top, double Width, double Height, IReadOnlyList<IReadOnlyList<string>> Rows);

public sealed record OcrResult(string Engine, IReadOnlyList<OcrWord> Words, IReadOnlyList<OcrTable> Tables);

/// <summary>What to ask an engine for.</summary>
/// <param name="Languages">Tesseract-style codes such as eng or chi_sim. Sidecar engines map them to their own.</param>
/// <param name="Words">Recognise the words and where they are.</param>
/// <param name="Tables">The layout model that finds tables, or <see cref="OcrTableModel.None"/>.</param>
public sealed record OcrRequest(IReadOnlyList<string> Languages, int Dpi, bool Words, OcrTableModel Tables);

/// <summary>An OCR engine. Engines only read images, so rendering, straightening and checking happen in <see cref="OcrService"/>.</summary>
public interface IOcrEngine
{
    /// <summary>The name used in settings and requests, such as "tesseract".</summary>
    string Name { get; }

    /// <summary>Whether the engine can find tables with a layout model.</summary>
    bool SupportsTables { get; }

    Task<OcrResult> RecognizeAsync(byte[] png, OcrRequest request, CancellationToken cancellationToken);
}

/// <summary>Thrown when a configured engine can't be reached or isn't installed.</summary>
public sealed class OcrEngineUnavailableException(string engine, string reason, Exception? inner = null)
    : InvalidOperationException($"The {engine} OCR engine is unavailable: {reason}", inner)
{
    public string Engine { get; } = engine;
}

public enum OcrTableModel
{
    /// <summary>Tables come from word positions only.</summary>
    None,
    /// <summary>PP-StructureV3, which runs on a CPU.</summary>
    Structure,
    /// <summary>PaddleOCR-VL, a vision-language model that wants an NVIDIA GPU.</summary>
    Vl
}

/// <summary>Per-request choices, from an API call or MCP tool. Anything left null uses the server's settings.</summary>
public sealed record OcrOverrides(string? Engine = null, string? Languages = null, string? Tables = null);

/// <summary>The OCR settings for one job, after combining the server's settings with any request overrides.</summary>
public sealed partial record OcrSettings(
    string Engine,
    IReadOnlyList<string> Languages,
    OcrTableModel Tables,
    double MinConfidence,
    bool DetectOrientation,
    bool Deskew,
    bool ReadTextInImages,
    bool EngineChosenByRequest = false,
    bool TablesChosenByRequest = false)
{
    public const int MaxLanguages = 5;

    /// <summary>Splits "eng+deu" into codes, rejecting anything that isn't a plain language code.</summary>
    public static IReadOnlyList<string> ParseLanguages(string? value)
    {
        var codes = (value ?? string.Empty)
            .Split(['+', ',', ' '], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(code => code.ToLowerInvariant())
            .Distinct()
            .ToList();
        if (codes.Count == 0)
            return ["eng"];
        if (codes.Count > MaxLanguages)
            throw new ArgumentException($"Use at most {MaxLanguages} OCR languages at once.");
        foreach (var code in codes)
        {
            if (!LanguageCode().IsMatch(code))
                throw new ArgumentException($"'{code}' isn't an OCR language code. Use codes such as eng, deu, fra or chi_sim, joined with +.");
        }

        return codes;
    }

    public static OcrTableModel ParseTables(string? value) => (value ?? string.Empty).Trim().ToLowerInvariant() switch
    {
        "" or "none" or "off" or "false" => OcrTableModel.None,
        "structure" or "ppstructure" or "pp-structure" => OcrTableModel.Structure,
        "vl" or "paddleocr-vl" => OcrTableModel.Vl,
        _ => throw new ArgumentException($"'{value}' isn't a table model. Use none, structure or vl.")
    };

    public static string TableModelName(OcrTableModel model) => model switch
    {
        OcrTableModel.Structure => "structure",
        OcrTableModel.Vl => "vl",
        _ => "none"
    };

    [GeneratedRegex("^[a-z]{3}(_[a-z]{2,6})?$")]
    private static partial Regex LanguageCode();
}
