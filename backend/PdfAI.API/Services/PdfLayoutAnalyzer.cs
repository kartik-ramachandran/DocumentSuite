namespace PdfAI.API.Services;

public sealed record LayoutWord(
    string Text,
    double Left,
    double Right,
    double Baseline,
    double FontSize,
    bool Bold = false,
    bool Italic = false,
    string? FontName = null,
    string? ColorHex = null,
    bool IsPositioned = true)
{
    public double Top => Baseline - FontSize * 0.8;
    public double Bottom => Baseline + FontSize * 0.2;
}

public sealed record LayoutImage(byte[] Bytes, bool IsJpeg, double Left, double Top, double Width, double Height);

/// <summary>A run of words on a line, separated from the next run by a gap wider than a normal space.</summary>
public sealed record LayoutSegment(IReadOnlyList<LayoutWord> Words)
{
    public double Left => Words[0].Left;
    public double Right => Words[^1].Right;
    public string Text => string.Join(' ', Words.Select(word => word.Text));
}

public sealed record LayoutLine(IReadOnlyList<LayoutSegment> Segments)
{
    public double Baseline => Segments[0].Words[0].Baseline;
    public double Left => Segments[0].Left;
    public double Right => Segments[^1].Right;
    public double Top => Segments.Min(segment => segment.Words.Min(word => word.Top));
    public double Bottom => Segments.Max(segment => segment.Words.Max(word => word.Bottom));
    public double FontSize => LayoutMath.Median(Segments.SelectMany(segment => segment.Words).Select(word => word.FontSize));
    public string Text => string.Join('\t', Segments.Select(segment => segment.Text));
}

public abstract record LayoutBlock(double Top);

public sealed record ParagraphBlock(IReadOnlyList<LayoutLine> Lines, bool Centered, double RegionLeft)
    : LayoutBlock(Lines[0].Top)
{
    public double Left => Lines.Min(line => line.Left);
    public double Right => Lines.Max(line => line.Right);
    public double Bottom => Lines[^1].Bottom;
    public double FontSize => LayoutMath.Median(Lines.Select(line => line.FontSize));
}

public sealed record TableCell(IReadOnlyList<LayoutWord> Words)
{
    public string Text => string.Join(' ', Words.Select(word => word.Text));
}

/// <summary>Column widths are in points. Every row has one cell per column.</summary>
public sealed record TableBlock(double Top, double Left, IReadOnlyList<double> ColumnWidths, IReadOnlyList<IReadOnlyList<TableCell>> Rows)
    : LayoutBlock(Top)
{
    public double Bottom => Rows.SelectMany(row => row).SelectMany(cell => cell.Words).Select(word => word.Bottom).DefaultIfEmpty(Top).Max();
}

public sealed record ImageBlock(LayoutImage Image) : LayoutBlock(Image.Top);

public sealed record LayoutPage(int Number, double Width, double Height, IReadOnlyList<LayoutBlock> Blocks, bool WasOcr, bool IsRotated = false)
{
    /// <summary>Every word on the page in reading order.</summary>
    public List<LayoutWord> AllWords()
    {
        var words = new List<LayoutWord>();
        foreach (var block in Blocks)
        {
            if (block is ParagraphBlock paragraph)
                words.AddRange(paragraph.Lines.SelectMany(line => line.Segments).SelectMany(segment => segment.Words));
            else if (block is TableBlock table)
                words.AddRange(table.Rows.SelectMany(row => row).SelectMany(cell => cell.Words));
        }

        return words;
    }
}

internal static class LayoutMath
{
    public static double Median(IEnumerable<double> values)
    {
        var sorted = values.OrderBy(value => value).ToList();
        return sorted.Count == 0 ? 0 : sorted[sorted.Count / 2];
    }
}

