using System.Security.Cryptography;
using System.Text;
using PdfAI.API.Models;
using SkiaSharp;
using UglyToad.PdfPig;

namespace PdfAI.API.Services;

public class PdfCompareService
{
    private const int MaxPreviewPages = 12;

    private readonly DocumentConversionService _conversionService;
    private readonly ILogger<PdfCompareService> _logger;

    public PdfCompareService(DocumentConversionService conversionService, ILogger<PdfCompareService> logger)
    {
        _conversionService = conversionService;
        _logger = logger;
    }

    public async Task<PdfCompareResult> CompareAsync(byte[] leftPdfBytes, byte[] rightPdfBytes)
    {
        var result = new PdfCompareResult();
        var leftPages = ExtractPages(leftPdfBytes);
        var rightPages = ExtractPages(rightPdfBytes);
        var pageCount = Math.Max(leftPages.Count, rightPages.Count);

        result.Summary.LeftPageCount = leftPages.Count;
        result.Summary.RightPageCount = rightPages.Count;
        result.Summary.ComparedPageCount = pageCount;

        var visualResults = await TryCreateVisualDiffs(leftPdfBytes, rightPdfBytes, pageCount, result.Warnings);

        for (var pageIndex = 0; pageIndex < pageCount; pageIndex++)
        {
            var left = pageIndex < leftPages.Count ? leftPages[pageIndex] : PdfComparePage.Empty(pageIndex + 1);
            var right = pageIndex < rightPages.Count ? rightPages[pageIndex] : PdfComparePage.Empty(pageIndex + 1);
            visualResults.TryGetValue(pageIndex + 1, out var visual);

            var lines = BuildLineDiff(left.Lines, right.Lines);
            var addedLineCount = lines.Count(line => line.Type == "added");
            var removedLineCount = lines.Count(line => line.Type == "removed");
            var changedImageCount = CountChangedImages(left.ImageHashes, right.ImageHashes);
            var visualDifference = visual?.VisualDifferencePercent;
            var changed = addedLineCount > 0 ||
                removedLineCount > 0 ||
                changedImageCount > 0 ||
                (visualDifference.HasValue && visualDifference.Value > 0.05) ||
                pageIndex >= leftPages.Count ||
                pageIndex >= rightPages.Count;

            result.Pages.Add(new PdfPageCompareResult
            {
                PageNumber = pageIndex + 1,
                Status = GetPageStatus(pageIndex, leftPages.Count, rightPages.Count, changed),
                LeftLineCount = left.Lines.Count,
                RightLineCount = right.Lines.Count,
                AddedLineCount = addedLineCount,
                RemovedLineCount = removedLineCount,
                LeftImageCount = left.ImageHashes.Count,
                RightImageCount = right.ImageHashes.Count,
                ChangedImageCount = changedImageCount,
                VisualDifferencePercent = visualDifference,
                LeftPreviewDataUrl = visual?.LeftPreviewDataUrl,
                RightPreviewDataUrl = visual?.RightPreviewDataUrl,
                DiffPreviewDataUrl = visual?.DiffPreviewDataUrl,
                Lines = lines
            });
        }

        result.Summary.ChangedPageCount = result.Pages.Count(page => page.Status != "unchanged");
        result.Summary.AddedLineCount = result.Pages.Sum(page => page.AddedLineCount);
        result.Summary.RemovedLineCount = result.Pages.Sum(page => page.RemovedLineCount);
        result.Summary.ChangedImageCount = result.Pages.Sum(page => page.ChangedImageCount);
        var visualPages = result.Pages.Where(page => page.VisualDifferencePercent.HasValue).ToArray();
        result.Summary.AverageVisualDifferencePercent = visualPages.Length == 0
            ? 0
            : Math.Round(visualPages.Average(page => page.VisualDifferencePercent!.Value), 2);

        return result;
    }

    private static List<PdfComparePage> ExtractPages(byte[] pdfBytes)
    {
        using var document = PdfDocument.Open(pdfBytes);
        return document.GetPages()
            .Select(page =>
            {
                var text = page.Text ?? string.Empty;
                var lines = text
                    .Replace("\r\n", "\n")
                    .Split('\n')
                    .Select(line => line.TrimEnd())
                    .ToList();

                var images = page.GetImages()
                    .Select(GetImageHash)
                    .Where(hash => !string.IsNullOrWhiteSpace(hash))
                    .ToList();

                return new PdfComparePage(page.Number, lines, images);
            })
            .ToList();
    }

