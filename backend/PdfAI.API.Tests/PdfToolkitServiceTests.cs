using System.IO.Compression;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using Moq;
using PdfAI.API.Services;
using PdfSharp.Drawing;
using PdfSharp.Pdf;
using SkiaSharp;
using PigDocument = UglyToad.PdfPig.PdfDocument;

namespace PdfAI.API.Tests;

public class PdfToolkitServiceTests
{
    private readonly PdfToolkitService _toolkit;

    public PdfToolkitServiceTests()
    {
        var tools = new PdfToolRunner(TestServices.EmptyConfiguration());
        _toolkit = new PdfToolkitService(new PdfLayoutService(tools, Mock.Of<ILogger<PdfLayoutService>>()), tools, Mock.Of<ILogger<PdfToolkitService>>());
    }

    [Fact]
    public void OrganizePages_KeepsTheRequestedOrderAndDropsTheRest()
    {
        PageLabels(_toolkit.OrganizePages(CreatePdf(4), "3,1,4")).Should().Equal("Page3", "Page1", "Page4");
    }

    [Fact]
    public void OrganizePages_DescendingRangeReversesPages()
    {
        PageLabels(_toolkit.OrganizePages(CreatePdf(3), "3-1")).Should().Equal("Page3", "Page2", "Page1");
    }

    [Fact]
    public void RemovePages_RemovesOnlyTheListedPages()
    {
        PageLabels(_toolkit.RemovePages(CreatePdf(4), "2,4")).Should().Equal("Page1", "Page3");
    }

    [Fact]
    public void RemovePages_RefusesToRemoveEveryPage()
    {
        var act = () => _toolkit.RemovePages(CreatePdf(2), "1-2");

        act.Should().Throw<ArgumentException>().WithMessage("*at least one page*");
    }

    [Fact]
    public void SplitIntoFiles_WritesOnePdfPerRange()
    {
        using var zip = new ZipArchive(new MemoryStream(_toolkit.SplitIntoFiles(CreatePdf(5), "1-2,3,4-5", null)));

        zip.Entries.Should().HaveCount(3);
        ReadEntryLabels(zip.Entries[0]).Should().Equal("Page1", "Page2");
        ReadEntryLabels(zip.Entries[2]).Should().Equal("Page4", "Page5");
    }

    [Fact]
    public void SplitIntoFiles_EveryPagesCoversTheWholeDocument()
    {
        using var zip = new ZipArchive(new MemoryStream(_toolkit.SplitIntoFiles(CreatePdf(5), null, 2)));

        zip.Entries.Should().HaveCount(3);
        ReadEntryLabels(zip.Entries[2]).Should().Equal("Page5");
    }

    [Fact]
    public void Metadata_CanBeSetReadAndCleared()
    {
        var updated = _toolkit.UpdateMetadata(CreatePdf(1), "My Title", "An Author", null, "alpha", clear: false);

        var metadata = _toolkit.ReadMetadata(updated);
        metadata.Title.Should().Be("My Title");
        metadata.Author.Should().Be("An Author");
        metadata.Keywords.Should().Be("alpha");

        var cleared = _toolkit.ReadMetadata(_toolkit.UpdateMetadata(updated, null, null, null, null, clear: true));
        cleared.Title.Should().BeNull();
        cleared.Author.Should().BeNull();
    }

    [Fact]
    public void CropPages_ShrinksTheVisibleAreaOfSelectedPagesOnly()
    {
        var cropped = _toolkit.CropPages(CreatePdf(2), 50, 50, 100, 100, "1");

        using var stream = new MemoryStream(cropped);
        using var document = PdfSharp.Pdf.IO.PdfReader.Open(stream, PdfSharp.Pdf.IO.PdfDocumentOpenMode.Import);
        document.Pages[0].CropBox.Width.Should().BeApproximately(document.Pages[0].MediaBox.Width - 100, 0.01);
        document.Pages[1].CropBox.IsEmpty.Should().BeTrue();
    }

    [Fact]
    public void CropPages_RejectsMarginsThatLeaveNothing()
    {
        var act = () => _toolkit.CropPages(CreatePdf(1), 400, 400, 0, 0, null);

        act.Should().Throw<ArgumentException>().WithMessage("*leave nothing*");
    }

    [Fact]
    public void StampImage_AddsThePictureToSelectedPages()
    {
        var stamped = _toolkit.StampImage(CreatePdf(2), CreatePng(), 72, 72, 100, "2");

        using var document = PigDocument.Open(stamped);
        document.GetPage(1).GetImages().Should().BeEmpty();
        document.GetPage(2).GetImages().Should().ContainSingle();
    }