/// <summary>Turns positioned words into reading-order lines, paragraphs and tables. Works only on geometry.</summary>
public static class PdfLayoutAnalyzer
{
    private const double BaselineTolerance = 0.4;     // of font size: words closer than this share a line
    private const double SegmentGap = 0.9;            // of font size: wider gaps start a new cell or segment
    private const double MaxTableRowPitch = 3.5;      // of font size: wider vertical gaps end a table
    private const double WrappedCellPitch = 1.4;      // of font size: tighter single-cell rows continue the row above
    private const double ParagraphLinePitch = 1.6;    // of font size: wider vertical gaps start a new paragraph
    private const double FullLineRatio = 0.8;         // a line this close to the region's width wraps onto the next
    private const int MinLinesForColumns = 6;
    private const int MinWordsForJustifiedLine = 5;
    private const double MaxJustifiedGap = 2.2;       // of font size
    private const double MaxJustifiedGapRatio = 1.25; // widest gap / narrowest gap on a justified line
    private const double TableCellPadding = 12;       // points, so cell text fits inside default cell margins

    public static IReadOnlyList<LayoutBlock> BuildBlocks(IReadOnlyList<LayoutWord> words, IReadOnlyList<LayoutImage> images, double pageWidth)
    {
        var blocks = new List<LayoutBlock>();
        var lines = GroupIntoLines(words);

        foreach (var (regionLines, left, right) in SplitIntoRegions(lines, pageWidth))
            blocks.AddRange(BuildRegionBlocks(regionLines, left, right));

        foreach (var image in images.OrderBy(image => image.Top))
        {
            var index = blocks.FindIndex(block => block.Top > image.Top);
            blocks.Insert(index < 0 ? blocks.Count : index, new ImageBlock(image));
        }

        return blocks;
    }

    public static List<LayoutLine> GroupIntoLines(IEnumerable<LayoutWord> words)
    {
        var lines = new List<List<LayoutWord>>();
        foreach (var word in words.OrderBy(word => word.Baseline).ThenBy(word => word.Left))
        {
            var current = lines.Count > 0 ? lines[^1] : null;
            var tolerance = BaselineTolerance * Math.Min(word.FontSize, current?[0].FontSize ?? word.FontSize);
            if (current is not null && Math.Abs(word.Baseline - current[0].Baseline) <= tolerance)
                current.Add(word);
            else
                lines.Add([word]);
        }

        return lines.Select(line => BuildLine(line.OrderBy(word => word.Left).ToList())).ToList();
    }

    private static LayoutLine BuildLine(IReadOnlyList<LayoutWord> words)
    {
        var fontSize = LayoutMath.Median(words.Select(word => word.FontSize));
        if (IsJustified(words, fontSize))
            return new LayoutLine([new LayoutSegment(words)]);

        var segments = new List<LayoutSegment>();
        var current = new List<LayoutWord>();

        foreach (var word in words)
        {
            if (current.Count > 0 && word.Left - current[^1].Right > SegmentGap * fontSize)
            {
                segments.Add(new LayoutSegment(current));
                current = [];
            }

            current.Add(word);
        }

        segments.Add(new LayoutSegment(current));
        return new LayoutLine(segments);
    }

    // Justified text stretches every gap by a similar amount, while table columns leave uneven gaps.
    private static bool IsJustified(IReadOnlyList<LayoutWord> words, double fontSize)
    {
        if (words.Count < MinWordsForJustifiedLine)
            return false;

        var gaps = words.Zip(words.Skip(1), (left, right) => right.Left - left.Right).ToList();
        var widest = gaps.Max();
        var narrowest = gaps.Min();
        return narrowest > 0 && widest <= MaxJustifiedGap * fontSize && widest <= narrowest * MaxJustifiedGapRatio;
    }

