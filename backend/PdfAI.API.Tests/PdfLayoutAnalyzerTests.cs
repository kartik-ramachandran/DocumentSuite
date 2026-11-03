using FluentAssertions;
using PdfAI.API.Services;

namespace PdfAI.API.Tests;

public class PdfLayoutAnalyzerTests
{
    private const double FontSize = 10;
    private const double CharWidth = 5;
    private const double PageWidth = 612;

    [Fact]
    public void BuildBlocks_AlignedColumns_BecomeATableWithSeparateCells()
    {
        var words = new List<LayoutWord>();
        words.AddRange(Row(100, ("Region", 72), ("Units", 200), ("Revenue", 320)));
        words.AddRange(Row(114, ("North", 72), ("1,250", 200), ("48200.50", 320)));
        words.AddRange(Row(128, ("South", 72), ("980", 200), ("37150.25", 320)));

        var table = PdfLayoutAnalyzer.BuildBlocks(words, [], PageWidth).Should().ContainSingle().Which.Should().BeOfType<TableBlock>().Subject;

        table.ColumnWidths.Should().HaveCount(3);
        table.Rows.Should().HaveCount(3);
        table.Rows[1].Select(cell => cell.Text).Should().Equal("North", "1,250", "48200.50");
    }

    [Fact]
    public void BuildBlocks_RightAlignedNumbers_StayInOneColumn()
    {
        var words = new List<LayoutWord>();
        words.AddRange(Row(100, ("Item", 72), ("1234567", 300)));
        words.AddRange(Row(114, ("Other", 72), ("99", 325)));
        words.AddRange(Row(128, ("Third", 72), ("100", 320)));

        var table = PdfLayoutAnalyzer.BuildBlocks(words, [], PageWidth).Should().ContainSingle().Which.Should().BeOfType<TableBlock>().Subject;

        table.ColumnWidths.Should().HaveCount(2);
        table.Rows[1][1].Text.Should().Be("99");
    }

    [Fact]
    public void BuildBlocks_LastColumn_IsWideEnoughForItsText()
    {
        var words = new List<LayoutWord>();
        words.AddRange(Row(100, ("Name", 72), ("Code", 200)));
        words.AddRange(Row(114, ("North", 72), ("007", 200)));

        var table = PdfLayoutAnalyzer.BuildBlocks(words, [], PageWidth).OfType<TableBlock>().Single();

        table.ColumnWidths[^1].Should().BeGreaterThan("Code".Length * CharWidth);
    }

    [Fact]
    public void BuildBlocks_JustifiedTextWithWideGaps_IsNotMistakenForATable()
    {
        const double wideGap = FontSize * 1.5;
        var blocks = PdfLayoutAnalyzer.BuildBlocks(
        [
            .. Line(100, 72, wideGap, "approval", "by", "the", "review", "team", "today"),
            .. Line(112, 72, wideGap, "records", "are", "complete", "with", "minor", "notes"),
            .. Line(124, 72, wideGap, "signed", "off", "by", "the", "final", "reviewer")
        ], [], PageWidth);

        blocks.Should().NotContain(block => block is TableBlock);
        blocks.OfType<ParagraphBlock>().SelectMany(block => block.Lines).Should().OnlyContain(line => line.Segments.Count == 1);
    }

    [Fact]
    public void BuildBlocks_WrappedLines_JoinOneParagraphAndGapsSplitParagraphs()
    {
        var fullLine = Enumerable.Repeat("wordy", 12).ToArray();
        var blocks = PdfLayoutAnalyzer.BuildBlocks(
        [
            .. Line(100, 72, 2, fullLine),
            .. Line(112, 72, 2, "second", "line"),
            .. Line(150, 72, 2, "new", "paragraph")
        ], [], PageWidth);

        var paragraphs = blocks.OfType<ParagraphBlock>().ToList();
        paragraphs.Should().HaveCount(2);
        paragraphs[0].Lines.Should().HaveCount(2);
    }

    [Fact]
    public void BuildBlocks_TwoColumnText_ReadsLeftColumnBeforeRight()
    {
        var words = new List<LayoutWord>();
        for (var line = 0; line < 8; line++)
        {
            var baseline = 100 + line * 12;
            words.AddRange(Line(baseline, 54, 2, $"L{line}", "aaaaaaa", "bbbbbbb", "ccccccc", "ddddddd"));
            words.AddRange(Line(baseline, 330, 2, $"R{line}", "aaaaaaa", "bbbbbbb", "ccccccc", "ddddddd"));
        }

        var text = string.Join(' ', PdfLayoutAnalyzer.BuildBlocks(words, [], PageWidth)
            .OfType<ParagraphBlock>().SelectMany(block => block.Lines).Select(line => line.Text));

        text.IndexOf("L7", StringComparison.Ordinal).Should().BeLessThan(text.IndexOf("R0", StringComparison.Ordinal));
    }

    [Fact]
    public void BuildBlocks_InsertsImagesInReadingOrder()
    {
        var image = new LayoutImage([1], false, 72, 120, 100, 50);
        var blocks = PdfLayoutAnalyzer.BuildBlocks(
        [
            .. Line(100, 72, 2, "Above"),
            .. Line(200, 72, 2, "Below")
        ], [image], PageWidth);

        blocks.Select(block => block.GetType()).Should().Equal(typeof(ParagraphBlock), typeof(ImageBlock), typeof(ParagraphBlock));
    }

    [Theory]
    [InlineData("48200.50", true)]
    [InlineData("1,250", true)]
    [InlineData("-12.5", true)]
    [InlineData("0", true)]
    [InlineData("007", false)]
    [InlineData("12,34", false)]
    [InlineData("1234567890123456", false)]
    [InlineData("$100", false)]
    [InlineData("12%", false)]
    public void TryParseNumber_OnlyAcceptsPlainNumbers(string text, bool expected)
    {
        EditableDocumentWriter.TryParseNumber(text, out _).Should().Be(expected);
    }

    [Fact]
    public void ParseTesseractTsv_ScalesToPointsAndDropsNoise()
    {
        const string tsv =
            "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n" +
            "1\t1\t0\t0\t0\t0\t0\t0\t2550\t3300\t-1\t\n" +
            "5\t1\t1\t1\t1\t1\t300\t600\t300\t60\t96.5\tHello\n" +
            "5\t1\t1\t1\t1\t2\t650\t600\t300\t60\t12.0\tnoise\n" +
            "5\t1\t1\t1\t1\t3\t1000\t600\t300\t60\t91.0\t \n";

        var word = PdfLayoutService.ParseTesseractTsv(tsv, 300).Should().ContainSingle().Subject;

        word.Text.Should().Be("Hello");
        word.Left.Should().BeApproximately(72, 0.01);
        word.Baseline.Should().BeApproximately(158.4, 0.01);
    }

    private static IEnumerable<LayoutWord> Row(double baseline, params (string Text, double Left)[] cells) =>
        cells.Select(cell => Word(cell.Text, cell.Left, baseline));

    private static IEnumerable<LayoutWord> Line(double baseline, double left, double gap, params string[] words)
    {
        var x = left;
        foreach (var text in words)
        {
            var word = Word(text, x, baseline);
            yield return word;
            x = word.Right + gap;
        }
    }

    private static LayoutWord Word(string text, double left, double baseline) =>
        new(text, left, left + text.Length * CharWidth, baseline, FontSize);
}
