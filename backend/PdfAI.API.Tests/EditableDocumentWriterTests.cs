using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Validation;
using FluentAssertions;
using PdfAI.API.Services;
using SkiaSharp;

namespace PdfAI.API.Tests;

/// <summary>Files that fail these schema checks make Office ask to repair them or refuse to open them.</summary>
public class EditableDocumentWriterTests
{
    [Fact]
    public void WriteWord_ProducesSchemaValidEditableDocument()
    {
        var bytes = EditableDocumentWriter.WriteWord(SamplePages());

        using var stream = new MemoryStream(bytes);
        using var document = WordprocessingDocument.Open(stream, false);
        Validate(document);
        var body = document.MainDocumentPart!.Document!.Body!;
        body.InnerText.Should().Contain("Annual Report").And.Contain("48200.50").And.Contain("Second page");
        body.Descendants<DocumentFormat.OpenXml.Wordprocessing.Table>().Should().ContainSingle();
    }

    [Fact]
    public void WriteWord_JoinsWrappedLinesAndRemovesWrapHyphens()
    {
        var page = new LayoutPage(1, 612, 792, PdfLayoutAnalyzer.BuildBlocks(
        [
            .. Enumerable.Range(0, 11).Select(i => Word("wordy", 72 + i * 42, 100)),
            Word("inspec-", 72 + 11 * 42, 100),
            Word("tion", 72, 112),
            Word("done", 100, 112)
        ], [], 612), false);

        using var stream = new MemoryStream(EditableDocumentWriter.WriteWord([page]));
        using var document = WordprocessingDocument.Open(stream, false);

        document.MainDocumentPart!.Document!.Body!.InnerText.Should().EndWith("inspection done");
    }

    [Fact]
    public void WriteExcel_ProducesSchemaValidWorkbookWithNumericCells()
    {
        var bytes = EditableDocumentWriter.WriteExcel(SamplePages());

        using var stream = new MemoryStream(bytes);
        using var document = SpreadsheetDocument.Open(stream, false);
        Validate(document);
        document.WorkbookPart!.WorksheetParts.Should().HaveCount(2);
        var cells = document.WorkbookPart.WorksheetParts.SelectMany(part => part.Worksheet!.Descendants<DocumentFormat.OpenXml.Spreadsheet.Cell>()).ToList();
        cells.Should().Contain(cell => cell.CellValue != null && cell.CellValue.Text == "48200.50");
        cells.Should().Contain(cell => cell.InnerText == "007" && cell.CellValue == null);
    }

    [Fact]
    public void WritePowerPoint_ProducesSchemaValidDeckWithMasterAndEditableText()
    {
        var bytes = EditableDocumentWriter.WritePowerPoint(SamplePages());

        using var stream = new MemoryStream(bytes);
        using var document = PresentationDocument.Open(stream, false);
        Validate(document);
        var presentation = document.PresentationPart!;
        presentation.SlideParts.Should().HaveCount(2);
        presentation.SlideMasterParts.Should().ContainSingle();
        presentation.SlideParts.Should().OnlyContain(slide => slide.SlideLayoutPart != null);
        presentation.SlideParts.SelectMany(slide => slide.Slide!.Descendants<DocumentFormat.OpenXml.Drawing.Text>()).Select(text => text.Text)
            .Should().Contain(text => text.Contains("Annual Report"));
    }

    [Fact]
    public void Writers_RemoveCharactersXmlDoesNotAllow()
    {
        var pages = new[] { new LayoutPage(1, 612, 792, PdfLayoutAnalyzer.BuildBlocks([Word("bad\u0001text", 72, 100)], [], 612), false) };

        foreach (var bytes in new[] { EditableDocumentWriter.WriteWord(pages), EditableDocumentWriter.WriteExcel(pages), EditableDocumentWriter.WritePowerPoint(pages) })
            bytes.Should().NotBeEmpty();

        using var stream = new MemoryStream(EditableDocumentWriter.WriteWord(pages));
        using var document = WordprocessingDocument.Open(stream, false);
        document.MainDocumentPart!.Document!.Body!.InnerText.Should().Be("badtext");
    }

    private static void Validate(OpenXmlPackage package)
    {
        var errors = new OpenXmlValidator(FileFormatVersions.Office2019).Validate(package)
            .Select(error => $"{error.Part?.Uri} {error.Path?.XPath}: {error.Description}")
            .ToList();

        errors.Should().BeEmpty();
    }

    private static List<LayoutPage> SamplePages()
    {
        var firstWords = new List<LayoutWord> { Word("Annual", 72, 80, 24, bold: true), Word("Report", 150, 80, 24, bold: true) };
        firstWords.AddRange([Word("Region", 72, 130), Word("Revenue", 220, 130), Word("Code", 380, 130)]);
        firstWords.AddRange([Word("North", 72, 145), Word("48200.50", 220, 145), Word("007", 380, 145)]);
        firstWords.AddRange([Word("South", 72, 160), Word("37150.25", 220, 160), Word("012", 380, 160)]);
        firstWords.Add(Word("Red", 72, 200) with { ColorHex = "CC0000", Italic = true, FontName = "Liberation Sans" });

        var image = new LayoutImage(CreatePng(), false, 72, 230, 120, 80);
        return
        [
            new LayoutPage(1, 612, 792, PdfLayoutAnalyzer.BuildBlocks(firstWords, [image], 612), false),
            new LayoutPage(2, 792, 612, PdfLayoutAnalyzer.BuildBlocks([Word("Second", 72, 80), Word("page", 104, 80)], [image], 792), false)
        ];
    }

    private static byte[] CreatePng()
    {
        using var bitmap = new SKBitmap(8, 8);
        bitmap.Erase(SKColors.SteelBlue);
        using var data = bitmap.Encode(SKEncodedImageFormat.Png, 100);
        return data.ToArray();
    }

    private static LayoutWord Word(string text, double left, double baseline, double size = 10, bool bold = false) =>
        new(text, left, left + text.Length * size * 0.5, baseline, size, bold);
}
