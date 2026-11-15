using System.Globalization;
using System.Text;

namespace PdfAI.API.Services.Ocr;

/// <summary>
/// Checks tables from a layout model against the words the OCR engine read in the same area, because layout models can
/// leave text out or write text that isn't on the page. Each cell word that matches an OCR word takes that word's real position.
/// A table where too much doesn't match is dropped, so the page falls back to tables built from word positions.
/// </summary>
public static class OcrTableMerger
{
    public const string Source = "layout-model";
    public const double MaxUnverifiedShare = 0.3;
    private const double RegionMargin = 2;  // points
    private const int MaxListed = 8;

    public sealed record MergeResult(List<TableBlock> Tables, List<LayoutWord> RemainingWords, List<string> Warnings);

    public static MergeResult Merge(IReadOnlyList<LayoutWord> words, IReadOnlyList<OcrTableRegion> tables)
    {
        var remaining = words.ToList();
        var blocks = new List<TableBlock>();
        var warnings = new List<string>();
        var fontSize = words.Count > 0 ? LayoutMath.Median(words.Select(word => word.FontSize)) : 10;

        foreach (var (table, index) in tables.OrderBy(table => table.Top).Select((table, index) => (table, index + 1)))
        {
            var columns = table.Rows.Max(row => row.Count);
            if (table.Rows.Count < 2 || columns < 2)
                continue;

            var inside = remaining.Where(word => Contains(table, word)).ToList();
            var pool = inside.Select(word => (Word: word, Key: Normalize(word.Text))).ToList();
            var used = new bool[pool.Count];
            var rowHeight = table.Height / table.Rows.Count;
            var columnWidth = table.Width / columns;

            var rows = new List<IReadOnlyList<TableCell>>();
            var columnSpans = Enumerable.Range(0, columns).Select(_ => (Left: double.MaxValue, Right: double.MinValue)).ToArray();
            int checkedWords = 0, unverified = 0;
            var unverifiedNumbers = new List<string>();

            for (var r = 0; r < table.Rows.Count; r++)
            {
                var cells = new List<TableCell>();
                for (var c = 0; c < columns; c++)
                {
                    var text = c < table.Rows[r].Count ? table.Rows[r][c] : string.Empty;
                    var expectedX = table.Left + (c + 0.5) * columnWidth;
                    var expectedY = table.Top + (r + 0.5) * rowHeight;
                    var cellWords = new List<LayoutWord>();

                    foreach (var token in text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries))
                    {
                        var key = Normalize(token);
                        var match = key.Length == 0 ? -1 : FindNearest(pool, used, key, expectedX, expectedY);
                        if (match >= 0)
                        {
                            used[match] = true;
                            var word = pool[match].Word;
                            cellWords.Add(word);
                            columnSpans[c] = (Math.Min(columnSpans[c].Left, word.Left), Math.Max(columnSpans[c].Right, word.Right));
                        }
                        else
                        {
                            // Punctuation alone, such as a dash for "none", has nothing to check.
                            if (key.Length > 0)
                            {
                                unverified++;
                                if (IsNumber(token) && unverifiedNumbers.Count < MaxListed)
                                    unverifiedNumbers.Add(token);
                            }

                            var left = table.Left + c * columnWidth + 2 + cellWords.Sum(word => word.Right - word.Left + fontSize * 0.3);
                            cellWords.Add(new LayoutWord(token, left, left + token.Length * fontSize * 0.5, expectedY + fontSize * 0.3, fontSize, IsPositioned: false));
                        }

                        if (key.Length > 0)
                            checkedWords++;
                    }

                    cells.Add(new TableCell(cellWords));
                }

                rows.Add(cells);
            }

            if (checkedWords == 0 || unverified > checkedWords * MaxUnverifiedShare)
            {
                warnings.Add($"Table {index} from the layout model didn't match the OCR text ({unverified} of {checkedWords} words), so it was rebuilt from word positions.");
                continue;
            }

            if (unverifiedNumbers.Count > 0)
                warnings.Add($"Table {index}: the OCR text doesn't contain {Plural(unverifiedNumbers.Count, "number")} from the layout model ({string.Join(", ", unverifiedNumbers)}). Check them against the page.");
            else if (unverified > 0)
                warnings.Add($"Table {index}: the OCR text doesn't contain {Plural(unverified, "word")} from the layout model.");

            var missing = pool.Where((item, i) => !used[i] && item.Key.Length > 0).Select(item => item.Word).ToList();
            if (missing.Count > 0)
            {
                warnings.Add($"Table {index}: the layout model left out {Plural(missing.Count, "word")} that OCR read in the table area ({string.Join(' ', missing.Take(MaxListed).Select(word => word.Text))}{(missing.Count > MaxListed ? " …" : string.Empty)}). They're kept as text next to the table.");
            }

            var consumed = pool.Where((_, i) => used[i]).Select(item => item.Word).ToHashSet(ReferenceEqualityComparer.Instance);
            // Words with no content, such as stray punctuation in the table, go with the table rather than float beside it.
            foreach (var item in pool.Where((item, i) => !used[i] && item.Key.Length == 0))
                consumed.Add(item.Word);
            remaining.RemoveAll(word => consumed.Contains(word));

            blocks.Add(new TableBlock(table.Top, table.Left, ColumnWidths(table, columnSpans), rows, Source, unverified));
        }

