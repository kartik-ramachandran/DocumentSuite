using System.Globalization;
using System.Security;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using A = DocumentFormat.OpenXml.Drawing;
using DW = DocumentFormat.OpenXml.Drawing.Wordprocessing;
using PIC = DocumentFormat.OpenXml.Drawing.Pictures;
using S = DocumentFormat.OpenXml.Spreadsheet;
using W = DocumentFormat.OpenXml.Wordprocessing;
using XDR = DocumentFormat.OpenXml.Drawing.Spreadsheet;

namespace PdfAI.API.Services;

/// <summary>Writes analysed PDF pages as real, editable Word, Excel and PowerPoint documents.</summary>
public static partial class EditableDocumentWriter
{
    private const long EmuPerPoint = 12700;
    private const int TwipsPerPoint = 20;
    private const double MinGapForSpacer = 6;   // points
    private const double MinIndent = 6;         // points
    private const short TableCellMarginTwips = 80;

    // ── Word ─────────────────────────────────────────────────────────────

    public static byte[] WriteWord(IReadOnlyList<LayoutPage> pages)
    {
        using var stream = new MemoryStream();
        using (var document = CreateWordDocument(stream))
        {
            var mainPart = document.MainDocumentPart!;
            var body = mainPart.Document!.Body!;
            var images = new Dictionary<string, string>();
            uint nextDrawingId = 1;

            var (marginLeft, marginRight) = GetWordMargins(pages);

            for (var index = 0; index < pages.Count; index++)
            {
                var page = pages[index];
                var next = index + 1 < pages.Count ? pages[index + 1] : null;
                var startsNewPage = index > 0 && SameSize(pages[index - 1], page);
                var contentWidth = Math.Max(page.Width - marginLeft - marginRight, 72);
                var firstBlock = true;
                double? previousBottom = null;

                foreach (var block in page.Blocks)
                {
                    var pageBreak = startsNewPage && firstBlock;
                    switch (block)
                    {
                        case ParagraphBlock paragraph:
                            body.AppendChild(WriteWordParagraph(paragraph, marginLeft, previousBottom, pageBreak));
                            previousBottom = paragraph.Bottom;
                            break;
                        case TableBlock table:
                            // Word has no space-before on tables, so a blank line separates one from the text above.
                            if (pageBreak || table.Top - (previousBottom ?? table.Top) >= MinGapForSpacer)
                                body.AppendChild(CreateEmptyParagraph(pageBreak));
                            body.AppendChild(WriteWordTable(table, contentWidth, marginLeft));
                            body.AppendChild(CreateEmptyParagraph());
                            previousBottom = table.Bottom;
                            break;
                        case ImageBlock image:
                            body.AppendChild(WriteWordImage(mainPart, image.Image, contentWidth, marginLeft, previousBottom, images, nextDrawingId++, pageBreak));
                            previousBottom = image.Image.Top + image.Image.Height;
                            break;
                    }

                    firstBlock = false;
                }

                if (firstBlock && startsNewPage)
                    body.AppendChild(CreateEmptyParagraph(pageBreak: true));

                // A section ends wherever the next page has different dimensions.
                if (next is null)
                    body.AppendChild(CreateSection(page, marginLeft, marginRight));
                else if (!SameSize(page, next))
                    body.AppendChild(new W.Paragraph(new W.ParagraphProperties(CreateSection(page, marginLeft, marginRight))));
            }

            if (pages.Count == 0)
                body.AppendChild(new W.Paragraph());

            mainPart.Document.Save();
        }

        return stream.ToArray();
    }

    private static WordprocessingDocument CreateWordDocument(Stream stream)
    {
        var document = WordprocessingDocument.Create(stream, WordprocessingDocumentType.Document, true);
        var mainPart = document.AddMainDocumentPart();
        mainPart.Document = new W.Document(new W.Body());
        return document;
    }

    private static bool SameSize(LayoutPage a, LayoutPage b) =>
        Math.Abs(a.Width - b.Width) < 1 && Math.Abs(a.Height - b.Height) < 1;

    private static (double Left, double Right) GetWordMargins(IReadOnlyList<LayoutPage> pages)
    {
        var lefts = new List<double>();
        var rights = new List<double>();
        foreach (var page in pages)
        {
            foreach (var paragraph in page.Blocks.OfType<ParagraphBlock>())
            {
                lefts.Add(paragraph.Left);
                rights.Add(page.Width - paragraph.Right);
            }
        }

        return (Math.Clamp(lefts.Count > 0 ? lefts.Min() : 54, 18, 90), Math.Clamp(rights.Count > 0 ? rights.Min() : 54, 18, 90));
    }

