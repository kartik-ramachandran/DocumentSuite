using FluentAssertions;
using PdfAI.API.Services;
using PdfSharp.Pdf;

namespace PdfAI.API.Tests;

public class PdfProcessingServiceTests
{
    private readonly PdfProcessingService _service;

    public PdfProcessingServiceTests()
    {
        _service = TestServices.CreateProcessingService();
    }

    // ── Merge ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task MergePdfs_ShouldCombinePages()
    {
        var a = CreatePdf(1);
        var b = CreatePdf(2);

        var result = await _service.MergePdfs(new List<byte[]> { a, b });

        result.Should().NotBeEmpty();
        PageCount(result).Should().Be(3);
    }

    [Fact]
    public async Task MergePdfs_ShouldThrow_WhenListIsEmpty()
    {
        var act = () => _service.MergePdfs(new List<byte[]>());
        await act.Should().ThrowAsync<ArgumentException>();
    }

    // ── Split / Extract ───────────────────────────────────────────────────────

    [Fact]
    public async Task SplitPdf_ShouldReturnOneDocumentPerPage()
    {
        var pdf = CreatePdf(3);

        var results = await _service.SplitPdf(pdf, "pages");

        results.Should().HaveCount(3);
        results.Should().AllSatisfy(r => r.Should().NotBeEmpty());
    }

    [Fact]
    public async Task ExtractPdfPages_ShouldReturnOnlySelectedPages()
    {
        var pdf = CreatePdf(3);

        var result = await _service.ExtractPdfPages(pdf, new[] { 1, 3 });

        result.Should().NotBeEmpty();
        PageCount(result).Should().Be(2);
    }

    [Fact]
    public async Task ExtractPdfPages_ShouldThrow_WhenPageOutOfRange()
    {
        var pdf = CreatePdf(2);

        var act = () => _service.ExtractPdfPages(pdf, new[] { 5 });
        await act.Should().ThrowAsync<ArgumentOutOfRangeException>();
    }

    [Fact]
    public async Task ExtractPdfPages_ShouldThrow_WhenNoPageSelected()
    {
        var pdf = CreatePdf(1);

        var act = () => _service.ExtractPdfPages(pdf, Array.Empty<int>());
        await act.Should().ThrowAsync<ArgumentException>();
    }

    // ── Compress ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task CompressPdf_ShouldReturnValidPdf()
    {
        var pdf = CreatePdf(1);

        var result = await _service.CompressPdf(pdf);

        result.Should().NotBeEmpty();
        PageCount(result).Should().Be(1);
    }

    // ── Rotate ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task RotatePdf_ShouldReturnValidPdf()
    {
        var pdf = CreatePdf(1);

        var result = await _service.RotatePdf(pdf, 90);

        result.Should().NotBeEmpty();
        PageCount(result).Should().Be(1);
    }

    [Fact]
    public async Task RotatePdf_ShouldThrow_WhenDegreesNotMultipleOf90()
    {
        var pdf = CreatePdf(1);

        var act = () => _service.RotatePdf(pdf, 45);
        await act.Should().ThrowAsync<ArgumentException>();
    }

    // ── Watermark ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task AddWatermark_ShouldReturnValidPdf()
    {
        var pdf = CreatePdf(1);

        var result = await _service.AddWatermark(pdf, "DRAFT");

        result.Should().NotBeEmpty();
        PageCount(result).Should().Be(1);
    }

    // ── Page numbers ──────────────────────────────────────────────────────────

    [Fact]
    public void AddPageNumbers_ShouldReturnValidPdf()
    {
        var pdf = CreatePdf(2);

        var result = _service.AddPageNumbers(pdf);

        result.Should().NotBeEmpty();
        PageCount(result).Should().Be(2);
    }

    // ── Repair ────────────────────────────────────────────────────────────────

    [Fact]
    public void RepairPdf_ShouldReturnValidPdf()
    {
        var pdf = CreatePdf(1);

        var result = _service.RepairPdf(pdf);

        result.Should().NotBeEmpty();
        PageCount(result).Should().Be(1);
    }

    // ── Protect / Unlock ──────────────────────────────────────────────────────

    [Fact]
    public void ProtectPdf_ShouldReturnPasswordProtectedPdf()
    {
        var pdf = CreatePdf(1);

        var result = _service.ProtectPdf(pdf, "user123", "owner123");

        result.Should().NotBeEmpty();
    }

    [Fact]
    public void UnlockPdf_ShouldReturnOpenPdf()
    {
        var pdf = CreatePdf(1);
        var protected_ = _service.ProtectPdf(pdf, "pass", "pass");

        var result = _service.UnlockPdf(protected_, "pass");

        result.Should().NotBeEmpty();
        PageCount(result).Should().Be(1);
    }

    [Fact]
    public void UnlockPdf_ShouldThrow_WhenPasswordIsWrong()
    {
        var pdf = CreatePdf(1);
        var protected_ = _service.ProtectPdf(pdf, "correct", "correct");

        var act = () => _service.UnlockPdf(protected_, "wrong");
        act.Should().Throw<Exception>();
    }

    // ── OCR ───────────────────────────────────────────────────────────────────

    [Fact]
    public async Task OcrPdf_ShouldReturnString()
    {
        var pdf = CreatePdf(1);

        var result = await _service.OcrPdf(pdf);

        result.Should().NotBeNull();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static byte[] CreatePdf(int pageCount)
    {
        using var doc = new PdfDocument();
        for (var i = 0; i < pageCount; i++)
        {
            doc.AddPage();
        }
        using var stream = new MemoryStream();
        doc.Save(stream);
        return stream.ToArray();
    }

    private static int PageCount(byte[] pdfBytes)
    {
        using var stream = new MemoryStream(pdfBytes);
        using var doc = PdfSharp.Pdf.IO.PdfReader.Open(stream, PdfSharp.Pdf.IO.PdfDocumentOpenMode.Import);
        return doc.PageCount;
    }
}
