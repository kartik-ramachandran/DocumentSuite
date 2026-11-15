using System.Runtime.InteropServices;
using SkiaSharp;

namespace PdfAI.API.Services.Ocr;

/// <summary>
/// Maps positions on a straightened page image back to the page as it's displayed.
/// The page picture was turned <see cref="Angle"/> degrees clockwise about its centre to make its text upright and level.
/// All sizes are in points from the top-left.
/// </summary>
public sealed record OcrFrame(double Angle, double PageWidth, double PageHeight, double Width, double Height)
{
    public static OcrFrame Identity(double width, double height) => new(0, width, height, width, height);

    public bool IsIdentity => Math.Abs(Angle) < 0.001;

    /// <summary>The angle of a line of text on the displayed page, clockwise in degrees.</summary>
    public double TextAngle => -Angle;

    public (double X, double Y) ToPage(double x, double y)
    {
        if (IsIdentity)
            return (x, y);
        var radians = -Angle * Math.PI / 180;
        var (cos, sin) = (Math.Cos(radians), Math.Sin(radians));
        var dx = x - Width / 2;
        var dy = y - Height / 2;
        return (PageWidth / 2 + dx * cos - dy * sin, PageHeight / 2 + dx * sin + dy * cos);
    }

    /// <summary>The smallest upright box on the displayed page that holds the word.</summary>
    public (double Left, double Top, double Right, double Bottom) ToPageBox(double left, double top, double right, double bottom)
    {
        if (IsIdentity)
            return (left, top, right, bottom);
        var corners = new[] { ToPage(left, top), ToPage(right, top), ToPage(left, bottom), ToPage(right, bottom) };
        return (corners.Min(c => c.X), corners.Min(c => c.Y), corners.Max(c => c.X), corners.Max(c => c.Y));
    }
}

public sealed record PreparedImage(byte[] Png, int PixelWidth, int PixelHeight, OcrFrame Frame);

/// <summary>Turns, straightens and boosts the contrast of a rendered page before OCR.</summary>
public static class OcrImagePreparer
{
    private const int SkewSampleWidth = 1000;
    private const double MaxSkew = 5;          // degrees; steeper pages are left for the engine
    private const double MinSkew = 0.15;       // degrees; smaller tilts aren't worth resampling for
    private const int MinDarkPixels = 400;
    private const int MaxSkewSamples = 150_000;

    /// <param name="rotation">A clockwise turn (0, 90, 180 or 270) that makes the text upright.</param>
    public static PreparedImage Prepare(byte[] png, int dpi, int rotation, bool deskew)
    {
        using var source = SKBitmap.Decode(png) ?? throw new InvalidOperationException("The rendered page couldn't be read.");
        var pointsPerPixel = 72d / dpi;
        var swap = rotation is 90 or 270;
        var width = swap ? source.Height : source.Width;
        var height = swap ? source.Width : source.Height;

        var skew = 0d;
        if (deskew)
        {
            var sampleScale = Math.Min(1, SkewSampleWidth / (double)width);
            using var sample = Draw(source, rotation, (int)Math.Round(width * sampleScale), (int)Math.Round(height * sampleScale), sampleScale);
            skew = EstimateSkew(ToGray(sample), sample.Width, sample.Height);
        }

        var angle = rotation + skew;
        byte[] gray;
        if (Math.Abs(angle) < 0.001)
        {
            gray = ToGray(source);
        }
        else
        {
            using var turned = Draw(source, angle, width, height, 1);
            gray = ToGray(turned);
        }

        StretchContrast(gray);
        var frame = new OcrFrame(
            angle,
            source.Width * pointsPerPixel,
            source.Height * pointsPerPixel,
            width * pointsPerPixel,
            height * pointsPerPixel);
        return new PreparedImage(EncodeGray(gray, width, height), width, height, frame);
    }

    /// <summary>Converts a rendered region to greyscale with stretched contrast, without turning it.</summary>
    public static byte[] PrepareRegion(byte[] png)
    {
        using var source = SKBitmap.Decode(png) ?? throw new InvalidOperationException("The rendered region couldn't be read.");
        var gray = ToGray(source);
        StretchContrast(gray);
        return EncodeGray(gray, source.Width, source.Height);
    }

