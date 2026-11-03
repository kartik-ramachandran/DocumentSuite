namespace PdfAI.API.Models;

public class ValidationAgentResult
{
    public string Operation { get; set; } = string.Empty;
    public string Status { get; set; } = "needs-review";
    public double Confidence { get; set; }
    public string Explanation { get; set; } = string.Empty;
    public ValidationDocumentSnapshot Original { get; set; } = new();
    public ValidationDocumentSnapshot? Output { get; set; }
    public List<ValidationCheck> Checks { get; set; } = new();
    public List<string> RemediationSuggestions { get; set; } = new();
    public List<string> Warnings { get; set; } = new();
}

public class ValidationCheck
{
    public string Name { get; set; } = string.Empty;
    public string Status { get; set; } = "needs-review";
    public string Detail { get; set; } = string.Empty;
}

public class ValidationDocumentSnapshot
{
    public string FileName { get; set; } = string.Empty;
    public long SizeBytes { get; set; }
    public bool IsPdf { get; set; }
    public int? PageCount { get; set; }
    public int ImageCount { get; set; }
    public int TextCharacterCount { get; set; }
    public List<int> PageRotations { get; set; } = new();
    public List<string> Warnings { get; set; } = new();
}