    private static W.SectionProperties CreateSection(LayoutPage page, double marginLeft, double marginRight)
    {
        var landscape = page.Width > page.Height;
        return new W.SectionProperties(
            new W.PageSize
            {
                Width = (uint)(page.Width * TwipsPerPoint),
                Height = (uint)(page.Height * TwipsPerPoint),
                Orient = landscape ? W.PageOrientationValues.Landscape : W.PageOrientationValues.Portrait
            },
            new W.PageMargin
            {
                Top = 720, Bottom = 720, Header = 360, Footer = 360, Gutter = 0,
                Left = (uint)(marginLeft * TwipsPerPoint),
                Right = (uint)(marginRight * TwipsPerPoint)
            });
    }

    private static W.Paragraph CreateEmptyParagraph(bool pageBreak = false)
    {
        var properties = new W.ParagraphProperties();
        if (pageBreak)
            properties.AppendChild(new W.PageBreakBefore());
        properties.AppendChild(new W.SpacingBetweenLines { Before = "0", After = "0" });
        return new W.Paragraph(properties);
    }

    private static W.Paragraph WriteWordParagraph(ParagraphBlock block, double marginLeft, double? previousBottom, bool pageBreak)
    {
        // Schema order: pageBreakBefore, spacing, ind, jc, outlineLvl.
        var properties = new W.ParagraphProperties();
        if (pageBreak)
            properties.AppendChild(new W.PageBreakBefore());

        var gap = previousBottom is { } bottom ? Math.Clamp(block.Top - bottom, 0, 36) : 0;
        properties.AppendChild(new W.SpacingBetweenLines { Before = ((int)(gap * TwipsPerPoint)).ToString(CultureInfo.InvariantCulture), After = "0" });

        if (block.Centered)
        {
            properties.AppendChild(new W.Justification { Val = W.JustificationValues.Center });
        }
        else
        {
            // Measured from the block's own column, so a right-hand column doesn't become one narrow strip.
            var indent = block.Left - Math.Max(marginLeft, block.RegionLeft);
            if (indent >= MinIndent)
                properties.AppendChild(new W.Indentation { Left = ((int)(indent * TwipsPerPoint)).ToString(CultureInfo.InvariantCulture) });
        }

        if (block.FontSize >= 16)
            properties.AppendChild(new W.OutlineLevel { Val = block.FontSize >= 22 ? 0 : 1 });

        var paragraph = new W.Paragraph(properties);
        AppendWordRuns(paragraph, MergeParagraphWords(block));
        return paragraph;
    }

    // Joins wrapped lines back into flowing text so edits re-wrap normally. Gaps inside a line become tabs.
    private static IEnumerable<(LayoutWord Word, string Before)> MergeParagraphWords(ParagraphBlock block)
    {
        for (var lineIndex = 0; lineIndex < block.Lines.Count; lineIndex++)
        {
            var line = block.Lines[lineIndex];
            var words = line.Segments.SelectMany((segment, segmentIndex) => segment.Words.Select((word, wordIndex) =>
                (Word: word, Before: wordIndex > 0 ? " " : segmentIndex > 0 ? "\t" : string.Empty))).ToList();

            for (var i = 0; i < words.Count; i++)
            {
                var (word, before) = words[i];
                if (i == 0 && lineIndex > 0)
                {
                    var previous = block.Lines[lineIndex - 1].Segments[^1].Words[^1];
                    before = previous.Text.EndsWith('-') && char.IsLower(word.Text[0]) ? string.Empty : " ";
                }

                // A hyphen at the end of a wrapped line is only there because of the wrap.
                var nextLine = lineIndex + 1 < block.Lines.Count ? block.Lines[lineIndex + 1] : null;
                var isLineEnd = i == words.Count - 1;
                if (isLineEnd && nextLine is not null && word.Text.EndsWith('-') && char.IsLower(nextLine.Segments[0].Words[0].Text[0]))
                    word = word with { Text = word.Text[..^1] };

                yield return (word, before);
            }
        }
    }

    private static void AppendWordRuns(W.Paragraph paragraph, IEnumerable<(LayoutWord Word, string Before)> words)
    {
        var text = new StringBuilder();
        LayoutWord? style = null;

        foreach (var (word, before) in words)
        {
            if (style is not null && !SameRunStyle(style, word))
            {
                paragraph.AppendChild(CreateWordRun(text.ToString(), style));
                text.Clear();
            }

            style = word;
            text.Append(before).Append(word.Text);
        }

        if (style is not null)
            paragraph.AppendChild(CreateWordRun(text.ToString(), style));
    }

    private static bool SameRunStyle(LayoutWord a, LayoutWord b) =>
        a.FontSize == b.FontSize && a.Bold == b.Bold && a.Italic == b.Italic && a.FontName == b.FontName && a.ColorHex == b.ColorHex;

