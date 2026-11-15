namespace PdfAI.API.Services;

/// <summary>Turns analysed pages into plain JSON-friendly objects. Positions and sizes are in points from the top-left.</summary>
public static class DocumentJsonMapper
{
    public static object ToJson(IReadOnlyList<LayoutPage> pages, bool includeImages) => new
    {
        pageCount = pages.Count,
        pages = pages.Select(page => new
        {
            number = page.Number,
            width = page.Width,
            height = page.Height,
            ocr = page.WasOcr,
            ocrEngine = page.OcrEngine,
            ocrConfidence = page.OcrConfidence,
            ocrWarnings = page.OcrWarnings,
            blocks = page.Blocks.Select(block => ToBlock(block, includeImages)).ToList()
        }).ToList()
    };

    private static object ToBlock(LayoutBlock block, bool includeImages) => block switch
    {
        ParagraphBlock paragraph => new
        {
            type = "paragraph",
            text = string.Join(' ', paragraph.Lines.Select(line => line.Text.Replace('\t', ' '))),
            lines = paragraph.Lines.Select(line => line.Text).ToList(),
            left = paragraph.Left,
            top = paragraph.Top,
            fontSize = paragraph.FontSize,
            fontName = FirstWord(paragraph)?.FontName,
            bold = AllWords(paragraph).All(word => word.Bold),
            italic = AllWords(paragraph).All(word => word.Italic),
            color = FirstWord(paragraph)?.ColorHex,
            centered = paragraph.Centered,
            confidence = Confidence(AllWords(paragraph)),
            fromImage = AllWords(paragraph).All(word => word.FromImage)
        },
        TableBlock table => new
        {
            type = "table",
            left = table.Left,
            top = table.Top,
            columnWidths = table.ColumnWidths,
            rows = table.Rows.Select(row => row.Select(cell => cell.Text).ToList()).ToList(),
            source = table.Source ?? "text",
            unverifiedWords = table.Source is null ? (int?)null : table.UnverifiedWords,
            confidence = Confidence(table.Rows.SelectMany(row => row).SelectMany(cell => cell.Words))
        },
        ImageBlock { Image: var image } => new
        {
            type = "image",
            left = image.Left,
            top = image.Top,
            width = image.Width,
            height = image.Height,
            contentType = image.IsJpeg ? "image/jpeg" : "image/png",
            bytes = image.Bytes.Length,
            data = includeImages ? Convert.ToBase64String(image.Bytes) : null
        },
        _ => throw new NotSupportedException($"Unknown block type {block.GetType().Name}.")
    };

    private static IEnumerable<LayoutWord> AllWords(ParagraphBlock paragraph) =>
        paragraph.Lines.SelectMany(line => line.Segments).SelectMany(segment => segment.Words);

    private static LayoutWord? FirstWord(ParagraphBlock paragraph) => AllWords(paragraph).FirstOrDefault();

    // The mean OCR confidence from 0 to 1, or null for real text.
    private static double? Confidence(IEnumerable<LayoutWord> words)
    {
        var scores = words.Where(word => word.Confidence is not null).Select(word => word.Confidence!.Value).ToList();
        return scores.Count == 0 ? null : Math.Round(scores.Average(), 3);
    }
}
