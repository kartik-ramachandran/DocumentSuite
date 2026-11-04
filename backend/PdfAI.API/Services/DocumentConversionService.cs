using System.Diagnostics;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using DocumentFormat.OpenXml;
using A = DocumentFormat.OpenXml.Drawing;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Spreadsheet;
using DocumentFormat.OpenXml.Wordprocessing;
using Markdig;
using PdfSharp.Drawing;
using PdfSharp.Pdf;
using SkiaSharp;

namespace PdfAI.API.Services;

public class DocumentConversionService
{
    private readonly IConfiguration _configuration;
    private readonly ILogger<DocumentConversionService> _logger;
    private readonly PdfToolRunner _tools;
    private readonly PdfLayoutService _layoutService;

    public DocumentConversionService(
        IConfiguration configuration,
        ILogger<DocumentConversionService> logger,
        PdfToolRunner tools,
        PdfLayoutService layoutService)
    {
        _configuration = configuration;
        _logger = logger;
        _tools = tools;
        _layoutService = layoutService;
    }

    public async Task<byte[]> ConvertPdfToWord(byte[] pdfBytes, CancellationToken cancellationToken = default)
    {
        return EditableDocumentWriter.WriteWord(await _layoutService.ExtractAsync(pdfBytes, includeImages: true, requireOcr: false, cancellationToken));
    }

    public async Task<byte[]> ConvertPdfToExcel(byte[] pdfBytes, CancellationToken cancellationToken = default)
    {
        return EditableDocumentWriter.WriteExcel(await _layoutService.ExtractAsync(pdfBytes, includeImages: true, requireOcr: false, cancellationToken));
    }

    public async Task<byte[]> ConvertPdfToPowerPoint(byte[] pdfBytes, CancellationToken cancellationToken = default)
    {
        return EditableDocumentWriter.WritePowerPoint(await _layoutService.ExtractAsync(pdfBytes, includeImages: true, requireOcr: false, cancellationToken));
    }

    public Task<List<byte[]>> ConvertPdfToImages(byte[] pdfBytes, string format, int dpi = 220, CancellationToken cancellationToken = default)
    {
        return _tools.RenderPagesAsync(pdfBytes, format, dpi, cancellationToken);
    }

    public Task<List<byte[]>> RenderPdfPreviewImages(byte[] pdfBytes)
    {
        return _tools.RenderPagesAsync(pdfBytes, "jpg", 72);
    }

    public byte[] ConvertPdfToHtml(byte[] pdfBytes)
    {
        var pageImages = _tools.RenderPagesAsync(pdfBytes, "png", 220).GetAwaiter().GetResult();
        var html = new StringBuilder();
        html.AppendLine("<!doctype html><html><head><meta charset=\"utf-8\"><title>Converted PDF</title><style>");
        html.AppendLine("body{margin:0;background:#e5e7eb;color:#111827;font-family:Arial,sans-serif}.page{display:block;width:min(100%,var(--page-width));margin:24px auto;background:white;box-shadow:0 10px 30px rgba(15,23,42,.18)}img{display:block;width:100%;height:auto}");
        html.AppendLine("@media print{body{background:white}.page{margin:0 auto;box-shadow:none;break-after:page}.page:last-child{break-after:auto}}");
        html.AppendLine("</style></head><body>");

        for (var index = 0; index < pageImages.Count; index++)
        {
            var imageSize = GetImageSize(pageImages[index]);
            var data = Convert.ToBase64String(pageImages[index]);
            html.AppendLine($"<main class=\"page\" style=\"--page-width:{imageSize.Width}px\" aria-label=\"Page {index + 1}\"><img src=\"data:image/png;base64,{data}\" width=\"{imageSize.Width}\" height=\"{imageSize.Height}\" alt=\"Page {index + 1}\"></main>");
        }

        html.AppendLine("</body></html>");
        return Encoding.UTF8.GetBytes(html.ToString());
    }