    private static IEnumerable<(List<LayoutLine> Lines, double Left, double Right)> SplitIntoRegions(List<LayoutLine> lines, double pageWidth)
    {
        if (lines.Count == 0)
            yield break;

        var left = lines.Min(line => line.Left);
        var right = Math.Min(lines.Max(line => line.Right), pageWidth);
        var gutter = FindColumnGutter(lines, left, right);

        if (gutter is null)
        {
            yield return (lines, left, right);
            yield break;
        }

        // Lines that cross the gutter (titles, full-width figures) separate bands of two-column text.
        var leftLines = new List<LayoutLine>();
        var rightLines = new List<LayoutLine>();
        foreach (var line in lines)
        {
            if (Crosses(line, gutter.Value))
            {
                foreach (var region in FlushColumns(leftLines, rightLines, left, right, gutter.Value))
                    yield return region;
                yield return ([line], left, right);
                continue;
            }

            var (lineLeft, lineRight) = SplitLine(line, gutter.Value);
            if (lineLeft is not null) leftLines.Add(lineLeft);
            if (lineRight is not null) rightLines.Add(lineRight);
        }

        foreach (var region in FlushColumns(leftLines, rightLines, left, right, gutter.Value))
            yield return region;
    }

    private static IEnumerable<(List<LayoutLine> Lines, double Left, double Right)> FlushColumns(
        List<LayoutLine> leftLines, List<LayoutLine> rightLines, double left, double right, double gutter)
    {
        if (leftLines.Count > 0)
        {
            yield return ([.. leftLines], left, Math.Min(gutter, leftLines.Max(line => line.Right)));
            leftLines.Clear();
        }

        if (rightLines.Count > 0)
        {
            yield return ([.. rightLines], rightLines.Min(line => line.Left), right);
            rightLines.Clear();
        }
    }

    // Finds a vertical gutter only for flowing text. Both sides must fill most of their width with
    // several words per line, which keeps ordinary tables out because their cells are short.
    private static double? FindColumnGutter(List<LayoutLine> lines, double left, double right)
    {
        if (lines.Count < MinLinesForColumns || right - left <= 0)
            return null;

        double? best = null;
        var fewestCrossings = int.MaxValue;
        for (var x = left + (right - left) * 0.3; x <= left + (right - left) * 0.7; x += 2)
        {
            var crossings = lines.Count(line => Crosses(line, x));
            if (crossings < fewestCrossings)
            {
                fewestCrossings = crossings;
                best = x;
            }
        }

        if (best is not { } rawGutter || fewestCrossings > lines.Count * 0.2)
            return null;

        var clear = lines.Where(line => !Crosses(line, rawGutter)).ToList();
        var leftParts = clear.Select(line => SplitLine(line, rawGutter).Left).OfType<LayoutLine>().ToList();
        var rightParts = clear.Select(line => SplitLine(line, rawGutter).Right).OfType<LayoutLine>().ToList();
        if (leftParts.Count < clear.Count * 0.4 || rightParts.Count < clear.Count * 0.4)
            return null;

        var leftEdge = leftParts.Max(line => line.Right);
        var rightEdge = rightParts.Min(line => line.Left);
        var gutter = (leftEdge + rightEdge) / 2;
        if (rightEdge <= leftEdge)
            return null;

        var isProse =
            leftParts.Average(line => line.Right - left) >= (leftEdge - left) * 0.7 &&
            rightParts.Average(line => line.Right - rightEdge) >= (right - rightEdge) * 0.7 &&
            leftParts.Average(WordCount) >= 4 &&
            rightParts.Average(WordCount) >= 4;

        return isProse ? gutter : null;
    }

    private static int WordCount(LayoutLine line) => line.Segments.Sum(segment => segment.Words.Count);

    private static bool Crosses(LayoutLine line, double x) =>
        line.Segments.Any(segment => segment.Words.Any(word => word.Left < x && word.Right > x));

    private static (LayoutLine? Left, LayoutLine? Right) SplitLine(LayoutLine line, double x)
    {
        var words = line.Segments.SelectMany(segment => segment.Words).ToList();
        var left = words.Where(word => word.Right <= x).ToList();
        var right = words.Where(word => word.Left >= x).ToList();
        return (left.Count > 0 ? BuildLine(left) : null, right.Count > 0 ? BuildLine(right) : null);
    }

