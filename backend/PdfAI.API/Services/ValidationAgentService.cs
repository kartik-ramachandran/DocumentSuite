using System.Text.Json;
using PdfAI.API.Models;
using PdfSharp.Pdf.IO;
using UglyToad.PdfPig;

namespace PdfAI.API.Services;

public class ValidationAgentService
{
    private readonly ILogger<ValidationAgentService> _logger;

    public ValidationAgentService(ILogger<ValidationAgentService> logger)
    {
        _logger = logger;
    }

    public ValidationAgentResult Validate(
        string operation,
        IReadOnlyList<UploadedDocument> originalFiles,
        UploadedDocument? outputFile,
        string? optionsJson,
        string? warningsJson,
        string? resultJson)
    {
        var normalizedOperation = NormalizeOperation(operation);
        var options = ParseJsonObject(optionsJson);
        var externalWarnings = ParseStringArray(warningsJson);
        var resultPayload = ParseJsonObject(resultJson);
        var originalSnapshots = originalFiles.Select(Snapshot).ToList();
        var outputSnapshot = outputFile is null ? null : Snapshot(outputFile);

        var result = new ValidationAgentResult
        {
            Operation = normalizedOperation,
            Original = CombineOriginals(originalSnapshots),
            Output = outputSnapshot,
            Warnings = externalWarnings
                .Concat(originalSnapshots.SelectMany(snapshot => snapshot.Warnings))
                .Concat(outputSnapshot?.Warnings ?? Enumerable.Empty<string>())
                .Distinct()
                .ToList()
        };

        if (originalFiles.Count == 0)
        {
            result.Checks.Add(Fail("Original input", "No original document was provided for validation."));
        }

        if (outputFile is null && normalizedOperation != "compare")
        {
            result.Checks.Add(Fail("Output file", "No output document was provided for validation."));
        }

        AddGenericChecks(result, originalSnapshots, outputSnapshot);
        AddOperationChecks(result, normalizedOperation, originalSnapshots, outputSnapshot, options, resultPayload);
        FinalizeResult(result);
        return result;
    }

    private static void AddGenericChecks(
        ValidationAgentResult result,
        IReadOnlyList<ValidationDocumentSnapshot> originals,
        ValidationDocumentSnapshot? output)
    {
        if (originals.Count > 0 && originals.All(snapshot => snapshot.IsPdf))
        {
            result.Checks.Add(Pass("Original readable", "All original PDFs could be opened and inspected."));
        }

        if (output is null)
        {
            return;
        }

        if (output.SizeBytes > 0)
        {
            result.Checks.Add(Pass("Output produced", $"Output file was generated ({FormatBytes(output.SizeBytes)})."));
        }

        if (output.IsPdf)
        {
            result.Checks.Add(Pass("Output readable", "Output PDF could be opened and inspected."));
        }
        else
        {
            result.Checks.Add(Review("Output type", "Output is not a PDF, so PDF page/text/image validation is limited."));
        }
    }

    private static void AddOperationChecks(
        ValidationAgentResult result,
        string operation,
        IReadOnlyList<ValidationDocumentSnapshot> originals,
        ValidationDocumentSnapshot? output,
        Dictionary<string, JsonElement> options,
        Dictionary<string, JsonElement> resultPayload)
    {
        switch (operation)
        {
            case "compress":
                ValidateCompress(result, originals.FirstOrDefault(), output);
                break;
            case "merge":
                ValidateMerge(result, originals, output);
                break;
            case "split":
                ValidateSplit(result, originals.FirstOrDefault(), output);
                break;
            case "watermark":
                ValidateWatermark(result, originals.FirstOrDefault(), output, options);
                break;
            case "rotate":
                ValidateRotate(result, originals.FirstOrDefault(), output, options);
                break;
            case "protect":
                ValidateProtect(result, output);
                break;
            case "unlock":
                ValidateUnlock(result, output);
                break;
            case "ocr":
                ValidateOcr(result, output);
                break;
            case "compare":
                ValidateCompare(result, originals, resultPayload);
                break;
            default:
                ValidateConversionOrGeneric(result, originals.FirstOrDefault(), output);
                break;
        }
    }

