using System.Globalization;
using System.IO.Compression;

namespace PdfAI.API.Services;

public static class ImageArchive
{
    public static byte[] Create(IReadOnlyList<byte[]> images, string extension)
    {
        var nameWidth = Math.Max(3, images.Count.ToString(CultureInfo.InvariantCulture).Length);
        using var stream = new MemoryStream();
        using (var archive = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
        {
            for (var index = 0; index < images.Count; index++)
            {
                // JPEG and PNG are already compressed, so zipping them again only costs time.
                var number = (index + 1).ToString(CultureInfo.InvariantCulture).PadLeft(nameWidth, '0');
                var entry = archive.CreateEntry($"page_{number}.{extension}", CompressionLevel.NoCompression);
                using var entryStream = entry.Open();
                entryStream.Write(images[index]);
            }
        }

        return stream.ToArray();
    }
}