    private static IEnumerable<LayoutBlock> BuildRegionBlocks(List<LayoutLine> lines, double regionLeft, double regionRight)
    {
        var index = 0;
        var paragraphLines = new List<LayoutLine>();

        while (index < lines.Count)
        {
            if (lines[index].Segments.Count >= 2 && TryBuildTable(lines, index, out var table, out var nextIndex))
            {
                foreach (var paragraph in BuildParagraphs(paragraphLines, regionLeft, regionRight))
                    yield return paragraph;
                paragraphLines.Clear();
                yield return table;
                index = nextIndex;
                continue;
            }

            paragraphLines.Add(lines[index]);
            index++;
        }

        foreach (var paragraph in BuildParagraphs(paragraphLines, regionLeft, regionRight))
            yield return paragraph;
    }

    private static bool TryBuildTable(List<LayoutLine> lines, int start, out TableBlock table, out int nextIndex)
    {
        table = null!;
        nextIndex = start;

        var end = FindTableRunEnd(lines, start);
        var run = lines.GetRange(start, end - start);
        var multiSegment = run.Where(line => line.Segments.Count >= 2).ToList();
        if (multiSegment.Count < 2)
            return false;

        // Columns come from the most common row shape so a spanning header can't merge them.
        var columnCount = multiSegment.GroupBy(line => line.Segments.Count)
            .OrderByDescending(group => group.Count()).ThenByDescending(group => group.Key).First().Key;
        var shapedRows = multiSegment.Where(line => line.Segments.Count == columnCount).ToList();
        if (shapedRows.Count < 2 || shapedRows.Count < multiSegment.Count * 0.5)
            return false;

        var columns = BuildColumns(shapedRows);
        if (columns.Count != columnCount)
            return false;

        // A long plain line crossing several columns is prose, so the table stops there.
        for (var i = 0; i < run.Count; i++)
        {
            if (run[i].Segments.Count == 1 && columns.Count(column => Overlaps(run[i].Segments[0], column)) > 1)
            {
                run = run.GetRange(0, i);
                break;
            }
        }

        if (run.Count(line => line.Segments.Count >= 2) < 2)
            return false;

        var rows = new List<List<List<LayoutWord>>>();
        for (var i = 0; i < run.Count; i++)
        {
            var line = run[i];
            var fontSize = Math.Max(line.FontSize, 1);
            var isWrappedCell = i > 0 && rows.Count > 0 && line.Segments.Count == 1
                && line.Baseline - run[i - 1].Baseline <= WrappedCellPitch * fontSize
                && ColumnIndex(line.Segments[0], columns) > 0;

            var row = isWrappedCell ? rows[^1] : columns.Select(_ => new List<LayoutWord>()).ToList();
            foreach (var segment in line.Segments)
                row[ColumnIndex(segment, columns)].AddRange(segment.Words);
            if (!isWrappedCell)
                rows.Add(row);
        }

        table = new TableBlock(
            run[0].Top,
            columns[0].Left,
            columns.Select((column, i) => Math.Max(
                (i + 1 < columns.Count ? columns[i + 1].Left : column.Right) - column.Left,
                column.Right - column.Left + TableCellPadding)).ToList(),
            rows.Select(row => (IReadOnlyList<TableCell>)row.Select(words => new TableCell(words)).ToList()).ToList());
        nextIndex = start + run.Count;
        return true;
    }