    public byte[] ConvertPdfToMarkdown(byte[] pdfBytes)
    {
        var pageImages = _tools.RenderPagesAsync(pdfBytes, "png", 180).GetAwaiter().GetResult();
        var markdown = new StringBuilder();
        markdown.AppendLine("# Converted PDF");
        markdown.AppendLine();
        markdown.AppendLine("> This Markdown preserves the original PDF styling by embedding each rendered page as an image.");
        markdown.AppendLine();

        for (var index = 0; index < pageImages.Count; index++)
        {
            var data = Convert.ToBase64String(pageImages[index]);
            markdown.AppendLine($"## Page {index + 1}");
            markdown.AppendLine();
            markdown.AppendLine($"![Page {index + 1}](data:image/png;base64,{data})");
            markdown.AppendLine();
        }

        return Encoding.UTF8.GetBytes(markdown.ToString());
    }

    public byte[] ConvertPdfToText(byte[] pdfBytes)
    {
        var configuredPath = _configuration["Tools:Poppler:PdfToTextPath"];
        var executable = string.IsNullOrWhiteSpace(configuredPath) ? GetSiblingToolPath("pdftotext") : configuredPath;
        var tempDirectory = Directory.CreateTempSubdirectory("pdfsuite-text-");
        var inputPath = Path.Combine(tempDirectory.FullName, "input.pdf");
        var outputPath = Path.Combine(tempDirectory.FullName, "converted.txt");

        try
        {
            File.WriteAllBytes(inputPath, pdfBytes);
            RunTool(executable, $"-layout -enc UTF-8 \"{inputPath}\" \"{outputPath}\"").GetAwaiter().GetResult();
            return File.ReadAllBytes(outputPath);
        }
        finally
        {
            tempDirectory.Delete(true);
        }
    }

    public Task<byte[]> ConvertWordToPdf(byte[] docxBytes, string extension = ".docx", CancellationToken cancellationToken = default)
    {
        return ConvertOfficeToPdfAsync(docxBytes, NormalizeOfficeExtension(extension, ".docx", ".doc"), ExportWordToPdf, cancellationToken);
    }

    public Task<byte[]> ConvertExcelToPdf(byte[] xlsxBytes, string extension = ".xlsx", CancellationToken cancellationToken = default)
    {
        return ConvertOfficeToPdfAsync(xlsxBytes, NormalizeOfficeExtension(extension, ".xlsx", ".xls"), ExportExcelToPdf, cancellationToken);
    }

    public Task<byte[]> ConvertPowerPointToPdf(byte[] pptxBytes, string extension = ".pptx", CancellationToken cancellationToken = default)
    {
        return ConvertOfficeToPdfAsync(pptxBytes, NormalizeOfficeExtension(extension, ".pptx", ".ppt"), ExportPowerPointToPdf, cancellationToken);
    }

    public byte[] ConvertHtmlToPdf(byte[] htmlBytes)
    {
        var browser = GetBrowserPath();
        var tempDirectory = Directory.CreateTempSubdirectory("pdfsuite-htmltopdf-");
        var inputPath = Path.Combine(tempDirectory.FullName, "input.html");
        var outputPath = Path.Combine(tempDirectory.FullName, "converted.pdf");

        try
        {
            File.WriteAllBytes(inputPath, htmlBytes);
            RunTool(browser, $"--headless --no-sandbox --disable-gpu --disable-dev-shm-usage --print-to-pdf=\"{outputPath}\" --no-pdf-header-footer \"file:///{inputPath.Replace("\\", "/")}\"").GetAwaiter().GetResult();
            if (!File.Exists(outputPath))
            {
                throw new InvalidOperationException("Browser PDF export did not produce an output file.");
            }

            return File.ReadAllBytes(outputPath);
        }
        finally
        {
            tempDirectory.Delete(true);
        }
    }

    public byte[] ConvertMarkdownToPdf(byte[] markdownBytes)
    {
        var markdown = Encoding.UTF8.GetString(markdownBytes);
        var html = MarkdownToHtml(markdown);
        return ConvertHtmlToPdf(Encoding.UTF8.GetBytes(html));
    }

