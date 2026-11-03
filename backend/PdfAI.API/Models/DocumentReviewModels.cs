namespace PdfAI.API.Models;

public record DocumentReviewRequest(
    string FileName,
    int? PageCount,
    string? ExtractedText);

public class DocumentReviewResult
{
    public string Summary { get; set; } = string.Empty;
    public List<string> KeyPoints { get; set; } = new();
    public List<string> Issues { get; set; } = new();
    public string Sentiment { get; set; } = string.Empty;
    public string Model { get; set; } = string.Empty;
}
