namespace PdfAI.API.Models;

public class PdfCompareResult
{
    public PdfCompareSummary Summary { get; set; } = new();
    public List<PdfPageCompareResult> Pages { get; set; } = new();
    public List<string> Warnings { get; set; } = new();
}

public class PdfCompareSummary
{
    public int LeftPageCount { get; set; }
    public int RightPageCount { get; set; }
    public int ComparedPageCount { get; set; }
    public int ChangedPageCount { get; set; }
    public int AddedLineCount { get; set; }
    public int RemovedLineCount { get; set; }
    public int ChangedImageCount { get; set; }
    public double AverageVisualDifferencePercent { get; set; }
}

public class PdfPageCompareResult
{
    public int PageNumber { get; set; }
    public string Status { get; set; } = "unchanged";
    public int LeftLineCount { get; set; }
    public int RightLineCount { get; set; }
    public int AddedLineCount { get; set; }
    public int RemovedLineCount { get; set; }
    public int LeftImageCount { get; set; }
    public int RightImageCount { get; set; }
    public int ChangedImageCount { get; set; }
    public double? VisualDifferencePercent { get; set; }
    public string? LeftPreviewDataUrl { get; set; }
    public string? RightPreviewDataUrl { get; set; }
    public string? DiffPreviewDataUrl { get; set; }
    public List<PdfCompareLine> Lines { get; set; } = new();
}

public class PdfCompareLine
{
    public string Type { get; set; } = "unchanged";
    public int? LeftLineNumber { get; set; }
    public int? RightLineNumber { get; set; }
    public string LeftText { get; set; } = string.Empty;
    public string RightText { get; set; } = string.Empty;
}
