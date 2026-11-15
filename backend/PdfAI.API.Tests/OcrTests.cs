using System.Net;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using PdfAI.API.Services;
using PdfAI.API.Services.Ocr;
using PdfSharp.Drawing;
using PdfSharp.Pdf;
using SkiaSharp;
using PigDocument = UglyToad.PdfPig.PdfDocument;

namespace PdfAI.API.Tests;

public class OcrTests
{
    // Positions from a fake engine are in pixels at 300 DPI, so 300 pixels is 72 points.
    private const double PointsPerPixel = 72d / OcrService.Dpi;

    private static readonly IConfiguration NoImageCleanup = TestServices.Configuration(("Ocr:Deskew", "false"), ("Ocr:DetectOrientation", "false"));

    // ── Settings ─────────────────────────────────────────────────────

    [Theory]
    [InlineData(null, new[] { "eng" })]
    [InlineData("eng+deu", new[] { "eng", "deu" })]
    [InlineData("ENG, chi_sim", new[] { "eng", "chi_sim" })]
    public void ParseLanguages_AcceptsTesseractCodes(string? value, string[] expected)
    {
        OcrSettings.ParseLanguages(value).Should().Equal(expected);
    }

    [Theory]
    [InlineData("english")]
    [InlineData("eng;rm -rf")]
    [InlineData("../eng")]
    [InlineData("eng+deu+fra+spa+ita+por")]
    public void ParseLanguages_RejectsAnythingElse(string value)
    {
        var act = () => OcrSettings.ParseLanguages(value);
        act.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void Resolve_RejectsUnknownEngines()
    {
        var act = () => TestServices.CreateOcrService().Resolve(new OcrOverrides(Engine: "mineru"));
        act.Should().Throw<ArgumentException>().WithMessage("*tesseract or paddle*");
    }

    [Theory]
    [InlineData("Orientation in degrees: 270\nRotate: 90\nOrientation confidence: 8.51\n", 90)]
    [InlineData("Rotate: 180\nOrientation confidence: 12\n", 180)]
    [InlineData("Rotate: 90\nOrientation confidence: 0.4\n", 0)]
    [InlineData("Too few characters. Skipping this page\n", 0)]
    public void ParseRotation_ReadsConfidentAnswersOnly(string osd, int expected)
    {
        TesseractOcrEngine.ParseRotation(osd).Should().Be(expected);
    }

    // ── Straightening ────────────────────────────────────────────────

    [Theory]
    [InlineData(2.0)]
    [InlineData(-3.0)]
    public void EstimateSkew_FindsTheTurnThatLevelsTextLines(double tilt)
    {
        const int width = 900, height = 700;
        using var bitmap = new SKBitmap(width, height);
        using (var canvas = new SKCanvas(bitmap))
        {
            canvas.Clear(SKColors.White);
            canvas.RotateDegrees((float)tilt, width / 2f, height / 2f);
            using var ink = new SKPaint { Color = SKColors.Black };
            for (var line = 0; line < 14; line++)
            {
                for (var word = 0; word < 9; word++)
                    canvas.DrawRect(80 + word * 85, 60 + line * 42, 60, 12, ink);
            }
        }

        var gray = new byte[width * height];
        for (var y = 0; y < height; y++)
        {
            for (var x = 0; x < width; x++)
                gray[y * width + x] = bitmap.GetPixel(x, y).Red;
        }

        OcrImagePreparer.EstimateSkew(gray, width, height).Should().BeApproximately(-tilt, 0.15);
    }

    [Theory]
    [InlineData(612, 792, 300)]
    [InlineData(842, 1191, 300)]
    [InlineData(2550, 3300, 124)]
    [InlineData(20000, 20000, 72)]
    public void DpiFor_LowersTheResolutionOfVeryLargePages(double width, double height, int expected)
    {
        OcrService.DpiFor(width, height).Should().Be(expected);
    }

    [Fact]
    public void OcrFrame_MapsATurnedPageBackToTheDisplayedPage()
    {
        // A portrait page whose text runs up the page, so it was turned 90° clockwise into landscape for OCR.
        var frame = new OcrFrame(90, PageWidth: 100, PageHeight: 200, Width: 200, Height: 100);

        var (x, y) = frame.ToPage(0, 0);

        x.Should().BeApproximately(0, 0.001);
        y.Should().BeApproximately(200, 0.001);
        frame.TextAngle.Should().Be(-90);
    }

    // ── Engines ──────────────────────────────────────────────────────

    [Fact]
    public void ToLayoutWords_DropsLowConfidenceWordsAndConvertsToPoints()
    {
        var words = OcrService.ToLayoutWords(
            [new OcrWord("Hello", 300, 600, 300, 60, 0.96, "1"), new OcrWord("noise", 650, 600, 300, 60, 0.1, "1")],
            OcrService.Dpi,
            minConfidence: 0.3);

        var word = words.Should().ContainSingle().Subject;
        word.Left.Should().BeApproximately(72, 0.01);
        word.Baseline.Should().BeApproximately(158.4, 0.01);
        word.Confidence.Should().Be(0.96);
    }

    [Fact]
    public async Task SidecarOcrEngine_ReadsWordsAndTables()
    {
        var body = """
            {"engine":"paddle-ppocrv5","words":[{"text":"Total","left":10,"top":20,"width":50,"height":12,"confidence":0.97,"line":3}],
             "tables":[{"left":0,"top":0,"width":200,"height":40,"rows":[["a","b"],["c",null]]}]}
            """;
        var engine = new SidecarOcrEngine(new HttpClient(new StubHandler(HttpStatusCode.OK, body)), TestServices.Configuration(("Ocr:ServiceUrl", "http://ocr:8000")));

        var result = await engine.RecognizeAsync([1, 2, 3], new OcrRequest(["eng"], 300, true, OcrTableModel.Structure), CancellationToken.None);

        result.Engine.Should().Be("paddle-ppocrv5");
        result.Words.Should().ContainSingle().Which.Should().Be(new OcrWord("Total", 10, 20, 50, 12, 0.97, "3"));
        result.Tables.Should().ContainSingle().Which.Rows[1].Should().Equal("c", string.Empty);
    }

    [Fact]
    public async Task SidecarOcrEngine_ReportsAModelThatCantRunAsUnavailable()
    {
        var engine = new SidecarOcrEngine(
            new HttpClient(new StubHandler(HttpStatusCode.ServiceUnavailable, """{"detail":"PaddleOCR-VL needs a GPU."}""")),
            TestServices.Configuration(("Ocr:ServiceUrl", "http://ocr:8000")));

        var act = () => engine.RecognizeAsync([1], new OcrRequest(["eng"], 300, false, OcrTableModel.Vl), CancellationToken.None);

        await act.Should().ThrowAsync<OcrEngineUnavailableException>().WithMessage("*needs a GPU*");
    }

    // ── Whole pages ──────────────────────────────────────────────────

    [Fact]
    public async Task ExtractAsync_ReadsScannedPagesWithTheConfiguredEngine()
    {
        var engine = FakeOcrEngine.Tesseract(Line("1", 300, 300, "Scanned", "invoice", "text"));
        var layout = TestServices.CreateLayoutService(NoImageCleanup, engine);

        var page = (await layout.ExtractAsync(CreateScannedPdf(), ExtractOptions.ForText())).Single();

        page.WasOcr.Should().BeTrue();
        page.OcrEngine.Should().Be("tesseract");
        page.AllWords().Select(word => word.Text).Should().Equal("Scanned", "invoice", "text");
        page.OcrConfidence.Should().Be(0.9);
        engine.Requests.Should().ContainSingle().Which.Languages.Should().Equal("eng");
    }

    [Fact]
    public async Task ExtractAsync_PassesRequestedLanguagesToTheEngine()
    {
        var engine = FakeOcrEngine.Tesseract(Line("1", 300, 300, "Grüße"));
        var layout = TestServices.CreateLayoutService(NoImageCleanup, engine);

        await layout.ExtractAsync(CreateScannedPdf(), ExtractOptions.ForText(new OcrOverrides(Languages: "deu+eng")));

        engine.Requests.Should().ContainSingle().Which.Languages.Should().Equal("deu", "eng");
    }

    [Fact]
    public async Task ExtractAsync_FallsBackToTesseractWhenTheConfiguredServiceIsDown()
    {
        var config = TestServices.Configuration(("Ocr:Engine", "paddle"), ("Ocr:Deskew", "false"), ("Ocr:DetectOrientation", "false"));
        var layout = TestServices.CreateLayoutService(config, FakeOcrEngine.Tesseract(Line("1", 300, 300, "Fallback")), new SidecarOcrEngine(new HttpClient(), config));

        var page = (await layout.ExtractAsync(CreateScannedPdf(), ExtractOptions.ForText())).Single();

        page.OcrEngine.Should().Be("tesseract");
        page.OcrWarnings.Should().Contain(warning => warning.Contains("paddle engine was unavailable"));
    }

    [Fact]
    public async Task ExtractAsync_KeepsTheEngineWhenOnlyItsTableModelCantRun()
    {
        var words = Line("1", 300, 300, "Still", "PaddleOCR");
        var paddle = new FakeOcrEngine("paddle", (_, request) => request.Tables == OcrTableModel.Vl
            ? throw new OcrEngineUnavailableException("paddle", "PaddleOCR-VL needs an NVIDIA GPU.")
            : new OcrResult("paddle", words, []), supportsTables: true);
        var config = TestServices.Configuration(("Ocr:Engine", "paddle"), ("Ocr:Tables", "vl"), ("Ocr:Deskew", "false"), ("Ocr:DetectOrientation", "false"));
        var layout = TestServices.CreateLayoutService(config, FakeOcrEngine.Tesseract(), paddle);

        var page = (await layout.ExtractAsync(CreateScannedPdf(), ExtractOptions.ForStructure())).Single();
        var requested = () => layout.ExtractAsync(CreateScannedPdf(), ExtractOptions.ForStructure(new OcrOverrides(Tables: "vl")));

        page.OcrEngine.Should().Be("paddle");
        page.OcrWarnings.Should().ContainSingle().Which.Should().Contain("needs an NVIDIA GPU");
        await requested.Should().ThrowAsync<OcrEngineUnavailableException>("a request that names the table model must not silently go without it");
    }

    [Fact]
    public async Task ExtractAsync_FailsWhenARequestedEngineIsDown()
    {
        var layout = TestServices.CreateLayoutService(NoImageCleanup, FakeOcrEngine.Tesseract(), new SidecarOcrEngine(new HttpClient(), NoImageCleanup));

        var act = () => layout.ExtractAsync(CreateScannedPdf(), ExtractOptions.ForText(new OcrOverrides(Engine: "paddle")));

        await act.Should().ThrowAsync<OcrEngineUnavailableException>();
    }

    [Fact]
    public async Task ExtractAsync_ReadsTextInsidePicturesOnPagesWithRealText()
    {
        // The picture is at (72, 200) points; the fake reads one word 30 pixels into it.
        var engine = FakeOcrEngine.Tesseract(new OcrWord("Stamped", 30, 30, 150, 40, 0.9, "1"));
        var layout = TestServices.CreateLayoutService(NoImageCleanup, engine);
        var pdf = CreateTextPdfWithPicture();

        var text = (await layout.ExtractAsync(pdf, ExtractOptions.ForText())).Single();
        var office = (await layout.ExtractAsync(pdf, ExtractOptions.ForOffice())).Single();

        var stamped = text.AllWords().Should().ContainSingle(word => word.Text == "Stamped").Subject;
        stamped.FromImage.Should().BeTrue();
        stamped.Left.Should().BeApproximately(72 + 30 * PointsPerPixel, 0.5);
        text.AllWords().Should().Contain(word => word.Text == "invoice");
        office.AllWords().Should().NotContain(word => word.Text == "Stamped", "Office files keep the picture, so its text isn't repeated");
    }

    [Fact]
    public async Task ExtractAsync_UsesCheckedTablesFromALayoutModel()
    {
        var words = new[]
        {
            Line("1", 300, 300, "Item", "Amount"),
            Line("2", 300, 400, "Rent", "1,200.00"),
            Line("3", 300, 500, "Power", "87.50")
        }.SelectMany(line => line).ToArray();
        // The words are 300 pixels apart in two columns from x=300, so the table spans x=280..1000, y=280..560.
        var table = new OcrTable(280, 280, 720, 280, [["Item", "Amount"], ["Rent", "1,200.00"], ["Power", "87.80"]]);
        var engine = new FakeOcrEngine("paddle", (_, request) => new OcrResult("paddle", request.Words ? words : [], request.Tables == OcrTableModel.None ? [] : [table]), supportsTables: true);
        var config = TestServices.Configuration(("Ocr:Engine", "paddle"), ("Ocr:Tables", "structure"), ("Ocr:Deskew", "false"), ("Ocr:DetectOrientation", "false"));
        var layout = TestServices.CreateLayoutService(config, FakeOcrEngine.Tesseract(), engine);

        var page = (await layout.ExtractAsync(CreateScannedPdf(), ExtractOptions.ForStructure())).Single();

        var block = page.Blocks.OfType<TableBlock>().Should().ContainSingle().Subject;
        block.Source.Should().Be(OcrTableMerger.Source);
        block.Rows.Select(row => row.Select(cell => cell.Text)).Should().BeEquivalentTo(new[] { new[] { "Item", "Amount" }, new[] { "Rent", "1,200.00" }, new[] { "Power", "87.80" } }, options => options.WithStrictOrdering());
        block.UnverifiedWords.Should().Be(1);
        page.OcrWarnings.Should().Contain(warning => warning.Contains("87.80"), "a number the OCR engine didn't read must be flagged");
        page.OcrWarnings.Should().Contain(warning => warning.Contains("87.50"), "the word the layout model replaced is kept and reported");
    }

    // ── Table checks ─────────────────────────────────────────────────

    [Fact]
    public void Merge_RejectsATableThatMostlyDoesntMatchTheOcrText()
    {
        var words = ToPoints(Line("1", 300, 300, "Alpha", "Beta"), Line("2", 300, 400, "Gamma", "Delta"));
        var table = new OcrTableRegion(60, 60, 200, 60, [["Lorem", "Ipsum"], ["Dolor", "Delta"]]);

        var result = OcrTableMerger.Merge(words, [table]);

        result.Tables.Should().BeEmpty();
        result.RemainingWords.Should().HaveCount(4);
        result.Warnings.Should().ContainSingle().Which.Should().Contain("rebuilt from word positions");
    }

    [Fact]
    public void Merge_GivesMatchedCellsTheirRealPositions()
    {
        var words = ToPoints(Line("1", 300, 300, "Name", "Qty"), Line("2", 300, 400, "Bolts", "40"));
        var table = new OcrTableRegion(60, 60, 200, 60, [["Name", "Qty"], ["Bolts", "40"]]);

        var result = OcrTableMerger.Merge(words, [table]);

        var cells = result.Tables.Should().ContainSingle().Subject.Rows.SelectMany(row => row).ToList();
        cells.SelectMany(cell => cell.Words).Should().OnlyContain(word => word.IsPositioned);
        cells[3].Words.Single().Should().BeSameAs(words[3]);
        result.RemainingWords.Should().BeEmpty();
        result.Warnings.Should().BeEmpty();
    }

    [Theory]
    [InlineData("Total:", "total")]
    [InlineData("$1,234.50", "1,234.50")]
    [InlineData("(42)", "42")]
    public void Normalize_IgnoresCaseAndPunctuation(string text, string expected)
    {
        OcrTableMerger.Normalize(text).Should().Be(expected);
    }

    // ── Searchable PDFs ──────────────────────────────────────────────

    [Fact]
    public async Task MakeSearchableAsync_AddsInvisibleTextOverTheUntouchedPage()
    {
        var engine = FakeOcrEngine.Tesseract(Line("1", 300, 300, "Invoice", "Grüße", "日本"));
        var toolkit = TestServices.CreateToolkit(NoImageCleanup, engine);
        var pdf = CreateScannedPdf();

        var result = await toolkit.MakeSearchableAsync(pdf);

        result.OcrPages.Should().Be(1);
        using var document = PigDocument.Open(result.Pdf);
        var page = document.GetPage(1);
        page.GetImages().Should().ContainSingle("the scan itself is kept as it was");
        page.Text.Should().Contain("Invoice").And.Contain("Grüße").And.Contain("日本");
        var first = page.Letters.First(letter => letter.Value == "I");
        first.StartBaseLine.X.Should().BeApproximately(72, 1);
        page.Letters.Should().OnlyContain(letter => letter.RenderingMode == UglyToad.PdfPig.Core.TextRenderingMode.Neither);
    }

    [Fact]
    public async Task MakeSearchableAsync_PlacesTextOnARotatedPage()
    {
        // The page is portrait in its own coordinates but shown landscape. PdfPig reports letters as displayed, from the bottom-left.
        var engine = FakeOcrEngine.Tesseract(new OcrWord("Sideways", 72 / PointsPerPixel, 100 / PointsPerPixel - 50, 400, 50, 0.9, "1"));
        var toolkit = TestServices.CreateToolkit(NoImageCleanup, engine);

        var result = await toolkit.MakeSearchableAsync(CreateScannedPdf(rotate: 90));

        using var document = PigDocument.Open(result.Pdf);
        var letters = document.GetPage(1).Letters;
        var first = letters.First();
        first.StartBaseLine.X.Should().BeApproximately(72, 1.5);
        first.StartBaseLine.Y.Should().BeApproximately(612 - 100, 1.5);
        letters.Last().StartBaseLine.X.Should().BeGreaterThan(first.StartBaseLine.X, "the text runs to the right as displayed");
        letters.Last().StartBaseLine.Y.Should().BeApproximately(first.StartBaseLine.Y, 0.5);
    }

    [Fact]
    public async Task RedactAsync_CoversWordsThatOcrFound()
    {
        var engine = FakeOcrEngine.Tesseract(Line("1", 300, 300, "Account", "12345678"));
        var toolkit = TestServices.CreateToolkit(NoImageCleanup, engine);

        var result = await toolkit.RedactAsync(CreateScannedPdf(), ["12345678"]);

        result.RedactedWords.Should().Be(1);
        result.RedactedPages.Should().Be(1);
    }

    [Fact]
    public async Task ConvertToStructuredData_ReportsTheEngineAndConfidence()
    {
        var engine = FakeOcrEngine.Tesseract(Line("1", 300, 300, "Scanned", "page"));
        var service = TestServices.CreateProcessingService(NoImageCleanup, engine);

        var json = JsonSerializer.Serialize(await service.ConvertToStructuredData("scan.pdf", CreateScannedPdf(), includeImages: false));

        using var parsed = JsonDocument.Parse(json);
        var page = parsed.RootElement.GetProperty("pages")[0];
        page.GetProperty("ocrEngine").GetString().Should().Be("tesseract");
        page.GetProperty("ocrConfidence").GetDouble().Should().Be(0.9);
        var paragraph = page.GetProperty("blocks").EnumerateArray().Single(block => block.GetProperty("type").GetString() == "paragraph");
        paragraph.GetProperty("confidence").GetDouble().Should().Be(0.9);
        paragraph.GetProperty("fromImage").GetBoolean().Should().BeFalse();
    }

    // ── Helpers ──────────────────────────────────────────────────────

    /// <summary>Words on one line, 300 pixels apart, each 200 by 50 pixels.</summary>
    private static OcrWord[] Line(string line, double left, double top, params string[] words) =>
        words.Select((text, index) => new OcrWord(text, left + index * 300, top, 200, 50, 0.9, line)).ToArray();

    private static List<LayoutWord> ToPoints(params OcrWord[][] lines) =>
        OcrService.ToLayoutWords(lines.SelectMany(line => line).ToList(), OcrService.Dpi, 0);

    /// <summary>A page that's only a picture, like a scan.</summary>
    private static byte[] CreateScannedPdf(int rotate = 0)
    {
        using var bitmap = new SKBitmap(1275, 1650);
        using (var canvas = new SKCanvas(bitmap))
        {
            canvas.Clear(SKColors.White);
            using var ink = new SKPaint { Color = SKColors.Black };
            canvas.DrawRect(150, 150, 600, 30, ink);
        }

        using var png = bitmap.Encode(SKEncodedImageFormat.Png, 100);
        using var document = new PdfDocument();
        var page = document.AddPage();
        page.Width = XUnit.FromPoint(612);
        page.Height = XUnit.FromPoint(792);
        using (var graphics = XGraphics.FromPdfPage(page))
        using (var image = XImage.FromStream(Visible(png.ToArray())))
            graphics.DrawImage(image, 0, 0, 612, 792);
        page.Rotate = rotate;

        using var output = new MemoryStream();
        document.Save(output);
        return output.ToArray();
    }

    /// <summary>A page with real text and a picture at (72, 200) points, 200 by 100 points.</summary>
    private static byte[] CreateTextPdfWithPicture()
    {
        using var bitmap = new SKBitmap(400, 200);
        bitmap.Erase(SKColors.LightGray);
        using var png = bitmap.Encode(SKEncodedImageFormat.Png, 100);

        using var document = new PdfDocument();
        var page = document.AddPage();
        using (var graphics = XGraphics.FromPdfPage(page))
        using (var image = XImage.FromStream(Visible(png.ToArray())))
        {
            graphics.DrawString("This invoice has a stamped picture below it", new XFont("Arial", 12), XBrushes.Black, new XPoint(72, 72));
            graphics.DrawImage(image, 72, 200, 200, 100);
        }

        using var output = new MemoryStream();
        document.Save(output);
        return output.ToArray();
    }

    // PDFsharp reads the stream's underlying buffer, so it has to be publicly visible.
    private static MemoryStream Visible(byte[] bytes) => new(bytes, 0, bytes.Length, false, publiclyVisible: true);

    private sealed class StubHandler(HttpStatusCode status, string body) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") });
    }
}
