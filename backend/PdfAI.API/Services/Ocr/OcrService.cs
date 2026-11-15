namespace PdfAI.API.Services.Ocr;

/// <summary>A table found by a layout model, in points on the straightened page.</summary>
public sealed record OcrTableRegion(double Left, double Top, double Width, double Height, IReadOnlyList<IReadOnlyList<string>> Rows)
{
    public double Right => Left + Width;
    public double Bottom => Top + Height;
}

/// <summary>One page's OCR. Word positions are in points on the straightened page described by <see cref="Frame"/>.</summary>
public sealed record OcrPageResult(string Engine, List<LayoutWord> Words, List<OcrTableRegion> Tables, OcrFrame Frame, List<string> Warnings);

/// <summary>
/// Runs OCR on rendered pages: picks the engine, turns and straightens the page, falls back to Tesseract when another engine
/// is down, and converts the result to layout words.
/// </summary>
public sealed class OcrService
{
    public const int Dpi = 300;
    public const int MinDpi = 72;
    public const double MaxPixels = 25_000_000;  // a very large page is read at a lower resolution, so it can't run for minutes

    /// <summary>300 DPI, or less for a page so large that 300 DPI would exceed <see cref="MaxPixels"/>.</summary>
    public static int DpiFor(double widthPoints, double heightPoints)
    {
        var squareInches = widthPoints * heightPoints / (72d * 72d);
        if (squareInches <= 0)
            return Dpi;
        return Math.Clamp((int)Math.Floor(Math.Sqrt(MaxPixels / squareInches)), MinDpi, Dpi);
    }

    private readonly IReadOnlyList<IOcrEngine> _engines;
    private readonly PdfToolRunner _tools;
    private readonly IConfiguration _configuration;
    private readonly ILogger<OcrService> _logger;

    public OcrService(IEnumerable<IOcrEngine> engines, PdfToolRunner tools, IConfiguration configuration, ILogger<OcrService> logger)
    {
        _engines = engines.ToList();
        _tools = tools;
        _configuration = configuration;
        _logger = logger;
    }

    public IReadOnlyList<string> EngineNames => _engines.Select(engine => engine.Name).ToList();

    /// <summary>Combines the server's <c>Ocr</c> settings with a request's choices, checking both.</summary>
    public OcrSettings Resolve(OcrOverrides? overrides)
    {
        var section = _configuration.GetSection("Ocr");
        var engine = (string.IsNullOrWhiteSpace(overrides?.Engine) ? section["Engine"] : overrides.Engine)?.Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(engine))
            engine = TesseractOcrEngine.EngineName;
        if (_engines.All(candidate => candidate.Name != engine))
            throw new ArgumentException($"'{engine}' isn't an OCR engine. Use {string.Join(" or ", EngineNames)}.");