    /// <summary>
    /// Finds the clockwise turn, within ±5°, that makes text lines level. Dark pixels are projected onto the vertical axis
    /// at each candidate angle, and level lines give the sharpest profile.
    /// </summary>
    public static double EstimateSkew(byte[] gray, int width, int height)
    {
        var threshold = OtsuThreshold(gray);
        var points = new List<(float X, float Y)>();
        for (var y = 0; y < height; y++)
        {
            for (var x = 0; x < width; x++)
            {
                if (gray[y * width + x] <= threshold)
                    points.Add((x - width / 2f, y - height / 2f));
            }
        }

        if (points.Count < MinDarkPixels)
            return 0;
        if (points.Count > MaxSkewSamples)
        {
            var step = points.Count / (double)MaxSkewSamples;
            points = Enumerable.Range(0, MaxSkewSamples).Select(i => points[(int)(i * step)]).ToList();
        }

        var extent = (int)Math.Ceiling(Math.Sqrt(width * width + height * height)) + 2;
        var bins = new int[extent];

        double Score(double degrees)
        {
            Array.Clear(bins);
            var radians = degrees * Math.PI / 180;
            var (sin, cos) = ((float)Math.Sin(radians), (float)Math.Cos(radians));
            var offset = extent / 2;
            foreach (var (x, y) in points)
            {
                var bin = (int)(x * sin + y * cos) + offset;
                if ((uint)bin < (uint)extent)
                    bins[bin]++;
            }

            double score = 0;
            for (var i = 1; i < extent; i++)
            {
                double difference = bins[i] - bins[i - 1];
                score += difference * difference;
            }

            return score;
        }

        var best = 0d;
        var bestScore = Score(0);
        for (var degrees = -MaxSkew; degrees <= MaxSkew + 1e-9; degrees += 0.25)
        {
            var score = Score(degrees);
            if (score > bestScore)
                (best, bestScore) = (degrees, score);
        }

        var coarse = best;
        for (var degrees = coarse - 0.25; degrees <= coarse + 0.25 + 1e-9; degrees += 0.05)
        {
            var score = Score(degrees);
            if (score > bestScore)
                (best, bestScore) = (degrees, score);
        }

        // An answer at the edge of the range usually means a picture, not tilted text.
        return Math.Abs(best) < MinSkew || Math.Abs(best) >= MaxSkew - 0.01 ? 0 : Math.Round(best, 2);
    }

    // Draws the source turned clockwise about its centre onto a white canvas of the given size.
    private static SKBitmap Draw(SKBitmap source, double angle, int width, int height, double scale)
    {
        var target = new SKBitmap(new SKImageInfo(Math.Max(width, 1), Math.Max(height, 1), SKColorType.Rgba8888, SKAlphaType.Premul));
        using var canvas = new SKCanvas(target);
        canvas.Clear(SKColors.White);
        canvas.Translate(width / 2f, height / 2f);
        canvas.RotateDegrees((float)angle);
        canvas.Scale((float)scale);
        canvas.Translate(-source.Width / 2f, -source.Height / 2f);
        using var image = SKImage.FromBitmap(source);
        canvas.DrawImage(image, 0, 0, new SKSamplingOptions(SKFilterMode.Linear, SKMipmapMode.Linear));
        canvas.Flush();
        return target;
    }

    private static byte[] ToGray(SKBitmap bitmap)
    {
        using var rgba = bitmap.ColorType == SKColorType.Rgba8888 ? null : bitmap.Copy(SKColorType.Rgba8888);
        var pixels = (rgba ?? bitmap).Bytes;
        var rowBytes = (rgba ?? bitmap).RowBytes;
        var gray = new byte[bitmap.Width * bitmap.Height];
        for (var y = 0; y < bitmap.Height; y++)
        {
            for (var x = 0; x < bitmap.Width; x++)
            {
                var i = y * rowBytes + x * 4;
                int alpha = pixels[i + 3];
                // Transparent areas read as white paper.
                var value = (pixels[i] * 299 + pixels[i + 1] * 587 + pixels[i + 2] * 114) / 1000;
                gray[y * bitmap.Width + x] = (byte)((value * alpha + 255 * (255 - alpha)) / 255);
            }
        }

        return gray;
    }

    // Faded scans are stretched so their darkest 1% becomes black and lightest 1% white.
    private static void StretchContrast(byte[] gray)
    {
        var histogram = new int[256];
        foreach (var value in gray)
            histogram[value]++;
        var clip = gray.Length / 100;
        int low = 0, high = 255, count = 0;
        while (low < 255 && (count += histogram[low]) <= clip)
            low++;
        count = 0;
        while (high > 0 && (count += histogram[high]) <= clip)
            high--;
        if (high - low < 32 || high - low > 220)
            return;

        var map = new byte[256];
        for (var i = 0; i < 256; i++)
            map[i] = (byte)Math.Clamp((i - low) * 255 / (high - low), 0, 255);
        for (var i = 0; i < gray.Length; i++)
            gray[i] = map[gray[i]];
    }

    private static int OtsuThreshold(byte[] gray)
    {
        var histogram = new int[256];
        foreach (var value in gray)
            histogram[value]++;
        double sum = 0;
        for (var i = 0; i < 256; i++)
            sum += i * (double)histogram[i];

        double sumBackground = 0, bestVariance = 0;
        int background = 0, threshold = 128;
        for (var i = 0; i < 256; i++)
        {
            background += histogram[i];
            if (background == 0)
                continue;
            var foreground = gray.Length - background;
            if (foreground == 0)
                break;
            sumBackground += i * (double)histogram[i];
            var meanBackground = sumBackground / background;
            var meanForeground = (sum - sumBackground) / foreground;
            var variance = (double)background * foreground * (meanBackground - meanForeground) * (meanBackground - meanForeground);
            if (variance > bestVariance)
                (bestVariance, threshold) = (variance, i);
        }

        return threshold;
    }

    private static byte[] EncodeGray(byte[] gray, int width, int height)
    {
        using var bitmap = new SKBitmap(new SKImageInfo(width, height, SKColorType.Gray8, SKAlphaType.Opaque));
        var pointer = bitmap.GetPixels();
        for (var y = 0; y < height; y++)
            Marshal.Copy(gray, y * width, pointer + y * bitmap.RowBytes, width);
        using var data = bitmap.Encode(SKEncodedImageFormat.Png, 100);
        return data.ToArray();
    }
}