    private static W.Run CreateWordRun(string text, LayoutWord style)
    {
        // Schema order: rFonts, b, i, color, sz, szCs.
        var properties = new W.RunProperties();
        if (style.FontName is { } font)
            properties.AppendChild(new W.RunFonts { Ascii = font, HighAnsi = font, ComplexScript = font });
        if (style.Bold)
            properties.AppendChild(new W.Bold());
        if (style.Italic)
            properties.AppendChild(new W.Italic());
        if (style.ColorHex is { } color)
            properties.AppendChild(new W.Color { Val = color });

        var halfPoints = ((int)Math.Clamp(Math.Round(style.FontSize * 2), 2, 3276)).ToString(CultureInfo.InvariantCulture);
        properties.AppendChild(new W.FontSize { Val = halfPoints });
        properties.AppendChild(new W.FontSizeComplexScript { Val = halfPoints });

        var run = new W.Run(properties);
        var parts = Sanitize(text).Split('\t');
        for (var i = 0; i < parts.Length; i++)
        {
            if (i > 0)
                run.AppendChild(new W.TabChar());
            if (parts[i].Length > 0)
                run.AppendChild(new W.Text(parts[i]) { Space = SpaceProcessingModeValues.Preserve });
        }

        return run;
    }

    private static W.Table WriteWordTable(TableBlock table, double contentWidth, double marginLeft)
    {
        var indent = Math.Max(table.Left - marginLeft, 0);
        var total = Math.Max(table.ColumnWidths.Sum(), 1);
        if (indent + total > contentWidth)
            indent = Math.Max(contentWidth - total, 0);
        var scale = Math.Min(1, contentWidth / total);
        var widths = table.ColumnWidths.Select(width => (int)(Math.Max(width, 12) * scale * TwipsPerPoint)).ToList();

        var wordTable = new W.Table(new W.TableProperties(
            new W.TableWidth { Width = widths.Sum().ToString(CultureInfo.InvariantCulture), Type = W.TableWidthUnitValues.Dxa },
            new W.TableBorders(
                new W.TopBorder { Val = W.BorderValues.Single, Size = 4, Color = "BFBFBF" },
                new W.LeftBorder { Val = W.BorderValues.Single, Size = 4, Color = "BFBFBF" },
                new W.BottomBorder { Val = W.BorderValues.Single, Size = 4, Color = "BFBFBF" },
                new W.RightBorder { Val = W.BorderValues.Single, Size = 4, Color = "BFBFBF" },
                new W.InsideHorizontalBorder { Val = W.BorderValues.Single, Size = 4, Color = "BFBFBF" },
                new W.InsideVerticalBorder { Val = W.BorderValues.Single, Size = 4, Color = "BFBFBF" }),
            new W.TableLayout { Type = W.TableLayoutValues.Fixed },
            new W.TableCellMarginDefault(
                new W.TableCellLeftMargin { Width = TableCellMarginTwips, Type = W.TableWidthValues.Dxa },
                new W.TableCellRightMargin { Width = TableCellMarginTwips, Type = W.TableWidthValues.Dxa })));
        wordTable.GetFirstChild<W.TableProperties>()!.InsertAfter(
            new W.TableIndentation { Width = (int)(indent * TwipsPerPoint), Type = W.TableWidthUnitValues.Dxa },
            wordTable.GetFirstChild<W.TableProperties>()!.GetFirstChild<W.TableWidth>());

        wordTable.AppendChild(new W.TableGrid(widths.Select(width => new W.GridColumn { Width = width.ToString(CultureInfo.InvariantCulture) })));

        foreach (var row in table.Rows)
        {
            var tableRow = new W.TableRow();
            for (var column = 0; column < row.Count; column++)
            {
                var paragraph = new W.Paragraph(new W.ParagraphProperties(new W.SpacingBetweenLines { Before = "0", After = "0" }));
                AppendWordRuns(paragraph, row[column].Words.Select((word, index) => (word, index > 0 ? " " : string.Empty)));
                tableRow.AppendChild(new W.TableCell(
                    new W.TableCellProperties(new W.TableCellWidth { Width = widths[column].ToString(CultureInfo.InvariantCulture), Type = W.TableWidthUnitValues.Dxa }),
                    paragraph));
            }

            wordTable.AppendChild(tableRow);
        }

        return wordTable;
    }

