using UglyToad.PdfPig;

namespace PdfAI.API.Services;

public class DocumentExtractionService
{
    public int GetPageCount(byte[] pdfBytes)
    {
        using var document = PdfDocument.Open(pdfBytes);
        return document.NumberOfPages;
    }
}