    private static void ValidateCompress(ValidationAgentResult result, ValidationDocumentSnapshot? original, ValidationDocumentSnapshot? output)
    {
        if (original is null || output is null) return;

        if (output.SizeBytes < original.SizeBytes)
        {
            result.Checks.Add(Pass("Compression", $"Output is smaller than the original ({FormatBytes(original.SizeBytes)} to {FormatBytes(output.SizeBytes)})."));
        }
        else
        {
            result.Checks.Add(Review("Compression", "Output was not smaller than the original. The PDF may already be optimized or compression may be limited."));
            result.RemediationSuggestions.Add("Try a more aggressive compression profile or inspect whether the PDF is image-heavy/already optimized.");
        }

        CheckSamePageCount(result, original, output);
    }

    private static void ValidateMerge(ValidationAgentResult result, IReadOnlyList<ValidationDocumentSnapshot> originals, ValidationDocumentSnapshot? output)
    {
        if (output?.PageCount is null || originals.Any(snapshot => snapshot.PageCount is null)) return;

        var expectedPages = originals.Sum(snapshot => snapshot.PageCount ?? 0);
        if (output.PageCount == expectedPages)
        {
            result.Checks.Add(Pass("Merged page count", $"Output contains all {expectedPages} expected pages."));
        }
        else
        {
            result.Checks.Add(Fail("Merged page count", $"Expected {expectedPages} pages but output has {output.PageCount}."));
            result.RemediationSuggestions.Add("Re-run merge and confirm all input PDFs were uploaded in the intended order.");
        }
    }

    private static void ValidateSplit(ValidationAgentResult result, ValidationDocumentSnapshot? original, ValidationDocumentSnapshot? output)
    {
        if (original is null || output?.PageCount is null) return;

        if (output.PageCount == 1)
        {
            result.Checks.Add(Pass("Split output", "Returned split output contains one page."));
        }
        else
        {
            result.Checks.Add(Review("Split output", $"Returned split output has {output.PageCount} pages. This app currently returns the first split file rather than a ZIP of all pages."));
        }
    }

    private static void ValidateWatermark(
        ValidationAgentResult result,
        ValidationDocumentSnapshot? original,
        ValidationDocumentSnapshot? output,
        Dictionary<string, JsonElement> options)
    {
        if (original is not null && output is not null)
        {
            CheckSamePageCount(result, original, output);
            if (output.SizeBytes != original.SizeBytes)
            {
                result.Checks.Add(Pass("Watermark output changed", "Output PDF bytes changed after applying the watermark."));
            }
        }

        var text = GetStringOption(options, "watermarkText") ?? GetStringOption(options, "text");
        if (!string.IsNullOrWhiteSpace(text))
        {
            result.Checks.Add(Review("Watermark intent", $"Requested watermark text was '{text}'. The watermark is drawn visually and may not appear in extracted text."));
            result.RemediationSuggestions.Add("Use visual comparison or open the PDF to confirm watermark placement and opacity.");
        }
    }

    private static void ValidateRotate(
        ValidationAgentResult result,
        ValidationDocumentSnapshot? original,
        ValidationDocumentSnapshot? output,
        Dictionary<string, JsonElement> options)
    {
        if (original is null || output is null) return;

        CheckSamePageCount(result, original, output);
        var degrees = GetIntOption(options, "degrees") ?? 90;
        var expected = original.PageRotations.Select(rotation => NormalizeDegrees(rotation + degrees)).ToArray();
        if (expected.Length > 0 && output.PageRotations.SequenceEqual(expected))
        {
            result.Checks.Add(Pass("Rotation", $"All pages were rotated by {degrees} degrees."));
        }
        else if (output.PageRotations.Count > 0)
        {
            result.Checks.Add(Review("Rotation", $"Could not fully confirm every page rotation. Output rotations: {string.Join(", ", output.PageRotations)}."));
        }
    }

    private static void ValidateProtect(ValidationAgentResult result, ValidationDocumentSnapshot? output)
    {
        if (output is null) return;

        if (!output.IsPdf && output.Warnings.Any(warning => warning.Contains("password", StringComparison.OrdinalIgnoreCase) || warning.Contains("encrypted", StringComparison.OrdinalIgnoreCase)))
        {
            result.Checks.Add(Pass("Protection", "Output cannot be opened without a password, which indicates protection was applied."));
        }
        else
        {
            result.Checks.Add(Review("Protection", "Output opened without a password in validation. Confirm security settings in a PDF reader."));
            result.RemediationSuggestions.Add("Open the output in a PDF reader and confirm it prompts for the expected password.");
        }
    }