    private static W.Paragraph WriteWordImage(MainDocumentPart mainPart, LayoutImage image, double contentWidth, double marginLeft, double? previousBottom, Dictionary<string, string> images, uint drawingId, bool pageBreak)
    {
        var key = Convert.ToHexString(SHA256.HashData(image.Bytes));
        if (!images.TryGetValue(key, out var relationshipId))
        {
            var imagePart = mainPart.AddImagePart(image.IsJpeg ? ImagePartType.Jpeg : ImagePartType.Png);
            using var imageStream = new MemoryStream(image.Bytes);
            imagePart.FeedData(imageStream);
            relationshipId = mainPart.GetIdOfPart(imagePart);
            images[key] = relationshipId;
        }

        var scale = Math.Min(1, contentWidth / Math.Max(image.Width, 1));
        var cx = (long)(image.Width * scale * EmuPerPoint);
        var cy = (long)(image.Height * scale * EmuPerPoint);

        var drawing = new W.Drawing(new DW.Inline(
            new DW.Extent { Cx = cx, Cy = cy },
            new DW.EffectExtent { LeftEdge = 0L, TopEdge = 0L, RightEdge = 0L, BottomEdge = 0L },
            new DW.DocProperties { Id = drawingId, Name = $"Image {drawingId}" },
            new DW.NonVisualGraphicFrameDrawingProperties(new A.GraphicFrameLocks { NoChangeAspect = true }),
            new A.Graphic(new A.GraphicData(
                new PIC.Picture(
                    new PIC.NonVisualPictureProperties(
                        new PIC.NonVisualDrawingProperties { Id = drawingId, Name = $"Image {drawingId}" },
                        new PIC.NonVisualPictureDrawingProperties()),
                    new PIC.BlipFill(new A.Blip { Embed = relationshipId }, new A.Stretch(new A.FillRectangle())),
                    new PIC.ShapeProperties(
                        new A.Transform2D(new A.Offset { X = 0L, Y = 0L }, new A.Extents { Cx = cx, Cy = cy }),
                        new A.PresetGeometry(new A.AdjustValueList()) { Preset = A.ShapeTypeValues.Rectangle })))
            { Uri = "http://schemas.openxmlformats.org/drawingml/2006/picture" }))
        {
            DistanceFromTop = 0U, DistanceFromBottom = 0U, DistanceFromLeft = 0U, DistanceFromRight = 0U
        });

        var properties = new W.ParagraphProperties();
        if (pageBreak)
            properties.AppendChild(new W.PageBreakBefore());
        var gap = previousBottom is { } bottom ? Math.Clamp(image.Top - bottom, 0, 36) : 0;
        properties.AppendChild(new W.SpacingBetweenLines { Before = ((int)(gap * TwipsPerPoint)).ToString(CultureInfo.InvariantCulture), After = "0" });
        var indent = image.Left - marginLeft;
        if (indent >= MinIndent && indent + image.Width * scale <= contentWidth)
            properties.AppendChild(new W.Indentation { Left = ((int)(indent * TwipsPerPoint)).ToString(CultureInfo.InvariantCulture) });
        return new W.Paragraph(properties, new W.Run(drawing));
    }

    // ── Excel ────────────────────────────────────────────────────────────

    public static byte[] WriteExcel(IReadOnlyList<LayoutPage> pages)
    {
        using var stream = new MemoryStream();
        using (var document = SpreadsheetDocument.Create(stream, SpreadsheetDocumentType.Workbook, true))
        {
            var workbookPart = document.AddWorkbookPart();
            workbookPart.Workbook = new S.Workbook();
            AddExcelStyles(workbookPart);
            var sheets = workbookPart.Workbook.AppendChild(new S.Sheets());

            for (var index = 0; index < pages.Count; index++)
            {
                var worksheetPart = workbookPart.AddNewPart<WorksheetPart>();
                WriteWorksheet(worksheetPart, pages[index]);
                sheets.Append(new S.Sheet
                {
                    Id = workbookPart.GetIdOfPart(worksheetPart),
                    SheetId = (uint)index + 1,
                    Name = $"Page {pages[index].Number}"
                });
            }

            workbookPart.Workbook.Save();
        }

        return stream.ToArray();
    }

    private static void AddExcelStyles(WorkbookPart workbookPart)
    {
        var stylesPart = workbookPart.AddNewPart<WorkbookStylesPart>();
        stylesPart.Stylesheet = new S.Stylesheet(
            new S.Fonts(new S.Font(), new S.Font(new S.Bold())) { Count = 2 },
            new S.Fills(
                new S.Fill(new S.PatternFill { PatternType = S.PatternValues.None }),
                new S.Fill(new S.PatternFill { PatternType = S.PatternValues.Gray125 })) { Count = 2 },
            new S.Borders(new S.Border()) { Count = 1 },
            new S.CellStyleFormats(new S.CellFormat()) { Count = 1 },
            new S.CellFormats(
                new S.CellFormat(),
                new S.CellFormat { FontId = 1, ApplyFont = true }) { Count = 2 });
        stylesPart.Stylesheet.Save();
    }

