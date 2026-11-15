using System.Globalization;
using System.Text;
using PdfSharp.Pdf;
using PdfSharp.Pdf.Advanced;

namespace PdfAI.API.Services.Ocr;

/// <summary>A word to write as invisible text. Positions are in points on the displayed page, from the top-left.</summary>
/// <param name="X">Where the word's baseline starts.</param>
/// <param name="Angle">The direction the text runs, clockwise in degrees.</param>
public readonly record struct PlacedWord(string Text, double X, double Y, double Width, double FontSize, double Angle);

/// <summary>
/// Adds OCR text to a page as an invisible layer over the original content, so it can be selected and searched while the page
/// looks the same. Like Tesseract's own PDF output, it uses a font with no visible glyphs and maps every character code to its
/// Unicode value, so any script survives copy and search.
/// </summary>
public static class TextLayerWriter
{
    private const int GlyphAdvance = 500;  // in 1/1000 em; every character has the same width
    private const string FontResource = "/OcrText";

    private static readonly string[] FontSearchPaths =
    [
        "/usr/share/tesseract-ocr/5/tessdata/pdf.ttf",
        "/usr/share/tesseract-ocr/4.00/tessdata/pdf.ttf",
        "/usr/share/tessdata/pdf.ttf",
        "/usr/local/share/tessdata/pdf.ttf",
        @"C:\Program Files\Tesseract-OCR\tessdata\pdf.ttf"
    ];

    /// <summary>Writes the words onto the page. Call <see cref="CreateFont"/> once per document and pass the result to each page.</summary>
    public static void AddText(PdfPage page, PdfReference font, IReadOnlyList<PlacedWord> words)
    {
        if (words.Count == 0)
            return;

        var resources = page.Elements.GetDictionary("/Resources");
        if (resources is null)
        {
            resources = new PdfDictionary(page.Owner);
            page.Elements["/Resources"] = resources;
        }

        var fonts = resources.Elements.GetDictionary("/Font");
        if (fonts is null)
        {
            fonts = new PdfDictionary(page.Owner);
            resources.Elements["/Font"] = fonts;
        }

        var name = FontResource;
        for (var suffix = 1; fonts.Elements.ContainsKey(name); suffix++)
            name = FontResource + suffix.ToString(CultureInfo.InvariantCulture);
        fonts.Elements[name] = font;

        var mapping = PageMapping.For(page);
        var content = new StringBuilder();
        content.Append("BT\n3 Tr\n").Append(name).Append(" 1 Tf\n");
        foreach (var word in words)
        {
            var text = Encode(word.Text, out var length);
            if (length == 0 || word.Width <= 0 || word.FontSize <= 0)
                continue;

            var radians = word.Angle * Math.PI / 180;
            var (cos, sin) = (Math.Cos(radians), Math.Sin(radians));
            var horizontal = word.Width / (length * GlyphAdvance / 1000d);
            var (bx, by) = mapping.Vector(cos, sin);   // along the baseline
            var (ux, uy) = mapping.Vector(sin, -cos);  // towards the top of the letters
            var (x, y) = mapping.Point(word.X, word.Y);
            content.Append(Number(bx * horizontal)).Append(' ').Append(Number(by * horizontal)).Append(' ')
                .Append(Number(ux * word.FontSize)).Append(' ').Append(Number(uy * word.FontSize)).Append(' ')
                .Append(Number(x)).Append(' ').Append(Number(y)).Append(" Tm\n<").Append(text).Append("> Tj\n");
        }

        content.Append("ET\n");

        // The original content is wrapped so any graphics state it leaves behind can't move the text.
        page.Contents.PrependContent().CreateStream(Encoding.ASCII.GetBytes("q\n"));
        page.Contents.AppendContent().CreateStream(Encoding.ASCII.GetBytes("Q\n" + content));
    }

    /// <summary>Creates the invisible font. Tesseract's glyphless font is embedded when it's installed.</summary>
    public static PdfReference CreateFont(PdfDocument document, string? fontPath = null)
    {
        var glyphless = FindGlyphlessFont(fontPath);

        var descriptor = new PdfDictionary(document);
        descriptor.Elements["/Type"] = new PdfName("/FontDescriptor");
        descriptor.Elements["/FontName"] = new PdfName("/GlyphLessFont");
        descriptor.Elements["/Flags"] = new PdfInteger(5);
        descriptor.Elements["/FontBBox"] = new PdfArray(document, new PdfInteger(0), new PdfInteger(0), new PdfInteger(GlyphAdvance), new PdfInteger(1000));
        descriptor.Elements["/ItalicAngle"] = new PdfInteger(0);
        descriptor.Elements["/Ascent"] = new PdfInteger(1000);
        descriptor.Elements["/Descent"] = new PdfInteger(0);
        descriptor.Elements["/CapHeight"] = new PdfInteger(1000);
        descriptor.Elements["/StemV"] = new PdfInteger(80);
        if (glyphless is not null)
        {
            var fontFile = AddStream(document, glyphless);
            fontFile.Elements["/Length1"] = new PdfInteger(glyphless.Length);
            descriptor.Elements["/FontFile2"] = fontFile.Reference!;
        }
        document.Internals.AddObject(descriptor);

        var systemInfo = new PdfDictionary(document);
        systemInfo.Elements["/Registry"] = new PdfString("Adobe");
        systemInfo.Elements["/Ordering"] = new PdfString("Identity");
        systemInfo.Elements["/Supplement"] = new PdfInteger(0);

        var cidFont = new PdfDictionary(document);
        cidFont.Elements["/Type"] = new PdfName("/Font");
        cidFont.Elements["/Subtype"] = new PdfName("/CIDFontType2");
        cidFont.Elements["/BaseFont"] = new PdfName("/GlyphLessFont");
        cidFont.Elements["/CIDSystemInfo"] = systemInfo;
        cidFont.Elements["/FontDescriptor"] = descriptor.Reference!;
        cidFont.Elements["/DW"] = new PdfInteger(GlyphAdvance);
        // The glyphless font draws every character with its one empty glyph.
        cidFont.Elements["/CIDToGIDMap"] = glyphless is null ? new PdfName("/Identity") : AddStream(document, GlyphMap()).Reference!;
        document.Internals.AddObject(cidFont);

        var font = new PdfDictionary(document);
        font.Elements["/Type"] = new PdfName("/Font");
        font.Elements["/Subtype"] = new PdfName("/Type0");
        font.Elements["/BaseFont"] = new PdfName("/GlyphLessFont");
        font.Elements["/Encoding"] = new PdfName("/Identity-H");
        font.Elements["/DescendantFonts"] = new PdfArray(document, cidFont.Reference!);
        font.Elements["/ToUnicode"] = AddStream(document, Encoding.ASCII.GetBytes(ToUnicodeMap())).Reference!;
        document.Internals.AddObject(font);
        return font.Reference!;
    }