    private async Task<Dictionary<int, VisualPageDiff>> TryCreateVisualDiffs(
        byte[] leftPdfBytes,
        byte[] rightPdfBytes,
        int pageCount,
        List<string> warnings)
    {
        try
        {
            var leftImages = await _conversionService.ConvertPdfToImages(leftPdfBytes, "png");
            var rightImages = await _conversionService.ConvertPdfToImages(rightPdfBytes, "png");
            var visualCount = Math.Min(Math.Min(leftImages.Count, rightImages.Count), Math.Min(pageCount, MaxPreviewPages));
            var results = new Dictionary<int, VisualPageDiff>();

            for (var index = 0; index < visualCount; index++)
            {
                results[index + 1] = CreateVisualDiff(leftImages[index], rightImages[index]);
            }

            if (pageCount > MaxPreviewPages)
            {
                warnings.Add($"Visual previews were generated for the first {MaxPreviewPages} pages only.");
            }

            return results;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not generate visual PDF comparison");
            warnings.Add("Visual page comparison is unavailable. Install Poppler and configure Tools:Poppler:PdfToPpmPath to enable rendered page diffs.");
            return new Dictionary<int, VisualPageDiff>();
        }
    }

    private static VisualPageDiff CreateVisualDiff(byte[] leftPng, byte[] rightPng)
    {
        using var leftBitmap = DecodeBitmap(leftPng);
        using var rightBitmap = DecodeBitmap(rightPng);
        var width = Math.Max(leftBitmap.Width, rightBitmap.Width);
        var height = Math.Max(leftBitmap.Height, rightBitmap.Height);
        using var normalizedLeft = NormalizeBitmap(leftBitmap, width, height);
        using var normalizedRight = NormalizeBitmap(rightBitmap, width, height);
        using var diffBitmap = new SKBitmap(width, height, SKColorType.Rgba8888, SKAlphaType.Premul);

        var changedPixels = 0L;
        var totalPixels = (long)width * height;

        for (var y = 0; y < height; y++)
        {
            for (var x = 0; x < width; x++)
            {
                var leftColor = normalizedLeft.GetPixel(x, y);
                var rightColor = normalizedRight.GetPixel(x, y);
                var distance = Math.Abs(leftColor.Red - rightColor.Red) +
                    Math.Abs(leftColor.Green - rightColor.Green) +
                    Math.Abs(leftColor.Blue - rightColor.Blue) +
                    Math.Abs(leftColor.Alpha - rightColor.Alpha);

                if (distance > 24)
                {
                    changedPixels++;
                    diffBitmap.SetPixel(x, y, new SKColor(239, 68, 68, 210));
                }
                else
                {
                    var gray = (byte)((leftColor.Red + leftColor.Green + leftColor.Blue) / 3);
                    diffBitmap.SetPixel(x, y, new SKColor(gray, gray, gray, 42));
                }
            }
        }

        return new VisualPageDiff(
            ToDataUrl(normalizedLeft),
            ToDataUrl(normalizedRight),
            ToDataUrl(diffBitmap),
            Math.Round(changedPixels * 100d / totalPixels, 2));
    }

    private static SKBitmap DecodeBitmap(byte[] pngBytes)
    {
        using var data = SKData.CreateCopy(pngBytes);
        return SKBitmap.Decode(data) ?? throw new InvalidOperationException("Could not decode rendered page image.");
    }

    private static SKBitmap NormalizeBitmap(SKBitmap source, int width, int height)
    {
        var bitmap = new SKBitmap(width, height, SKColorType.Rgba8888, SKAlphaType.Premul);
        using var canvas = new SKCanvas(bitmap);
        canvas.Clear(SKColors.White);
        using var paint = new SKPaint { IsAntialias = true };
        canvas.DrawBitmap(source, new SKRect(0, 0, source.Width, source.Height), paint);
        canvas.Flush();
        return bitmap;
    }