    private static void WriteWorksheet(WorksheetPart worksheetPart, LayoutPage page)
    {
        var sheetData = new S.SheetData();
        var widths = new Dictionary<int, int>();
        var images = new List<(LayoutImage Image, uint Row)>();
        uint rowNumber = 1;

        foreach (var block in page.Blocks)
        {
            switch (block)
            {
                case ParagraphBlock paragraph:
                    foreach (var line in paragraph.Lines)
                    {
                        // Text lines overflow across empty cells, so they don't widen column A.
                        var cells = line.Segments.Select(segment => (segment.Text, segment.Words.All(word => word.Bold))).ToList();
                        sheetData.Append(CreateExcelRow(rowNumber++, cells, widths, trackWidth: cells.Count > 1));
                    }
                    break;

                case TableBlock table:
                    foreach (var row in table.Rows)
                    {
                        var cells = row.Select(cell => (cell.Text, cell.Words.Count > 0 && cell.Words.All(word => word.Bold))).ToList();
                        sheetData.Append(CreateExcelRow(rowNumber++, cells, widths, trackWidth: true));
                    }
                    rowNumber++;
                    break;

                case ImageBlock image:
                    images.Add((image.Image, rowNumber - 1));
                    rowNumber += (uint)Math.Ceiling(image.Image.Height / 15) + 1;
                    break;
            }
        }

        var worksheet = new S.Worksheet();
        if (widths.Count > 0)
        {
            worksheet.Append(new S.Columns(widths.OrderBy(entry => entry.Key).Select(entry => new S.Column
            {
                Min = (uint)entry.Key + 1,
                Max = (uint)entry.Key + 1,
                Width = Math.Clamp(entry.Value + 2, 8, 60),
                CustomWidth = true
            })));
        }

        worksheet.Append(sheetData);
        worksheetPart.Worksheet = worksheet;

        if (images.Count > 0)
            AddExcelImages(worksheetPart, images);

        worksheetPart.Worksheet.Save();
    }

    private static S.Row CreateExcelRow(uint rowNumber, List<(string Text, bool Bold)> cells, Dictionary<int, int> widths, bool trackWidth)
    {
        var row = new S.Row { RowIndex = rowNumber };
        for (var column = 0; column < cells.Count; column++)
        {
            var text = Sanitize(cells[column].Text);
            if (text.Length == 0)
                continue;

            if (trackWidth)
                widths[column] = Math.Max(widths.GetValueOrDefault(column), text.Length);

            var cell = new S.Cell { CellReference = $"{ColumnName(column)}{rowNumber}", StyleIndex = cells[column].Bold ? 1U : 0U };
            if (TryParseNumber(text, out var number))
            {
                cell.DataType = S.CellValues.Number;
                cell.CellValue = new S.CellValue(number.ToString(CultureInfo.InvariantCulture));
            }
            else
            {
                cell.DataType = S.CellValues.InlineString;
                cell.InlineString = new S.InlineString(new S.Text(text) { Space = SpaceProcessingModeValues.Preserve });
            }

            row.Append(cell);
        }

        return row;
    }

    /// <summary>Only plain numbers become numeric. IDs with leading zeros and very long numbers stay text.</summary>
    public static bool TryParseNumber(string text, out decimal number)
    {
        number = 0;
        return PlainNumber().IsMatch(text)
            && text.Count(char.IsDigit) <= 15
            && decimal.TryParse(text, NumberStyles.AllowLeadingSign | NumberStyles.AllowThousands | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out number);
    }

    private static string ColumnName(int index)
    {
        var name = string.Empty;
        for (var value = index + 1; value > 0; value = (value - 1) / 26)
            name = (char)('A' + (value - 1) % 26) + name;
        return name;
    }

    private static void AddExcelImages(WorksheetPart worksheetPart, List<(LayoutImage Image, uint Row)> images)
    {
        var drawingsPart = worksheetPart.AddNewPart<DrawingsPart>();
        drawingsPart.WorksheetDrawing = new XDR.WorksheetDrawing();
        uint id = 1;

        foreach (var (image, row) in images)
        {
            var imagePart = drawingsPart.AddImagePart(image.IsJpeg ? ImagePartType.Jpeg : ImagePartType.Png);
            using (var imageStream = new MemoryStream(image.Bytes))
                imagePart.FeedData(imageStream);

            var cx = (long)(image.Width * EmuPerPoint);
            var cy = (long)(image.Height * EmuPerPoint);
            drawingsPart.WorksheetDrawing.Append(new XDR.OneCellAnchor(
                new XDR.FromMarker(
                    new XDR.ColumnId("0"), new XDR.ColumnOffset("0"),
                    new XDR.RowId(row.ToString(CultureInfo.InvariantCulture)), new XDR.RowOffset("0")),
                new XDR.Extent { Cx = cx, Cy = cy },
                new XDR.Picture(
                    new XDR.NonVisualPictureProperties(
                        new XDR.NonVisualDrawingProperties { Id = id, Name = $"Image {id}" },
                        new XDR.NonVisualPictureDrawingProperties(new A.PictureLocks { NoChangeAspect = true })),
                    new XDR.BlipFill(new A.Blip { Embed = drawingsPart.GetIdOfPart(imagePart) }, new A.Stretch(new A.FillRectangle())),
                    new XDR.ShapeProperties(
                        new A.Transform2D(new A.Offset { X = 0L, Y = 0L }, new A.Extents { Cx = cx, Cy = cy }),
                        new A.PresetGeometry(new A.AdjustValueList()) { Preset = A.ShapeTypeValues.Rectangle })),
                new XDR.ClientData()));
            id++;
        }

        drawingsPart.WorksheetDrawing.Save();
        worksheetPart.Worksheet.Append(new S.Drawing { Id = worksheetPart.GetIdOfPart(drawingsPart) });
    }