    [Fact]
    public void ExtractImages_ReturnsEachPictureOnce()
    {
        var stamped = _toolkit.StampImage(CreatePdf(2), CreatePng(), 72, 72, 100, null);

        using var zip = new ZipArchive(new MemoryStream(_toolkit.ExtractImages(stamped)));

        zip.Entries.Should().ContainSingle().Which.Name.Should().EndWith(".png");
    }

    [Fact]
    public void ExtractImages_ExplainsWhenThereAreNone()
    {
        var act = () => _toolkit.ExtractImages(CreatePdf(1));

        act.Should().Throw<InvalidOperationException>().WithMessage("*no pictures*");
    }

    [Fact]
    public void ListFormFields_IsEmptyForAPdfWithoutAForm()
    {
        _toolkit.ListFormFields(CreatePdf(1)).Should().BeEmpty();
    }

    [Fact]
    public async Task RedactAsync_FailsLoudlyWhenNothingMatches()
    {
        var act = () => _toolkit.RedactAsync(CreatePdf(1), ["not in this document"]);

        await act.Should().ThrowAsync<NoRedactionMatchException>();
    }

    [Fact]
    public async Task MakeSearchableAsync_LeavesPdfsWithTextUnchanged()
    {
        var pdf = CreatePdf(1, label: "Enough text on this page to count as a normal text layer");

        var result = await _toolkit.MakeSearchableAsync(pdf);

        result.OcrPages.Should().Be(0);
        result.Pdf.Should().BeSameAs(pdf);
    }

    [Theory]
    [InlineData("john", new[] { "John" })]
    [InlineData("john smith", new[] { "John", "Smith," })]
    [InlineData("smith", new[] { "Smith,", "smith" })]
    [InlineData("0412", new[] { "0412-555" })]
    [InlineData("absent", new string[0])]
    public void FindRedactionMatches_MatchesWholeWordsAcrossSpacesAndPunctuation(string term, string[] expected)
    {
        var words = new[] { "Call", "John", "Smith,", "on", "0412-555", "or", "smith" }
            .Select((text, index) => new LayoutWord(text, index * 50, index * 50 + 40, 100, 10)).ToList();

        PdfToolkitService.FindRedactionMatches(words, [term], matchCase: false).Select(word => word.Text).Should().Equal(expected);
    }

    [Fact]
    public void FindRedactionMatches_RespectsMatchCase()
    {
        var words = new[] { new LayoutWord("SECRET", 0, 40, 100, 10), new LayoutWord("secret", 50, 90, 100, 10) };

        PdfToolkitService.FindRedactionMatches(words, ["secret"], matchCase: true).Should().ContainSingle().Which.Left.Should().Be(50);
    }

    [Fact]
    public void PageSelection_KeepsOrderAndChecksBounds()
    {
        PageSelection.Parse("3,1,2-3", 3).Should().Equal(3, 1, 2, 3);
        PageSelection.ParseGroups("1-2,3", 3).Should().HaveCount(2);

        foreach (var invalid in new[] { "4", "0", "1-9", "a", "1-2-3", "", null })
        {
            var act = () => PageSelection.Parse(invalid, 3);
            act.Should().Throw<ArgumentException>();
        }
    }

    [Fact]
    public void PageSelection_HugeRangesAreRejectedBeforeExpanding()
    {
        var act = () => PageSelection.Parse("1-2000000000", 3);

        act.Should().Throw<ArgumentException>().WithMessage("*outside*");
    }

    private static List<string> ReadEntryLabels(ZipArchiveEntry entry)
    {
        using var source = entry.Open();
        using var buffer = new MemoryStream();
        source.CopyTo(buffer);
        return PageLabels(buffer.ToArray());
    }

    private static List<string> PageLabels(byte[] pdf)
    {
        using var document = PigDocument.Open(pdf);
        return document.GetPages().Select(page => page.Text.Replace(" ", string.Empty)).ToList();
    }

    private static byte[] CreatePdf(int pageCount, string? label = null)
    {
        using var document = new PdfDocument();
        var font = new XFont("Arial", 12);
        for (var index = 1; index <= pageCount; index++)
        {
            var page = document.AddPage();
            using var graphics = XGraphics.FromPdfPage(page);
            graphics.DrawString(label ?? $"Page{index}", font, XBrushes.Black, new XPoint(72, 72));
        }

        using var output = new MemoryStream();
        document.Save(output);
        return output.ToArray();
    }

    private static byte[] CreatePng()
    {
        using var bitmap = new SKBitmap(8, 8);
        bitmap.Erase(SKColors.SteelBlue);
        using var data = bitmap.Encode(SKEncodedImageFormat.Png, 100);
        return data.ToArray();
    }
}