    private static void ValidateUnlock(ValidationAgentResult result, ValidationDocumentSnapshot? output)
    {
        if (output?.IsPdf == true)
        {
            result.Checks.Add(Pass("Unlock", "Output PDF can be opened without a password."));
        }
    }

    private static void ValidateOcr(ValidationAgentResult result, ValidationDocumentSnapshot? output)
    {
        if (output is null) return;

        if (!output.IsPdf && output.SizeBytes > 0)
        {
            result.Checks.Add(Pass("OCR output", "OCR produced a text output file."));
        }
    }

    private static void ValidateCompare(
        ValidationAgentResult result,
        IReadOnlyList<ValidationDocumentSnapshot> originals,
        Dictionary<string, JsonElement> resultPayload)
    {
        if (originals.Count == 2)
        {
            result.Checks.Add(Pass("Compare inputs", "Two source PDFs were supplied for comparison."));
        }

        if (resultPayload.TryGetValue("summary", out var summary) && summary.ValueKind == JsonValueKind.Object)
        {
            result.Checks.Add(Pass("Compare result", "Comparison summary was generated."));
            if (summary.TryGetProperty("comparedPageCount", out var comparedPageCount))
            {
                result.Checks.Add(Pass("Compared pages", $"Compared {comparedPageCount.GetInt32()} pages."));
            }
        }
        else
        {
            result.Checks.Add(Review("Compare result", "No comparison result payload was provided to validate."));
        }
    }

    private static void ValidateConversionOrGeneric(ValidationAgentResult result, ValidationDocumentSnapshot? original, ValidationDocumentSnapshot? output)
    {
        if (original is null || output is null) return;

        if (output.SizeBytes > 0)
        {
            result.Checks.Add(Pass("Output file", "The requested operation produced a non-empty output file."));
        }

        if (output.IsPdf && original.IsPdf)
        {
            CheckSamePageCount(result, original, output);
        }
    }

    private static void CheckSamePageCount(ValidationAgentResult result, ValidationDocumentSnapshot original, ValidationDocumentSnapshot output)
    {
        if (original.PageCount is null || output.PageCount is null) return;

        if (original.PageCount == output.PageCount)
        {
            result.Checks.Add(Pass("Page count", $"Page count stayed at {output.PageCount}."));
        }
        else
        {
            result.Checks.Add(Review("Page count", $"Original has {original.PageCount} pages; output has {output.PageCount}."));
        }
    }

    private ValidationDocumentSnapshot Snapshot(UploadedDocument document)
    {
        var snapshot = new ValidationDocumentSnapshot
        {
            FileName = document.FileName,
            SizeBytes = document.Bytes.LongLength,
            IsPdf = LooksLikePdf(document)
        };

        if (!snapshot.IsPdf)
        {
            return snapshot;
        }

        try
        {
            using var pdf = PdfDocument.Open(document.Bytes);
            snapshot.PageCount = pdf.NumberOfPages;
            foreach (var page in pdf.GetPages())
            {
                snapshot.TextCharacterCount += page.Text?.Length ?? 0;
                snapshot.ImageCount += page.GetImages().Count();
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "PdfPig could not inspect {FileName}", document.FileName);
            snapshot.IsPdf = false;
            snapshot.Warnings.Add("PDF content could not be inspected. It may be encrypted, corrupt, or unsupported.");
        }

        try
        {
            using var stream = new MemoryStream(document.Bytes);
            using var pdfSharp = PdfReader.Open(stream, PdfDocumentOpenMode.Import);
            foreach (var page in pdfSharp.Pages)
            {
                snapshot.PageRotations.Add(page.Rotate);
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "PDF rotations/security could not be inspected for {FileName}", document.FileName);
            snapshot.Warnings.Add("PDF page rotation or security metadata could not be inspected without credentials.");
        }

        return snapshot;
    }

    private static ValidationDocumentSnapshot CombineOriginals(IReadOnlyList<ValidationDocumentSnapshot> originals)
    {
        if (originals.Count == 1)
        {
            return originals[0];
        }

        return new ValidationDocumentSnapshot
        {
            FileName = originals.Count == 0 ? string.Empty : $"{originals.Count} original files",
            SizeBytes = originals.Sum(snapshot => snapshot.SizeBytes),
            IsPdf = originals.Count > 0 && originals.All(snapshot => snapshot.IsPdf),
            PageCount = originals.All(snapshot => snapshot.PageCount.HasValue) ? originals.Sum(snapshot => snapshot.PageCount) : null,
            ImageCount = originals.Sum(snapshot => snapshot.ImageCount),
            TextCharacterCount = originals.Sum(snapshot => snapshot.TextCharacterCount),
            PageRotations = originals.SelectMany(snapshot => snapshot.PageRotations).ToList(),
            Warnings = originals.SelectMany(snapshot => snapshot.Warnings).Distinct().ToList()
        };
    }