    /// <summary>Encodes text as two-byte codes equal to each character's Unicode value.</summary>
    public static string Encode(string text, out int length)
    {
        var hex = new StringBuilder(text.Length * 4);
        length = 0;
        for (var i = 0; i < text.Length; i++)
        {
            var character = text[i];
            if (char.IsWhiteSpace(character) || char.IsControl(character))
                continue;
            if (char.IsHighSurrogate(character) && i + 1 < text.Length && char.IsLowSurrogate(text[i + 1]))
            {
                // Characters beyond the first 65,536 don't fit a two-byte code, so they read as a replacement character.
                character = '\uFFFD';
                i++;
            }
            else if (char.IsSurrogate(character))
            {
                character = '\uFFFD';
            }

            hex.Append(((int)character).ToString("X4", CultureInfo.InvariantCulture));
            length++;
        }

        return hex.ToString();
    }

    // Each range maps 256 codes to the same Unicode values. Surrogate codes are left out, since they aren't characters.
    private static string ToUnicodeMap()
    {
        var ranges = Enumerable.Range(0, 256).Where(high => high is < 0xD8 or > 0xDF).ToList();
        var map = new StringBuilder();
        map.Append("/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n")
            .Append("/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n")
            .Append("/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n")
            .Append("1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n");
        foreach (var chunk in ranges.Chunk(100))
        {
            map.Append(chunk.Length.ToString(CultureInfo.InvariantCulture)).Append(" beginbfrange\n");
            foreach (var high in chunk)
                map.Append(CultureInfo.InvariantCulture, $"<{high:X2}00> <{high:X2}FF> <{high:X2}00>\n");
            map.Append("endbfrange\n");
        }

        map.Append("endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n");
        return map.ToString();
    }

    private static byte[] GlyphMap()
    {
        var map = new byte[65536 * 2];
        for (var i = 1; i < map.Length; i += 2)
            map[i] = 1;
        return map;
    }

    private static PdfDictionary AddStream(PdfDocument document, byte[] bytes)
    {
        var stream = new PdfDictionary(document);
        stream.CreateStream(bytes);
        stream.Stream.Zip();
        document.Internals.AddObject(stream);
        return stream;
    }

    private static byte[]? FindGlyphlessFont(string? configured)
    {
        var candidates = new List<string>();
        if (!string.IsNullOrWhiteSpace(configured))
            candidates.Add(configured);
        if (Environment.GetEnvironmentVariable("TESSDATA_PREFIX") is { Length: > 0 } prefix)
        {
            candidates.Add(Path.Combine(prefix, "pdf.ttf"));
            candidates.Add(Path.Combine(prefix, "tessdata", "pdf.ttf"));
        }

        candidates.AddRange(FontSearchPaths);
        return candidates.FirstOrDefault(File.Exists) is { } path ? File.ReadAllBytes(path) : null;
    }

    private static string Number(double value) => Math.Round(value, 4).ToString("0.####", CultureInfo.InvariantCulture);

    /// <summary>Converts displayed-page positions (top-left origin, after the page's rotation) to the page's own coordinates.</summary>
    private readonly record struct PageMapping(double X1, double Y1, double X2, double Y2, int Rotate)
    {
        public static PageMapping For(PdfPage page)
        {
            var box = page.Elements.ContainsKey("/CropBox") ? page.Elements.GetRectangle("/CropBox") : page.MediaBox;
            if (box.Width <= 0 || box.Height <= 0)
                box = page.MediaBox;
            var rotate = ((page.Rotate % 360) + 360) % 360;
            return new PageMapping(box.X1, box.Y1, box.X2, box.Y2, rotate);
        }

        public (double X, double Y) Point(double x, double y) => Rotate switch
        {
            90 => (X1 + y, Y1 + x),
            180 => (X2 - x, Y1 + y),
            270 => (X2 - y, Y2 - x),
            _ => (X1 + x, Y2 - y)
        };

        public (double X, double Y) Vector(double x, double y) => Rotate switch
        {
            90 => (y, x),
            180 => (-x, y),
            270 => (-y, -x),
            _ => (x, -y)
        };
    }
}