    private static string ToDataUrl(SKBitmap bitmap)
    {
        using var image = SKImage.FromBitmap(bitmap);
        using var data = image.Encode(SKEncodedImageFormat.Png, 82);
        return $"data:image/png;base64,{Convert.ToBase64String(data.ToArray())}";
    }

    private static List<PdfCompareLine> BuildLineDiff(IReadOnlyList<string> left, IReadOnlyList<string> right)
    {
        var lcs = new int[left.Count + 1, right.Count + 1];
        for (var i = left.Count - 1; i >= 0; i--)
        {
            for (var j = right.Count - 1; j >= 0; j--)
            {
                lcs[i, j] = string.Equals(left[i], right[j], StringComparison.Ordinal)
                    ? lcs[i + 1, j + 1] + 1
                    : Math.Max(lcs[i + 1, j], lcs[i, j + 1]);
            }
        }

        var lines = new List<PdfCompareLine>();
        var leftIndex = 0;
        var rightIndex = 0;

        while (leftIndex < left.Count && rightIndex < right.Count)
        {
            if (string.Equals(left[leftIndex], right[rightIndex], StringComparison.Ordinal))
            {
                lines.Add(new PdfCompareLine
                {
                    Type = "unchanged",
                    LeftLineNumber = leftIndex + 1,
                    RightLineNumber = rightIndex + 1,
                    LeftText = left[leftIndex],
                    RightText = right[rightIndex]
                });
                leftIndex++;
                rightIndex++;
            }
            else if (lcs[leftIndex + 1, rightIndex] >= lcs[leftIndex, rightIndex + 1])
            {
                lines.Add(new PdfCompareLine
                {
                    Type = "removed",
                    LeftLineNumber = leftIndex + 1,
                    LeftText = left[leftIndex]
                });
                leftIndex++;
            }
            else
            {
                lines.Add(new PdfCompareLine
                {
                    Type = "added",
                    RightLineNumber = rightIndex + 1,
                    RightText = right[rightIndex]
                });
                rightIndex++;
            }
        }

        while (leftIndex < left.Count)
        {
            lines.Add(new PdfCompareLine
            {
                Type = "removed",
                LeftLineNumber = leftIndex + 1,
                LeftText = left[leftIndex]
            });
            leftIndex++;
        }

        while (rightIndex < right.Count)
        {
            lines.Add(new PdfCompareLine
            {
                Type = "added",
                RightLineNumber = rightIndex + 1,
                RightText = right[rightIndex]
            });
            rightIndex++;
        }

        return lines;
    }

    private static int CountChangedImages(IReadOnlyList<string> leftHashes, IReadOnlyList<string> rightHashes)
    {
        var leftCounts = leftHashes.GroupBy(hash => hash).ToDictionary(group => group.Key, group => group.Count());
        var rightCounts = rightHashes.GroupBy(hash => hash).ToDictionary(group => group.Key, group => group.Count());
        return leftCounts.Keys
            .Union(rightCounts.Keys)
            .Sum(hash => Math.Abs(leftCounts.GetValueOrDefault(hash) - rightCounts.GetValueOrDefault(hash)));
    }

    private static string GetImageHash(UglyToad.PdfPig.Content.IPdfImage image)
    {
        if (!image.TryGetPng(out var pngBytes))
        {
            pngBytes = image.RawBytes.ToArray();
        }

        if (pngBytes.Length == 0)
        {
            return string.Empty;
        }

        return Convert.ToHexString(SHA256.HashData(pngBytes));
    }

    private static string GetPageStatus(int pageIndex, int leftCount, int rightCount, bool changed)
    {
        if (pageIndex >= leftCount)
        {
            return "added";
        }

        if (pageIndex >= rightCount)
        {
            return "removed";
        }

        return changed ? "changed" : "unchanged";
    }

    private sealed record PdfComparePage(int PageNumber, List<string> Lines, List<string> ImageHashes)
    {
        public static PdfComparePage Empty(int pageNumber) => new(pageNumber, new List<string>(), new List<string>());
    }

    private sealed record VisualPageDiff(
        string LeftPreviewDataUrl,
        string RightPreviewDataUrl,
        string DiffPreviewDataUrl,
        double VisualDifferencePercent);
}