    private static string MarkdownToHtml(string markdown)
    {
        var pipeline = new MarkdownPipelineBuilder()
            .UseAdvancedExtensions()
            .UseSoftlineBreakAsHardlineBreak()
            .Build();

        var html = new StringBuilder();
        html.AppendLine("<!doctype html><html><head><meta charset=\"utf-8\"><style>");
        html.AppendLine("@page{margin:28mm 22mm}*{box-sizing:border-box}body{max-width:920px;margin:0 auto;color:#111827;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;overflow-wrap:break-word}");
        html.AppendLine("h1,h2,h3,h4,h5,h6{color:#0f172a;line-height:1.2;margin:1.3em 0 .55em;font-weight:700;white-space:normal}h1{font-size:32px;border-bottom:1px solid #e2e8f0;padding-bottom:10px}h2{font-size:24px;border-bottom:1px solid #e2e8f0;padding-bottom:8px}h3{font-size:19px}p{margin:.75em 0;white-space:pre-wrap}");
        html.AppendLine("a{color:#2563eb;text-decoration:underline}strong{font-weight:700}em{font-style:italic}hr{border:0;border-top:1px solid #e2e8f0;margin:24px 0}ul,ol{padding-left:28px;margin:.75em 0}li{margin:.25em 0}li>p{margin:.35em 0}");
        html.AppendLine("blockquote{border-left:4px solid #cbd5e1;margin:16px 0;padding:2px 0 2px 16px;color:#475569;background:#f8fafc;white-space:pre-wrap}code,pre{font-family:Consolas,'Liberation Mono',Menlo,monospace;background:#f1f5f9;border-radius:6px}code{padding:2px 5px;font-size:.92em}pre{padding:14px;overflow-wrap:anywhere;white-space:pre-wrap;page-break-inside:avoid}pre code{padding:0;background:transparent}");
        html.AppendLine("table{width:100%;border-collapse:collapse;margin:18px 0;page-break-inside:auto;white-space:normal}thead{display:table-header-group}tr{page-break-inside:avoid;page-break-after:auto}th,td{border:1px solid #cbd5e1;padding:8px 10px;vertical-align:top;text-align:left}th{background:#f1f5f9;color:#0f172a;font-weight:700}tbody tr:nth-child(even){background:#f8fafc}");
        html.AppendLine("img{max-width:100%;height:auto}input[type=checkbox]{margin-right:6px}.contains-task-list{list-style:none;padding-left:8px}");
        html.AppendLine("</style></head><body>");
        html.AppendLine(Markdown.ToHtml(markdown, pipeline));
        html.AppendLine("</body></html>");
        return html.ToString();
    }

    public byte[] ConvertTextToPdf(byte[] textBytes)
    {
        var text = Encoding.UTF8.GetString(textBytes);
        return CreateTextPdf(text);
    }

    public byte[] ConvertImagesToPdf(IReadOnlyList<byte[]> imageBytes)
    {
        if (imageBytes.Count == 0)
        {
            throw new ArgumentException("At least one image is required.", nameof(imageBytes));
        }

        using var document = new PdfDocument();
        foreach (var bytes in imageBytes)
        {
            if (bytes.Length == 0)
            {
                throw new ArgumentException("One of the selected images is empty.");
            }

            using var stream = new MemoryStream(bytes, 0, bytes.Length, writable: false, publiclyVisible: true);
            using var image = XImage.FromStream(stream) ?? throw new InvalidOperationException("One of the selected images could not be opened. Please use a valid JPG or PNG file.");
            var page = document.AddPage();
            page.Width = XUnit.FromPoint(image.PointWidth);
            page.Height = XUnit.FromPoint(image.PointHeight);

            using var graphics = XGraphics.FromPdfPage(page);
            graphics.DrawImage(image, 0, 0, page.Width.Point, page.Height.Point);
        }

        using var output = new MemoryStream();
        document.Save(output);
        return output.ToArray();
    }

    private static IEnumerable<string> SplitLines(string text)
    {
        return text.Replace("\r\n", "\n").Split('\n');
    }