    private static int FindTableRunEnd(List<LayoutLine> lines, int start)
    {
        var end = start + 1;
        for (var i = start + 1; i < lines.Count; i++)
        {
            var fontSize = Math.Max(lines[i].FontSize, 1);
            if (lines[i].Baseline - lines[i - 1].Baseline > MaxTableRowPitch * fontSize)
                break;
            if (lines[i].Segments.Count >= 2)
                end = i + 1;
            else if (i + 1 == lines.Count)
                end = Math.Max(end, IsPlausibleWrap(lines, i) ? i + 1 : end);
        }

        // Keep a single-cell line only when it sits tightly under the row it continues.
        while (end < lines.Count && lines[end].Segments.Count == 1 && IsPlausibleWrap(lines, end))
            end++;

        return end;
    }

    private static bool IsPlausibleWrap(List<LayoutLine> lines, int index) =>
        lines[index].Baseline - lines[index - 1].Baseline <= WrappedCellPitch * Math.Max(lines[index].FontSize, 1)
        && lines[index - 1].Segments.Count >= 2
        && lines[index].Left > lines[index - 1].Left + 1;

    private static List<(double Left, double Right)> BuildColumns(List<LayoutLine> rows)
    {
        var columns = new List<(double Left, double Right)>();
        foreach (var (left, right) in rows.SelectMany(row => row.Segments).Select(segment => (segment.Left, segment.Right)).OrderBy(span => span.Left))
        {
            if (columns.Count > 0 && left <= columns[^1].Right)
                columns[^1] = (columns[^1].Left, Math.Max(columns[^1].Right, right));
            else
                columns.Add((left, right));
        }

        return columns;
    }

    private static bool Overlaps(LayoutSegment segment, (double Left, double Right) column) =>
        segment.Left < column.Right && segment.Right > column.Left;

    private static int ColumnIndex(LayoutSegment segment, List<(double Left, double Right)> columns)
    {
        var best = 0;
        var bestOverlap = double.MinValue;
        for (var i = 0; i < columns.Count; i++)
        {
            var overlap = Math.Min(segment.Right, columns[i].Right) - Math.Max(segment.Left, columns[i].Left);
            if (overlap > bestOverlap)
            {
                bestOverlap = overlap;
                best = i;
            }
        }

        return best;
    }

    private static IEnumerable<ParagraphBlock> BuildParagraphs(List<LayoutLine> lines, double regionLeft, double regionRight)
    {
        var regionWidth = Math.Max(regionRight - regionLeft, 1);
        var current = new List<LayoutLine>();

        foreach (var line in lines)
        {
            if (current.Count > 0 && !ContinuesParagraph(current, line, regionLeft, regionWidth))
            {
                yield return ToParagraph(current, regionLeft, regionRight);
                current = [];
            }

            current.Add(line);
        }

        if (current.Count > 0)
            yield return ToParagraph(current, regionLeft, regionRight);
    }

    private static bool ContinuesParagraph(List<LayoutLine> paragraph, LayoutLine next, double regionLeft, double regionWidth)
    {
        var previous = paragraph[^1];
        var fontSize = Math.Max(previous.FontSize, 1);

        var sameType = Math.Abs(previous.FontSize - next.FontSize) <= 0.75;
        var closeBelow = next.Baseline - previous.Baseline <= ParagraphLinePitch * fontSize;
        var previousIsFull = previous.Right - regionLeft >= regionWidth * FullLineRatio;
        var alignedLeft = Math.Abs(next.Left - paragraph[Math.Min(1, paragraph.Count - 1)].Left) <= (paragraph.Count == 1 ? 3 * fontSize : fontSize);
        var plainLines = previous.Segments.Count == 1 && next.Segments.Count == 1;

        return sameType && closeBelow && previousIsFull && alignedLeft && plainLines;
    }

    private static ParagraphBlock ToParagraph(List<LayoutLine> lines, double regionLeft, double regionRight)
    {
        var line = lines[0];
        var margin = line.Left - regionLeft;
        var trailing = regionRight - line.Right;
        var centered = lines.Count == 1
            && margin > (regionRight - regionLeft) * 0.1
            && Math.Abs(margin - trailing) <= Math.Max(line.FontSize, 4);

        return new ParagraphBlock(lines, centered, regionLeft);
    }
}