    // ── PowerPoint ───────────────────────────────────────────────────────

    private const string PptHeader = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>";
    private const string PptNamespaces =
        "xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" " +
        "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" " +
        "xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\"";
    private const string PptEmptyTree = "<p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>";
    private const long MinSlideEmu = 914400;
    private const long MaxSlideEmu = 51206400;

    public static byte[] WritePowerPoint(IReadOnlyList<LayoutPage> pages)
    {
        using var stream = new MemoryStream();
        using (var document = PresentationDocument.Create(stream, PresentationDocumentType.Presentation, true))
        {
            var presentationPart = document.AddPresentationPart();
            var layoutPart = AddSlideMaster(presentationPart, out var masterRelationshipId);

            var first = pages.Count > 0 ? pages[0] : null;
            var slideWidth = Math.Clamp((long)((first?.Width ?? 720) * EmuPerPoint), MinSlideEmu, MaxSlideEmu);
            var slideHeight = Math.Clamp((long)((first?.Height ?? 540) * EmuPerPoint), MinSlideEmu, MaxSlideEmu);

            var images = new Dictionary<string, ImagePart>();
            var slideIds = new StringBuilder();
            for (var index = 0; index < pages.Count; index++)
            {
                var slidePart = presentationPart.AddNewPart<SlidePart>();
                slidePart.AddPart(layoutPart);
                WriteSlide(slidePart, pages[index], slideWidth, slideHeight, images);
                slideIds.Append(CultureInfo.InvariantCulture, $"<p:sldId id=\"{256 + index}\" r:id=\"{presentationPart.GetIdOfPart(slidePart)}\"/>");
            }

            FeedXml(presentationPart,
                $"{PptHeader}<p:presentation {PptNamespaces}>" +
                $"<p:sldMasterIdLst><p:sldMasterId id=\"2147483648\" r:id=\"{masterRelationshipId}\"/></p:sldMasterIdLst>" +
                (slideIds.Length > 0 ? $"<p:sldIdLst>{slideIds}</p:sldIdLst>" : string.Empty) +
                $"<p:sldSz cx=\"{slideWidth}\" cy=\"{slideHeight}\"/><p:notesSz cx=\"6858000\" cy=\"9144000\"/></p:presentation>");
        }

        return stream.ToArray();
    }

    private static void WriteSlide(SlidePart slidePart, LayoutPage page, long slideWidth, long slideHeight, Dictionary<string, ImagePart> images)
    {
        var scale = Math.Min(slideWidth / (page.Width * EmuPerPoint), slideHeight / (page.Height * EmuPerPoint));
        var shapes = new StringBuilder();
        var id = 2;

        // Pictures go first so text stays on top of them.
        foreach (var image in page.Blocks.OfType<ImageBlock>())
            AppendSlideImage(shapes, slidePart, image.Image, scale, images, ref id);

        foreach (var block in page.Blocks)
        {
            switch (block)
            {
                case ParagraphBlock paragraph when paragraph.Lines.All(line => line.Segments.Count == 1):
                    AppendTextBox(shapes, paragraph.Left, paragraph.Top, paragraph.Right - paragraph.Left, paragraph.Bottom - paragraph.Top,
                        paragraph.Lines.Select(line => line.Segments[0].Words), wrap: false, scale, ref id);
                    break;

                case ParagraphBlock paragraph:
                    foreach (var segment in paragraph.Lines.SelectMany(line => line.Segments))
                        AppendWordsBox(shapes, segment.Words, scale, ref id);
                    break;

                case TableBlock table:
                    foreach (var cell in table.Rows.SelectMany(row => row).Where(cell => cell.Words.Count > 0))
                        AppendWordsBox(shapes, cell.Words, scale, ref id);
                    break;
            }
        }

        FeedXml(slidePart,
            $"{PptHeader}<p:sld {PptNamespaces}><p:cSld><p:spTree>{PptEmptyTree}{shapes}</p:spTree></p:cSld>" +
            "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>");
    }