        return new MergeResult(blocks, remaining, warnings);
    }

    /// <summary>Lower-cases and keeps only letters and digits, so "Total:" matches "total". Numbers keep their separators.</summary>
    public static string Normalize(string text)
    {
        var number = IsNumber(text);
        var builder = new StringBuilder(text.Length);
        foreach (var character in text.Normalize(NormalizationForm.FormKC))
        {
            if (char.IsLetterOrDigit(character))
                builder.Append(char.ToLowerInvariant(character));
            else if (number && character is '.' or ',' or '-')
                builder.Append(character);
        }

        return number ? builder.ToString().Trim('.', ',', '-') : builder.ToString();
    }

    private static bool IsNumber(string text) => text.Any(char.IsDigit) && text.Count(char.IsDigit) * 2 >= text.Count(char.IsLetterOrDigit);

    private static int FindNearest(List<(LayoutWord Word, string Key)> pool, bool[] used, string key, double x, double y)
    {
        var best = -1;
        var bestDistance = double.MaxValue;
        for (var i = 0; i < pool.Count; i++)
        {
            if (used[i] || pool[i].Key != key)
                continue;
            var word = pool[i].Word;
            var dx = (word.Left + word.Right) / 2 - x;
            var dy = (word.Top + word.Bottom) / 2 - y;
            var distance = dx * dx + dy * dy * 4;  // rows are closer together than columns, so vertical distance counts more
            if (distance < bestDistance)
                (best, bestDistance) = (i, distance);
        }

        return best;
    }

    private static bool Contains(OcrTableRegion table, LayoutWord word)
    {
        var x = (word.Left + word.Right) / 2;
        var y = (word.Top + word.Bottom) / 2;
        return x >= table.Left - RegionMargin && x <= table.Right + RegionMargin && y >= table.Top - RegionMargin && y <= table.Bottom + RegionMargin;
    }

    // Columns split halfway between one column's text and the next. Columns with no matched text share the space evenly.
    private static List<double> ColumnWidths(OcrTableRegion table, (double Left, double Right)[] spans)
    {
        var columns = spans.Length;
        var even = Enumerable.Repeat(table.Width / columns, columns).ToList();
        if (spans.Any(span => span.Left > span.Right))
            return even;

        var edges = new List<double> { table.Left };
        for (var c = 1; c < columns; c++)
            edges.Add((spans[c - 1].Right + spans[c].Left) / 2);
        edges.Add(table.Right);
        for (var c = 1; c < edges.Count; c++)
        {
            if (edges[c] <= edges[c - 1])
                return even;
        }

        return Enumerable.Range(0, columns).Select(c => Math.Round(edges[c + 1] - edges[c], 2)).ToList();
    }

    private static string Plural(int count, string noun) => string.Create(CultureInfo.InvariantCulture, $"{count} {noun}{(count == 1 ? string.Empty : "s")}");
}