        return new OcrSettings(
            engine,
            OcrSettings.ParseLanguages(string.IsNullOrWhiteSpace(overrides?.Languages) ? section["Languages"] : overrides.Languages),
            OcrSettings.ParseTables(string.IsNullOrWhiteSpace(overrides?.Tables) ? section["Tables"] : overrides.Tables),
            Math.Clamp(section.GetValue("MinConfidence", 0.3), 0, 1),
            section.GetValue("DetectOrientation", true),
            section.GetValue("Deskew", true),
            section.GetValue("ReadTextInImages", true),
            EngineChosenByRequest: !string.IsNullOrWhiteSpace(overrides?.Engine),
            TablesChosenByRequest: !string.IsNullOrWhiteSpace(overrides?.Tables));
    }

    /// <summary>
    /// Reads a whole scanned page. Returns null when no engine can run and <paramref name="requireOcr"/> is false,
    /// so the page keeps its picture without text.
    /// </summary>
    /// <param name="pageSize">The page's size in points, which sets the resolution it's read at.</param>
    public async Task<OcrPageResult?> ReadPageAsync(
        string pdfPath,
        int pageNumber,
        (double Width, double Height) pageSize,
        OcrSettings settings,
        bool findTables,
        bool requireOcr,
        CancellationToken cancellationToken)
    {
        var dpi = DpiFor(pageSize.Width, pageSize.Height);
        var rendered = await _tools.RenderPageAsync(pdfPath, pageNumber, "png", dpi, cancellationToken: cancellationToken);
        var rotation = settings.DetectOrientation && _engines.OfType<TesseractOcrEngine>().FirstOrDefault() is { } tesseract
            ? await tesseract.DetectRotationAsync(rendered, cancellationToken)
            : 0;
        var prepared = OcrImagePreparer.Prepare(rendered, dpi, rotation, settings.Deskew);
        var tables = findTables ? settings.Tables : OcrTableModel.None;

        var warnings = new List<string>();
        if (dpi < Dpi)
            warnings.Add($"This page is unusually large, so it was read at {dpi} DPI.");
        var outcome = await RecognizeAsync(prepared.Png, dpi, settings, tables, warnings, pageNumber, requireOcr, cancellationToken);
        if (outcome is null)
            return null;

        var (engine, words, foundTables) = outcome.Value;
        var scale = 72d / dpi;
        return new OcrPageResult(
            engine,
            ToLayoutWords(words, dpi, settings.MinConfidence),
            foundTables.Select(table => new OcrTableRegion(table.Left * scale, table.Top * scale, table.Width * scale, table.Height * scale, table.Rows)).ToList(),
            prepared.Frame,
            warnings);
    }

    /// <summary>Reads text inside a picture on a page that otherwise has real text. Positions are in page points.</summary>
    public async Task<List<LayoutWord>> ReadRegionAsync(
        string pdfPath,
        int pageNumber,
        (double Left, double Top, double Width, double Height) region,
        OcrSettings settings,
        CancellationToken cancellationToken)
    {
        var dpi = DpiFor(region.Width, region.Height);
        var rendered = await _tools.RenderPageAsync(pdfPath, pageNumber, "png", dpi, region, cancellationToken);
        var warnings = new List<string>();
        var outcome = await RecognizeAsync(OcrImagePreparer.PrepareRegion(rendered), dpi, settings, OcrTableModel.None, warnings, pageNumber, requireOcr: false, cancellationToken);
        if (outcome is null)
            return [];

        // pdftoppm starts the crop on a whole pixel, so positions are offset from there.
        var scale = dpi / 72d;
        var left = Math.Floor(region.Left * scale) / scale;
        var top = Math.Floor(region.Top * scale) / scale;
        return ToLayoutWords(outcome.Value.Words, dpi, settings.MinConfidence)
            .Select(word => word with { Left = word.Left + left, Right = word.Right + left, Baseline = word.Baseline + top, FromImage = true })
            .ToList();
    }

    private async Task<(string Engine, IReadOnlyList<OcrWord> Words, IReadOnlyList<OcrTable> Tables)?> RecognizeAsync(
        byte[] png,
        int dpi,
        OcrSettings settings,
        OcrTableModel tables,
        List<string> warnings,
        int pageNumber,
        bool requireOcr,
        CancellationToken cancellationToken)
    {
        var languages = settings.Languages;
        var engine = _engines.First(candidate => candidate.Name == settings.Engine);
        var tableEngine = tables == OcrTableModel.None ? null : _engines.FirstOrDefault(candidate => candidate.SupportsTables);
        if (tables != OcrTableModel.None && tableEngine is null)
        {
            if (settings.TablesChosenByRequest)
                throw new ArgumentException("No OCR engine that finds tables is installed. Start the ocr-service container.");
            warnings.Add("Tables were found from word positions, because no layout model is configured.");
            tables = OcrTableModel.None;
        }

        OcrResult? result = null;
        IReadOnlyList<OcrTable> foundTables = [];

        // When one service reads both words and tables, it's asked once. If only its table model can't run, such as
        // PaddleOCR-VL without a GPU, the words are read again without tables.
        if (engine == tableEngine)
        {
            try
            {
                result = await engine.RecognizeAsync(png, new OcrRequest(languages, dpi, true, tables), cancellationToken);
                foundTables = result.Tables;
            }
            catch (OcrEngineUnavailableException ex) when (!settings.TablesChosenByRequest)
            {
                _logger.LogWarning(ex, "The table model is unavailable for page {Page}", pageNumber);
                warnings.Add($"Tables were found from word positions, because the table model was unavailable: {ex.Message}");
            }

            tableEngine = null;
        }

        try
        {
            result ??= await engine.RecognizeAsync(png, new OcrRequest(languages, dpi, true, OcrTableModel.None), cancellationToken);
        }
        catch (OcrEngineUnavailableException ex) when (!settings.EngineChosenByRequest && engine.Name != TesseractOcrEngine.EngineName && Fallback() is not null)
        {
            _logger.LogWarning(ex, "OCR engine {Engine} is unavailable for page {Page}, so Tesseract is used", engine.Name, pageNumber);
            warnings.Add($"The {engine.Name} engine was unavailable, so Tesseract read this page.");
            engine = Fallback()!;
            try
            {
                result = await engine.RecognizeAsync(png, new OcrRequest(languages, dpi, true, OcrTableModel.None), cancellationToken);
            }
            catch (OcrEngineUnavailableException inner)
            {
                return Unavailable(inner);
            }
        }
        catch (OcrEngineUnavailableException ex)
        {
            if (settings.EngineChosenByRequest)
                throw;
            return Unavailable(ex);
        }

        if (tableEngine is not null)
        {
            try
            {
                foundTables = (await tableEngine.RecognizeAsync(png, new OcrRequest(languages, dpi, false, tables), cancellationToken)).Tables;
            }
            catch (OcrEngineUnavailableException ex) when (!settings.TablesChosenByRequest)
            {
                _logger.LogWarning(ex, "The table model is unavailable for page {Page}", pageNumber);
                warnings.Add("The table model was unavailable, so tables were found from word positions.");
            }
        }

        return (result.Engine, result.Words, foundTables);

        IOcrEngine? Fallback() => _engines.FirstOrDefault(candidate => candidate.Name == TesseractOcrEngine.EngineName);

        (string, IReadOnlyList<OcrWord>, IReadOnlyList<OcrTable>)? Unavailable(OcrEngineUnavailableException ex)
        {
            if (requireOcr)
                throw new InvalidOperationException($"Page {pageNumber} is scanned and needs OCR, but OCR can't run. {ex.Message}", ex);
            _logger.LogWarning(ex, "OCR is unavailable, so page {Page} keeps its image without editable text", pageNumber);
            return null;
        }
    }

    /// <summary>
    /// Converts OCR words to layout words in points, dropping low-confidence noise. A word's box height varies with its
    /// letters, so sizes and baselines are taken per line, then snapped to the page's typical size so body text forms paragraphs.
    /// </summary>
    public static List<LayoutWord> ToLayoutWords(IReadOnlyList<OcrWord> words, int dpi, double minConfidence)
    {
        var scale = 72d / dpi;
        var kept = words
            .Where(word => word.Confidence >= minConfidence && !string.IsNullOrWhiteSpace(word.Text))
            .Select((word, index) => (Word: word, Key: word.Line ?? $"#{index}"))
            .ToList();
        if (kept.Count == 0)
            return [];

        var lineSizes = kept.GroupBy(item => item.Key).ToDictionary(group => group.Key, group => group.Max(item => item.Word.Height) * scale * 1.15);
        var pageSize = LayoutMath.Median(lineSizes.Values);
        var lineBaselines = kept.GroupBy(item => item.Key).ToDictionary(group => group.Key, group => LayoutMath.Median(group.Select(item => (item.Word.Top + item.Word.Height) * scale)));

        return kept.Select(item =>
        {
            var size = lineSizes[item.Key] <= pageSize * 1.4 ? pageSize : lineSizes[item.Key];
            return new LayoutWord(
                item.Word.Text,
                item.Word.Left * scale,
                (item.Word.Left + item.Word.Width) * scale,
                lineBaselines[item.Key],
                Math.Round(size * 2) / 2,
                Confidence: Math.Round(item.Word.Confidence, 3));
        }).ToList();
    }
}
