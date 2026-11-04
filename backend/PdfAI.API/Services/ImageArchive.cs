using System.Globalization;
using System.IO.Compression;

namespace PdfAI.API.Services;

public static class ImageArchive
{
    public static byte[] Create(IReadOnlyList<byte[]> images, string extension)
    {
        var nameWidth = Math.Max(3, images.Count.ToString(CultureInfo.InvariantCulture).Length);
        var files = images.Select((image, index) =>
            ($"page_{(index + 1).ToString(CultureInfo.InvariantCulture).PadLeft(nameWidth, '0')}.{extension}", image));

        // JPEG and PNG are already compressed, so zipping them again only costs time.
        return CreateNamed(files, compress: false);
    }

    public static byte[] CreateNamed(IEnumerable<(string Name, byte[] Content)> files, bool compress)
    {
        using var stream = new MemoryStream();
        using (var archive = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
        {
            foreach (var (name, content) in files)
            {
                var entry = archive.CreateEntry(name, compress ? CompressionLevel.Fastest : CompressionLevel.NoCompression);
                using var entryStream = entry.Open();
                entryStream.Write(content);
            }
        }

        return stream.ToArray();
    }
}