    private static void AppendWordsBox(StringBuilder shapes, IReadOnlyList<LayoutWord> words, double scale, ref int id)
    {
        var left = words.Min(word => word.Left);
        var top = words.Min(word => word.Top);
        AppendTextBox(shapes, left, top, words.Max(word => word.Right) - left, words.Max(word => word.Bottom) - top, [words], wrap: false, scale, ref id);
    }

    private static void AppendTextBox(StringBuilder shapes, double left, double top, double width, double height, IEnumerable<IReadOnlyList<LayoutWord>> lines, bool wrap, double scale, ref int id)
    {
        var paragraphs = new StringBuilder();
        foreach (var line in lines)
        {
            paragraphs.Append("<a:p>");
            for (var index = 0; index < line.Count;)
            {
                var style = line[index];
                var text = new StringBuilder();
                for (; index < line.Count && SameRunStyle(style, line[index]); index++)
                    text.Append(text.Length > 0 ? " " : string.Empty).Append(line[index].Text);
                if (index < line.Count)
                    text.Append(' ');
                paragraphs.Append(CreateSlideRun(text.ToString(), style, scale));
            }
            paragraphs.Append("</a:p>");
        }

        shapes.Append(CultureInfo.InvariantCulture,
            $"<p:sp><p:nvSpPr><p:cNvPr id=\"{id}\" name=\"Text {id}\"/><p:cNvSpPr txBox=\"1\"/><p:nvPr/></p:nvSpPr><p:spPr>{SlideTransform(left, top, width, height, scale)}" +
            $"<a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>" +
            $"<p:txBody><a:bodyPr wrap=\"{(wrap ? "square" : "none")}\" lIns=\"0\" tIns=\"0\" rIns=\"0\" bIns=\"0\" rtlCol=\"0\"><a:noAutofit/></a:bodyPr><a:lstStyle/>{paragraphs}</p:txBody></p:sp>");
        id++;
    }

    private static string CreateSlideRun(string text, LayoutWord style, double scale)
    {
        var size = (int)Math.Clamp(Math.Round(style.FontSize * scale * 100), 100, 400000);
        var properties = new StringBuilder();
        if (style.ColorHex is { } color)
            properties.Append(CultureInfo.InvariantCulture, $"<a:solidFill><a:srgbClr val=\"{color}\"/></a:solidFill>");
        if (style.FontName is { } font)
            properties.Append(CultureInfo.InvariantCulture, $"<a:latin typeface=\"{XmlEscape(font)}\"/>");

        return string.Create(CultureInfo.InvariantCulture,
            $"<a:r><a:rPr lang=\"en-US\" sz=\"{size}\" b=\"{(style.Bold ? 1 : 0)}\" i=\"{(style.Italic ? 1 : 0)}\" dirty=\"0\">{properties}</a:rPr><a:t>{XmlEscape(Sanitize(text))}</a:t></a:r>");
    }

    private static void AppendSlideImage(StringBuilder shapes, SlidePart slidePart, LayoutImage image, double scale, Dictionary<string, ImagePart> images, ref int id)
    {
        var key = Convert.ToHexString(SHA256.HashData(image.Bytes));
        string relationshipId;
        if (images.TryGetValue(key, out var existing))
        {
            relationshipId = slidePart.GetIdOfPart(slidePart.AddPart(existing));
        }
        else
        {
            var imagePart = slidePart.AddImagePart(image.IsJpeg ? ImagePartType.Jpeg : ImagePartType.Png);
            using var imageStream = new MemoryStream(image.Bytes);
            imagePart.FeedData(imageStream);
            images[key] = imagePart;
            relationshipId = slidePart.GetIdOfPart(imagePart);
        }

        shapes.Append(CultureInfo.InvariantCulture,
            $"<p:pic><p:nvPicPr><p:cNvPr id=\"{id}\" name=\"Image {id}\"/><p:cNvPicPr><a:picLocks noChangeAspect=\"1\"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>" +
            $"<p:blipFill><a:blip r:embed=\"{relationshipId}\"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>" +
            $"<p:spPr>{SlideTransform(image.Left, image.Top, image.Width, image.Height, scale)}<a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></p:spPr></p:pic>");
        id++;
    }

    private static string SlideTransform(double left, double top, double width, double height, double scale)
    {
        long Emu(double points) => (long)(Math.Max(points, 0) * EmuPerPoint * scale);
        return string.Create(CultureInfo.InvariantCulture,
            $"<a:xfrm><a:off x=\"{Emu(left)}\" y=\"{Emu(top)}\"/><a:ext cx=\"{Math.Max(Emu(width), 1)}\" cy=\"{Math.Max(Emu(height), 1)}\"/></a:xfrm>");
    }