    private static string ExtractWordText(byte[] docxBytes)
    {
        using var stream = new MemoryStream(docxBytes);
        using var document = WordprocessingDocument.Open(stream, false);
        return document.MainDocumentPart?.Document?.Body?.InnerText?.Trim() ?? string.Empty;
    }

    private static string ExtractExcelText(byte[] xlsxBytes)
    {
        using var stream = new MemoryStream(xlsxBytes);
        using var document = SpreadsheetDocument.Open(stream, false);
        var workbookPart = document.WorkbookPart;
        var output = new StringBuilder();

        if (workbookPart?.Workbook?.Sheets is not Sheets sheets)
            return string.Empty;

        var sharedStrings = workbookPart.SharedStringTablePart?.SharedStringTable;

        foreach (var sheet in sheets.Elements<Sheet>())
        {
            var sheetRelationshipId = sheet.Id?.Value;
            if (string.IsNullOrWhiteSpace(sheetRelationshipId)) continue;

            var worksheetPart = (WorksheetPart?)workbookPart.GetPartById(sheetRelationshipId);
            if (worksheetPart?.Worksheet is null) continue;

            output.AppendLine(sheet.Name?.Value ?? "Sheet");
            foreach (var row in worksheetPart.Worksheet.Descendants<Row>())
            {
                var values = row.Elements<Cell>()
                    .Select(cell => GetCellText(cell, sharedStrings))
                    .Where(value => !string.IsNullOrWhiteSpace(value))
                    .ToArray();

                if (values.Length > 0)
                    output.AppendLine(string.Join("    ", values));
            }
            output.AppendLine();
        }

        return output.ToString().Trim();
    }

    private static string GetCellText(Cell cell, SharedStringTable? sharedStrings)
    {
        var rawValue = cell.CellValue?.Text ?? cell.InnerText ?? string.Empty;
        if (cell.DataType?.Value == CellValues.SharedString && int.TryParse(rawValue, out var sharedStringIndex))
            return sharedStrings?.Elements<SharedStringItem>().ElementAtOrDefault(sharedStringIndex)?.InnerText ?? string.Empty;

        return rawValue;
    }

    private static string ExtractPowerPointText(byte[] pptxBytes)
    {
        using var stream = new MemoryStream(pptxBytes);
        using var document = PresentationDocument.Open(stream, false);
        var output = new StringBuilder();
        var slideNumber = 1;

        foreach (var slidePart in document.PresentationPart?.SlideParts ?? Enumerable.Empty<SlidePart>())
        {
            if (slidePart.Slide is null) continue;

            var lines = slidePart.Slide.Descendants<A.Text>()
                .Select(t => t.Text)
                .Where(t => !string.IsNullOrWhiteSpace(t))
                .ToArray();

            output.AppendLine($"Slide {slideNumber}");
            foreach (var line in lines) output.AppendLine(line);
            output.AppendLine();
            slideNumber++;
        }

        return output.ToString().Trim();
    }

    private async Task<byte[]> ConvertOfficeToPdfAsync(byte[] inputBytes, string extension, Action<string, string> export, CancellationToken cancellationToken)
    {
        if (OperatingSystem.IsWindows())
        {
            try
            {
                return ConvertViaCom(inputBytes, extension, export);
            }
            catch (InvalidOperationException ex) when (ex.Message.Contains("not installed", StringComparison.OrdinalIgnoreCase))
            {
                // Office not installed — fall through to LibreOffice
            }
        }

        try
        {
            return await ConvertViaLibreOffice(inputBytes, extension, cancellationToken);
        }
        catch (Exception libreEx) when (!OperatingSystem.IsWindows() && libreEx is not OperationCanceledException)
        {
            _logger.LogWarning(libreEx, "LibreOffice conversion failed for {Extension}; falling back to text extraction", extension);

            var text = extension switch
            {
                ".docx" or ".doc" => ExtractWordText(inputBytes),
                ".xlsx" or ".xls" => ExtractExcelText(inputBytes),
                ".pptx" or ".ppt" => ExtractPowerPointText(inputBytes),
                _ => string.Empty
            };

            if (string.IsNullOrWhiteSpace(text))
                throw new InvalidOperationException(
                    $"LibreOffice failed ({libreEx.Message}) and no text could be extracted. " +
                    "The file may be image-only, password-protected, or corrupted.");

            return CreateTextPdf(text);
        }
    }