    private static void FinalizeResult(ValidationAgentResult result)
    {
        var failed = result.Checks.Count(check => check.Status == "fail");
        var needsReview = result.Checks.Count(check => check.Status == "needs-review");
        var passed = result.Checks.Count(check => check.Status == "pass");
        var total = Math.Max(1, result.Checks.Count);

        result.Status = failed > 0 ? "fail" : needsReview > 0 ? "needs-review" : "pass";
        result.Confidence = Math.Round(Math.Max(0.1, (passed + needsReview * 0.45) / total), 2);
        result.Explanation = result.Status switch
        {
            "pass" => "The validation agent found that the output satisfies the requested operation based on deterministic document checks.",
            "fail" => "The validation agent found one or more checks that do not satisfy the requested operation.",
            _ => "The validation agent completed deterministic checks, but at least one aspect needs human review."
        };

        if (result.Warnings.Count > 0 && !result.RemediationSuggestions.Any())
        {
            result.RemediationSuggestions.Add("Review the validation warnings and inspect the output manually before sharing externally.");
        }
    }

    private static bool LooksLikePdf(UploadedDocument document)
    {
        if (document.ContentType.Contains("pdf", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return document.FileName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase) ||
            document.Bytes.Take(5).SequenceEqual("%PDF-"u8.ToArray());
    }

    private static string NormalizeOperation(string operation)
    {
        return operation.Trim().ToLowerInvariant() switch
        {
            "pdf-to-word" => "convert-word",
            "pdf-to-excel" => "convert-excel",
            "pdf-to-powerpoint" => "convert-powerpoint",
            "pdf-to-jpg" => "convert-images",
            var value => value
        };
    }

    private static Dictionary<string, JsonElement> ParseJsonObject(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return new Dictionary<string, JsonElement>();
        }

        try
        {
            using var document = JsonDocument.Parse(json);
            return document.RootElement.ValueKind == JsonValueKind.Object
                ? document.RootElement.EnumerateObject().ToDictionary(property => property.Name, property => property.Value.Clone(), StringComparer.OrdinalIgnoreCase)
                : new Dictionary<string, JsonElement>();
        }
        catch
        {
            return new Dictionary<string, JsonElement>();
        }
    }

    private static List<string> ParseStringArray(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return new List<string>();
        }

        try
        {
            return JsonSerializer.Deserialize<List<string>>(json) ?? new List<string>();
        }
        catch
        {
            return new List<string> { json };
        }
    }

    private static string? GetStringOption(Dictionary<string, JsonElement> options, string name)
    {
        return options.TryGetValue(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    }

    private static int? GetIntOption(Dictionary<string, JsonElement> options, string name)
    {
        if (!options.TryGetValue(name, out var value))
        {
            return null;
        }

        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var numericValue))
        {
            return numericValue;
        }

        return value.ValueKind == JsonValueKind.String && int.TryParse(value.GetString(), out var parsed) ? parsed : null;
    }

    private static int NormalizeDegrees(int degrees)
    {
        var normalized = degrees % 360;
        return normalized < 0 ? normalized + 360 : normalized;
    }

    private static ValidationCheck Pass(string name, string detail) => new() { Name = name, Status = "pass", Detail = detail };

    private static ValidationCheck Review(string name, string detail) => new() { Name = name, Status = "needs-review", Detail = detail };

    private static ValidationCheck Fail(string name, string detail) => new() { Name = name, Status = "fail", Detail = detail };

    private static string FormatBytes(long bytes)
    {
        string[] units = ["B", "KB", "MB", "GB"];
        var value = (double)bytes;
        var unit = 0;
        while (value >= 1024 && unit < units.Length - 1)
        {
            value /= 1024;
            unit++;
        }

        return $"{value:0.#} {units[unit]}";
    }
}

public record UploadedDocument(string FileName, string ContentType, byte[] Bytes);