    // PowerPoint needs a master, layout and theme behind every slide or it asks to repair the file.
    private static SlideLayoutPart AddSlideMaster(PresentationPart presentationPart, out string masterRelationshipId)
    {
        var masterPart = presentationPart.AddNewPart<SlideMasterPart>();
        masterRelationshipId = presentationPart.GetIdOfPart(masterPart);
        var layoutPart = masterPart.AddNewPart<SlideLayoutPart>();
        layoutPart.AddPart(masterPart);
        var themePart = masterPart.AddNewPart<ThemePart>();

        FeedXml(themePart, PptTheme);
        FeedXml(layoutPart,
            $"{PptHeader}<p:sldLayout {PptNamespaces} type=\"blank\" preserve=\"1\"><p:cSld name=\"Blank\"><p:spTree>{PptEmptyTree}</p:spTree></p:cSld>" +
            "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>");
        FeedXml(masterPart,
            $"{PptHeader}<p:sldMaster {PptNamespaces}><p:cSld><p:bg><p:bgRef idx=\"1001\"><a:schemeClr val=\"bg1\"/></p:bgRef></p:bg><p:spTree>{PptEmptyTree}</p:spTree></p:cSld>" +
            "<p:clrMap bg1=\"lt1\" tx1=\"dk1\" bg2=\"lt2\" tx2=\"dk2\" accent1=\"accent1\" accent2=\"accent2\" accent3=\"accent3\" accent4=\"accent4\" accent5=\"accent5\" accent6=\"accent6\" hlink=\"hlink\" folHlink=\"folHlink\"/>" +
            $"<p:sldLayoutIdLst><p:sldLayoutId id=\"2147483649\" r:id=\"{masterPart.GetIdOfPart(layoutPart)}\"/></p:sldLayoutIdLst></p:sldMaster>");

        return layoutPart;
    }

    private static readonly string PptTheme = BuildTheme();

    private static string BuildTheme()
    {
        static string Color(string name, string value) => $"<a:{name}><a:srgbClr val=\"{value}\"/></a:{name}>";
        const string font = "<a:latin typeface=\"Arial\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/>";
        const string fill = "<a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill>";
        const string line = "<a:ln w=\"9525\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:ln>";
        const string effect = "<a:effectStyle><a:effectLst/></a:effectStyle>";

        return $"{PptHeader}<a:theme xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" name=\"Office\"><a:themeElements>" +
            "<a:clrScheme name=\"Office\">" +
            Color("dk1", "000000") + Color("lt1", "FFFFFF") + Color("dk2", "44546A") + Color("lt2", "E7E6E6") +
            Color("accent1", "4472C4") + Color("accent2", "ED7D31") + Color("accent3", "A5A5A5") +
            Color("accent4", "FFC000") + Color("accent5", "5B9BD5") + Color("accent6", "70AD47") +
            Color("hlink", "0563C1") + Color("folHlink", "954F72") + "</a:clrScheme>" +
            $"<a:fontScheme name=\"Office\"><a:majorFont>{font}</a:majorFont><a:minorFont>{font}</a:minorFont></a:fontScheme>" +
            $"<a:fmtScheme name=\"Office\"><a:fillStyleLst>{fill}{fill}{fill}</a:fillStyleLst><a:lnStyleLst>{line}{line}{line}</a:lnStyleLst>" +
            $"<a:effectStyleLst>{effect}{effect}{effect}</a:effectStyleLst><a:bgFillStyleLst>{fill}{fill}{fill}</a:bgFillStyleLst></a:fmtScheme>" +
            "</a:themeElements></a:theme>";
    }

    private static void FeedXml(OpenXmlPart part, string xml)
    {
        using var stream = new MemoryStream(Encoding.UTF8.GetBytes(xml));
        part.FeedData(stream);
    }

    // ── Shared ───────────────────────────────────────────────────────────

    // PDF text can contain characters XML doesn't allow, which would make the document unreadable.
    private static string Sanitize(string text)
    {
        var builder = new StringBuilder(text.Length);
        for (var i = 0; i < text.Length; i++)
        {
            if (char.IsHighSurrogate(text[i]) && i + 1 < text.Length && char.IsLowSurrogate(text[i + 1]))
            {
                builder.Append(text[i]).Append(text[++i]);
            }
            else if (text[i] == '\t' || (!char.IsSurrogate(text[i]) && XmlConvert.IsXmlChar(text[i])))
            {
                builder.Append(text[i]);
            }
        }

        return builder.ToString();
    }

    private static string XmlEscape(string text) => SecurityElement.Escape(text) ?? string.Empty;

    [GeneratedRegex(@"^-?(\d{1,3}(,\d{3})+|[1-9]\d*|0)(\.\d+)?$")]
    private static partial Regex PlainNumber();
}