    private static byte[] ConvertViaCom(byte[] inputBytes, string extension, Action<string, string> export)
    {
        var tempDirectory = Directory.CreateTempSubdirectory("pdfsuite-office-");
        var inputPath = Path.Combine(tempDirectory.FullName, $"input{extension}");
        var outputPath = Path.Combine(tempDirectory.FullName, "converted.pdf");

        try
        {
            File.WriteAllBytes(inputPath, inputBytes);
            export(inputPath, outputPath);
            if (!File.Exists(outputPath))
                throw new InvalidOperationException("Office PDF export did not produce an output file.");

            return File.ReadAllBytes(outputPath);
        }
        finally
        {
            try { tempDirectory.Delete(true); } catch { }
        }
    }

    private async Task<byte[]> ConvertViaLibreOffice(byte[] inputBytes, string extension, CancellationToken cancellationToken)
    {
        var soffice = FindLibreOffice();
        var tempDirectory = Directory.CreateTempSubdirectory("pdfsuite-libre-");
        var inputPath = Path.Combine(tempDirectory.FullName, $"input{extension}");
        // Isolated HOME per request prevents LibreOffice profile conflicts under concurrent load
        var homeDir = Path.Combine(tempDirectory.FullName, "home");
        Directory.CreateDirectory(homeDir);

        try
        {
            File.WriteAllBytes(inputPath, inputBytes);

            // xvfb-run provides a virtual X11 display so LibreOffice's X11 init
            // succeeds in headless containers (needs xvfb + xauth packages).
            var xvfbRun = "/usr/bin/xvfb-run";
            var startInfo = new ProcessStartInfo
            {
                FileName = File.Exists(xvfbRun) ? xvfbRun : soffice,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            if (File.Exists(xvfbRun))
            {
                startInfo.ArgumentList.Add("--auto-servernum");
                startInfo.ArgumentList.Add("--server-args=-screen 0 1x1x8");
                startInfo.ArgumentList.Add(soffice);
            }
            startInfo.ArgumentList.Add("--headless");
            startInfo.ArgumentList.Add("--norestore");
            startInfo.ArgumentList.Add("--nolockcheck");
            startInfo.ArgumentList.Add("--convert-to");
            startInfo.ArgumentList.Add("pdf");
            startInfo.ArgumentList.Add("--outdir");
            startInfo.ArgumentList.Add(tempDirectory.FullName);
            startInfo.ArgumentList.Add(inputPath);
            startInfo.Environment["HOME"] = homeDir;
            startInfo.Environment["DBUS_SESSION_BUS_ADDRESS"] = "/dev/null";

            using var process = Process.Start(startInfo)
                ?? throw new InvalidOperationException("Could not start LibreOffice.");

            var stdoutTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
            var stderrTask = process.StandardError.ReadToEndAsync(cancellationToken);

            try
            {
                await process.WaitForExitAsync(cancellationToken);
            }
            catch (OperationCanceledException)
            {
                process.Kill(entireProcessTree: true);
                throw;
            }

            var stdout = await stdoutTask;
            var stderr = await stderrTask;

            _logger.LogInformation("LibreOffice exit={Code} stdout={Out} stderr={Err}",
                process.ExitCode, stdout.Trim(), stderr.Trim());

            var outputPath = Path.Combine(tempDirectory.FullName, "input.pdf");
            if (!File.Exists(outputPath))
            {
                var anyPdf = Directory.GetFiles(tempDirectory.FullName, "*.pdf").FirstOrDefault();
                if (anyPdf != null) return File.ReadAllBytes(anyPdf);

                throw new InvalidOperationException(
                    $"LibreOffice (exit {process.ExitCode}) produced no output. " +
                    $"{(string.IsNullOrWhiteSpace(stderr) ? stdout : stderr).Trim()}");
            }

            return File.ReadAllBytes(outputPath);
        }
        finally
        {
            try { tempDirectory.Delete(true); } catch { }
        }
    }

    private string FindLibreOffice()
    {
        var configured = _configuration["Tools:LibreOffice:SofficePath"] ?? _configuration["Tools:LibreOffice:Path"];
        if (!string.IsNullOrWhiteSpace(configured) && File.Exists(configured))
            return configured;

        var candidates = OperatingSystem.IsWindows()
            ? new[]
            {
                @"C:\Program Files\LibreOffice\program\soffice.exe",
                @"C:\Program Files (x86)\LibreOffice\program\soffice.exe"
            }
            : new[]
            {
                "/usr/bin/soffice",
                "/usr/local/bin/soffice",
                "/opt/libreoffice/program/soffice"
            };

        return candidates.FirstOrDefault(File.Exists)
            ?? throw new InvalidOperationException(
                "Neither Microsoft Office nor LibreOffice is available. " +
                "Install LibreOffice or set Tools:LibreOffice:SofficePath in appsettings.");
    }

    private static string NormalizeOfficeExtension(string extension, params string[] allowedExtensions)
    {
        var normalized = Path.GetExtension(extension);
        if (string.IsNullOrWhiteSpace(normalized))
            normalized = extension;

        normalized = normalized.StartsWith('.') ? normalized.ToLowerInvariant() : $".{normalized.ToLowerInvariant()}";
        return allowedExtensions.Contains(normalized) ? normalized : allowedExtensions[0];
    }

#pragma warning disable CA1416
    private static void ExportWordToPdf(string inputPath, string outputPath)
    {
        dynamic? app = null;
        dynamic? document = null;
        try
        {
            var wordType = Type.GetTypeFromProgID("Word.Application") ?? throw new InvalidOperationException("Microsoft Word is not installed.");
            app = Activator.CreateInstance(wordType) ?? throw new InvalidOperationException("Could not start Microsoft Word.");
            app.Visible = false;
            app.DisplayAlerts = 0;
            document = app.Documents.Open(inputPath, ReadOnly: true, Visible: false);
            document.ExportAsFixedFormat(outputPath, 17);
        }
        finally
        {
            if (document is not null)
            {
                try { document.Close(false); } catch { }
                Marshal.FinalReleaseComObject(document);
            }
            if (app is not null)
            {
                try { app.Quit(false); } catch { }
                Marshal.FinalReleaseComObject(app);
            }
        }
    }

    private static void ExportExcelToPdf(string inputPath, string outputPath)
    {
        dynamic? app = null;
        dynamic? workbook = null;
        try
        {
            var excelType = Type.GetTypeFromProgID("Excel.Application") ?? throw new InvalidOperationException("Microsoft Excel is not installed.");
            app = Activator.CreateInstance(excelType) ?? throw new InvalidOperationException("Could not start Microsoft Excel.");
            app.Visible = false;
            app.DisplayAlerts = false;
            workbook = app.Workbooks.Open(inputPath, ReadOnly: true);
            workbook.ExportAsFixedFormat(0, outputPath);
        }
        finally
        {
            if (workbook is not null)
            {
                try { workbook.Close(false); } catch { }
                Marshal.FinalReleaseComObject(workbook);
            }
            if (app is not null)
            {
                try { app.Quit(); } catch { }
                Marshal.FinalReleaseComObject(app);
            }
        }
    }

    private static void ExportPowerPointToPdf(string inputPath, string outputPath)
    {
        dynamic? app = null;
        dynamic? presentation = null;
        try
        {
            var powerPointType = Type.GetTypeFromProgID("PowerPoint.Application") ?? throw new InvalidOperationException("Microsoft PowerPoint is not installed.");
            app = Activator.CreateInstance(powerPointType) ?? throw new InvalidOperationException("Could not start Microsoft PowerPoint.");
            app.Visible = -1;

            // PowerPoint COM is sensitive to optional/named arguments — use positional order.
            presentation = app.Presentations.Open(inputPath, -1, 0, -1);
            presentation.SaveAs(outputPath, 32);
        }
        catch (COMException ex)
        {
            throw new InvalidOperationException("PowerPoint could not open this deck. Close any PowerPoint dialogs, make sure the file is a valid .pptx/.ppt file, and try again.", ex);
        }
        finally
        {
            if (presentation is not null)
            {
                try { presentation.Close(); } catch { }
                Marshal.FinalReleaseComObject(presentation);
            }
            if (app is not null)
            {
                try { app.Quit(); } catch { }
                Marshal.FinalReleaseComObject(app);
            }
        }
    }
#pragma warning restore CA1416

    private string GetBrowserPath()
    {
        var configured = _configuration["Tools:Browser:Path"];
        if (!string.IsNullOrWhiteSpace(configured) && File.Exists(configured))
            return configured;

        var candidates = new[]
        {
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/usr/bin/google-chrome",
            "/usr/bin/microsoft-edge",
            @"C:\Program Files\Google\Chrome\Application\chrome.exe",
            @"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            @"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
            @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
        };

        return candidates.FirstOrDefault(File.Exists) ?? (OperatingSystem.IsWindows() ? "msedge" : "chromium");
    }

    private string GetSiblingToolPath(string toolName)
    {
        var pdfToPpm = _configuration["Tools:Poppler:PdfToPpmPath"];
        if (!string.IsNullOrWhiteSpace(pdfToPpm))
        {
            var directory = Path.GetDirectoryName(pdfToPpm);
            var siblingPath = directory is null ? null : Path.Combine(directory, $"{toolName}.exe");
            if (!string.IsNullOrWhiteSpace(siblingPath) && File.Exists(siblingPath))
                return siblingPath;
        }

        return toolName;
    }

    private static (int Width, int Height) GetImageSize(byte[] imageBytes)
    {
        using var bitmap = SKBitmap.Decode(imageBytes);
        return bitmap is null ? (1200, 1600) : (bitmap.Width, bitmap.Height);
    }

    private static byte[] CreateTextPdf(string text)
    {
        using var document = new PdfDocument();
        var font = new XFont("Arial", 11);
        var page = document.AddPage();
        page.Size = PdfSharp.PageSize.A4;
        var graphics = XGraphics.FromPdfPage(page);
        var margin = 42d;
        var y = margin;
        var lineHeight = 16d;
        var maxChars = 96;

        foreach (var rawLine in SplitLines(text))
        {
            foreach (var line in WrapLine(rawLine, maxChars))
            {
                if (y > page.Height.Point - margin)
                {
                    graphics.Dispose();
                    page = document.AddPage();
                    page.Size = PdfSharp.PageSize.A4;
                    graphics = XGraphics.FromPdfPage(page);
                    y = margin;
                }

                graphics.DrawString(line, font, XBrushes.Black, new XRect(margin, y, page.Width.Point - margin * 2, lineHeight), XStringFormats.TopLeft);
                y += lineHeight;
            }
        }

        graphics.Dispose();
        using var output = new MemoryStream();
        document.Save(output);
        return output.ToArray();
    }

    private static IEnumerable<string> WrapLine(string line, int maxChars)
    {
        if (string.IsNullOrEmpty(line)) { yield return string.Empty; yield break; }

        for (var i = 0; i < line.Length; i += maxChars)
            yield return line.Substring(i, Math.Min(maxChars, line.Length - i));
    }

    private static async Task RunTool(string executable, string arguments)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = executable,
            Arguments = arguments,
            RedirectStandardError = true,
            RedirectStandardOutput = true,
            UseShellExecute = false
        };

        using var process = Process.Start(startInfo) ?? throw new InvalidOperationException($"Could not start {executable}.");
        var error = await process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync();

        if (process.ExitCode != 0)
            throw new InvalidOperationException($"{executable} failed with exit code {process.ExitCode}. {error}");
    }
}
