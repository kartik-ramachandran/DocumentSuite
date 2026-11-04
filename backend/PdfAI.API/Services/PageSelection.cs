namespace PdfAI.API.Services;

/// <summary>Parses page lists such as "3,1,5-8". Order is kept, and pages are checked against the document before expanding.</summary>
public static class PageSelection
{
    public static List<int> Parse(string? pages, int pageCount) =>
        ParseGroups(pages, pageCount).SelectMany(group => group).ToList();

    /// <summary>Returns one list per comma-separated part. A descending range such as "5-3" lists pages in reverse.</summary>
    public static List<List<int>> ParseGroups(string? pages, int pageCount)
    {
        if (string.IsNullOrWhiteSpace(pages))
            throw new ArgumentException("Select at least one page, for example 1,3,5-8.");

        var groups = new List<List<int>>();
        foreach (var part in pages.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var bounds = part.Split('-', StringSplitOptions.TrimEntries);
            if (bounds.Length > 2 || !int.TryParse(bounds[0], out var first) || !int.TryParse(bounds[^1], out var last))
                throw new ArgumentException($"Invalid page selection '{part}'.");
            if (first < 1 || last < 1 || first > pageCount || last > pageCount)
                throw new ArgumentException($"Page selection '{part}' is outside this document's {pageCount} pages.");

            var step = last >= first ? 1 : -1;
            var group = new List<int>();
            for (var page = first; page != last + step; page += step)
                group.Add(page);
            groups.Add(group);
        }

        if (groups.Count == 0)
            throw new ArgumentException("Select at least one page, for example 1,3,5-8.");

        return groups;
    }
}
