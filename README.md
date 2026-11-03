# PDF Processing API

A self-contained REST API and MCP server for PDF processing. It covers merging, splitting, compressing, converting, comparing, and generating PDFs. AI-assisted document review via Azure OpenAI is included but off by default and can be switched on in appsettings.

## Architecture

- **PdfProcessingService** — deterministic PDF operations (merge, split, compress, rotate, watermark, protect, unlock, page numbers, repair, and conversions)
- **DocumentConversionService** — converts between PDF and Word/Excel/PowerPoint/HTML/Markdown/Text/Images
- **PdfLayoutService / PdfLayoutAnalyzer** — read each page's text and images, run OCR on scanned pages, and rebuild reading order, paragraphs and tables
- **EditableDocumentWriter** — writes that layout as editable DOCX, XLSX and PPTX
- **PdfCompressionService** — re-encodes images and optimises PDF structure
- **PdfToolRunner** — runs Poppler, Tesseract and qpdf with timeouts and cancellation
- **PdfCompareService** — text diff and visual pixel comparison via PdfPig and SkiaSharp
- **ValidationAgentService** — outcome validation against original files, output, options, and warnings
- **AiReviewService** — optional AI review via Azure OpenAI (feature flagged)

## Technology Stack

- ASP.NET Core Web API (.NET 10)
- PDFsharp — PDF manipulation, passwords, watermarks, page numbers
- PdfPig — text extraction and image hashing
- DocumentFormat.OpenXml — DOCX/XLSX/PPTX generation and reading
- SkiaSharp — visual page diff rendering
- Poppler (`pdftoppm`, `pdftotext`) — PDF page rendering and text extraction
- Tesseract — OCR for scanned pages
- qpdf — structural PDF optimisation
- Azure.AI.OpenAI — optional AI review (disabled by default)

## API Endpoints

All endpoints accept `multipart/form-data` unless noted.

### PDF Operations

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/pdf/merge` | Merge multiple PDFs into one |
| POST | `/api/pdf/split` | Extract specific pages (e.g. `pages=1,3,5-8`) |
| POST | `/api/pdf/split/inspect` | Return page count + JPEG previews of all pages |
| POST | `/api/pdf/compress` | Shrink images and optimise structure. `quality` is `less`, `recommended` (default) or `extreme`. Never returns a larger file |
| POST | `/api/pdf/rotate` | Rotate all pages by `degrees` (multiples of 90) |
| POST | `/api/pdf/watermark` | Stamp diagonal text watermark on every page |
| POST | `/api/pdf/page-numbers` | Add `n / total` footer to every page |
| POST | `/api/pdf/repair` | Re-write corrupt or malformed PDF |
| POST | `/api/pdf/unlock` | Remove password protection |
| POST | `/api/pdf/protect` | Add user and owner passwords |
| POST | `/api/pdf/ocr` | Full document text as plain text. Pages with no text layer, such as scans, are read with OCR (requires Tesseract) |

### Conversions — PDF out

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/pdf/convert/word` | PDF → editable DOCX with paragraphs, tables, text styling and pictures |
| POST | `/api/pdf/convert/excel` | PDF → XLSX with one sheet per page and tables split into cells. Plain numbers become numeric cells |
| POST | `/api/pdf/convert/powerpoint` | PDF → PPTX with one slide per page and editable, positioned text boxes |
| POST | `/api/pdf/convert/images` | PDF → JPG or PNG. One page returns an image, several return a ZIP. Optional `dpi` from 36 to 600, default 150 (requires Poppler) |
| POST | `/api/pdf/convert/html` | PDF → self-contained HTML with embedded page images |
| POST | `/api/pdf/convert/markdown` | PDF → Markdown with embedded page images |
| POST | `/api/pdf/convert/text` | PDF → plain text (requires Poppler `pdftotext`) |

### Conversions — PDF in

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/pdf/word-to-pdf` | DOCX/DOC → PDF (LibreOffice, or Microsoft Word on Windows) |
| POST | `/api/pdf/excel-to-pdf` | XLSX/XLS → PDF (LibreOffice, or Microsoft Excel on Windows) |
| POST | `/api/pdf/powerpoint-to-pdf` | PPTX/PPT → PDF (LibreOffice, or Microsoft PowerPoint on Windows) |
| POST | `/api/pdf/html-to-pdf` | HTML → PDF (uses headless Chrome/Edge) |
| POST | `/api/pdf/markdown-to-pdf` | Markdown → PDF |
| POST | `/api/pdf/text-to-pdf` | Plain text → PDF |
| POST | `/api/pdf/images-to-pdf` | JPG/PNG images → PDF |

### Analysis

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/pdf/compare` | Text diff + visual pixel comparison of two PDFs |
| POST | `/api/pdf/validate` | Validate an operation outcome against original and output files |
| POST | `/api/pdf/review` | AI document review — **disabled by default**, see below |

Swagger UI is available at `/swagger` when the API is running.

## Calling the API

The examples below use a local Docker instance (`docker compose up -d --build`):

```
http://localhost:8080
```

All file endpoints accept `multipart/form-data`. Endpoints that take several files (merge and everything that converts to PDF) use a field named `files`. Endpoints that take one PDF use a field named `file`.

### curl

**Word → PDF**
```bash
curl -o converted.pdf \
  -F "files=@document.docx;type=application/vnd.openxmlformats-officedocument.wordprocessingml.document" \
  http://localhost:8080/api/pdf/word-to-pdf
```

**Excel → PDF**
```bash
curl -o converted.pdf \
  -F "files=@spreadsheet.xlsx;type=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" \
  http://localhost:8080/api/pdf/excel-to-pdf
```

**PowerPoint → PDF**
```bash
curl -o converted.pdf \
  -F "files=@deck.pptx;type=application/vnd.openxmlformats-officedocument.presentationml.presentation" \
  http://localhost:8080/api/pdf/powerpoint-to-pdf
```

**PDF → Word**
```bash
curl -o converted.docx \
  -F "file=@document.pdf;type=application/pdf" \
  http://localhost:8080/api/pdf/convert/word
```

**Merge PDFs**
```bash
curl -o merged.pdf \
  -F "files=@first.pdf;type=application/pdf" \
  -F "files=@second.pdf;type=application/pdf" \
  http://localhost:8080/api/pdf/merge
```

**Markdown → PDF**
```bash
curl -o converted.pdf \
  -F "files=@readme.md;type=text/markdown" \
  http://localhost:8080/api/pdf/markdown-to-pdf
```

**HTML → PDF**
```bash
curl -o converted.pdf \
  -F "files=@page.html;type=text/html" \
  http://localhost:8080/api/pdf/html-to-pdf
```

**Watermark**
```bash
curl -o watermarked.pdf \
  -F "file=@document.pdf;type=application/pdf" \
  -F "text=CONFIDENTIAL" \
  http://localhost:8080/api/pdf/watermark
```

**Split — extract specific pages**
```bash
curl -o pages.pdf \
  -F "file=@document.pdf;type=application/pdf" \
  -F "pages=1,3,5-8" \
  http://localhost:8080/api/pdf/split
```

### PowerShell (Windows)

On Windows, use `curl.exe` (the native binary, not the PowerShell alias) to send multipart form data:

```powershell
curl.exe -o converted.pdf `
  -F "files=@`"C:\path\to\document.docx`";type=application/vnd.openxmlformats-officedocument.wordprocessingml.document" `
  http://localhost:8080/api/pdf/word-to-pdf
```

Note the escaped inner quotes around the path — required when the file path contains spaces.

### C# / HttpClient

```csharp
using var http = new HttpClient();
await using var stream = File.OpenRead("document.docx");

var form = new MultipartFormDataContent();
form.Add(new StreamContent(stream), "files", "document.docx");

var response = await http.PostAsync(
    "http://localhost:8080/api/pdf/word-to-pdf",
    form);

response.EnsureSuccessStatusCode();
await File.WriteAllBytesAsync("converted.pdf", await response.Content.ReadAsByteArrayAsync());
```

### Python

```python
import requests

with open("document.docx", "rb") as f:
    response = requests.post(
        "http://localhost:8080/api/pdf/word-to-pdf",
        files={"files": ("document.docx", f, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    )

response.raise_for_status()
with open("converted.pdf", "wb") as out:
    out.write(response.content)
```

### JavaScript / fetch

```js
const form = new FormData();
form.append("files", fileInput.files[0]);

const res = await fetch(
  "http://localhost:8080/api/pdf/word-to-pdf",
  { method: "POST", body: form }
);
const blob = await res.blob();
const url = URL.createObjectURL(blob);
```

## MCP Server

AI clients can use the service through the [Model Context Protocol](https://modelcontextprotocol.io). The tools are built to save tokens:

- **Documents never pass through the model.** Tools take file paths and write results to files.
- **Results are short summaries**, such as `{"output":"report.docx","bytes":50814}`.
- **There are only six tools**, so they add little to every request.

| Tool | Purpose |
|------|---------|
| `pdf_info` | Page count, size, encryption and whether a PDF has a text layer |
| `pdf_convert` | PDF to docx, xlsx, pptx, txt, html, md, jpg or png |
| `pdf_create` | Combine pdf, Office, html, md, txt and image files into one PDF |
| `pdf_edit` | Compress, split, rotate, watermark, add page numbers, repair, protect or unlock |
| `pdf_text` | Save the full text to a file, using OCR on scanned pages. `preview_chars` returns some of it inline |
| `pdf_compare` | Return change counts and save the full report as JSON |

All paths are relative to one workspace folder. Tools can't read or write outside it, can't follow symbolic links, and never overwrite a file: a new result gets a numeric suffix.

### Run it locally (one user)

The client starts the server as a process and talks to it over standard input and output. No API key is needed.

```bash
docker build -t pdf-service backend
```

```json
{
  "mcpServers": {
    "pdf": {
      "command": "docker",
      "args": ["run", "-i", "--rm",
               "-v", "/path/to/your/documents:/workspace",
               "-e", "Mcp__WorkspaceRoot=/workspace",
               "pdf-service", "--mcp-stdio"]
    }
  }
}
```

### Host it for a team

The `/mcp` endpoint only exists once an API key is set. Put a long random key in a `.env` file next to `docker-compose.yml`:

```
MCP_API_KEY=your-long-random-key
```

Start the service with `docker compose up -d --build`, put documents in the `workspace` folder, and connect clients with:

```json
{
  "mcpServers": {
    "pdf": {
      "type": "http",
      "url": "https://your-server/mcp",
      "headers": { "Authorization": "Bearer your-long-random-key" }
    }
  }
}
```

Everyone who has the key shares one workspace folder, so they can read each other's files. Use HTTPS for anything other than local testing.

## Setup

### Prerequisites

- .NET 10 SDK
- Poppler — required for PDF → image, text, HTML and Markdown, and for scanned pages
- Tesseract — required to read scanned pages
- qpdf — optional, improves compression
- LibreOffice or Microsoft Office — required for Word/Excel/PowerPoint → PDF
- Chrome or Edge — required for HTML → PDF

The Docker image includes all of these except Microsoft Office.

### Run

```bash
cd backend/PdfAI.API
dotnet restore
dotnet run
```

### Poppler (Windows)

Install via WinGet:

```
winget install oschwartz10612.Poppler
```

Then set the path in `appsettings.json`:

```json
{
  "Tools": {
    "Poppler": {
      "PdfToPpmPath": "C:\\path\\to\\poppler\\bin\\pdftoppm.exe",
      "PdfToTextPath": ""
    }
  }
}
```

If `PdfToTextPath` is empty, it defaults to the sibling `pdftotext.exe` next to `pdftoppm.exe`.

## AI Review (Feature Flag)

The `/api/pdf/review` endpoint is off by default. To enable it:

1. Set `Features:AiReview` to `true` in `appsettings.json`
2. Fill in your Azure OpenAI credentials

```json
{
  "Features": {
    "AiReview": true
  },
  "AzureOpenAI": {
    "Endpoint": "https://your-resource.openai.azure.com/",
    "ApiKey": "your-api-key",
    "DeploymentName": "gpt-4o"
  }
}
```

When enabled, the endpoint extracts text from the PDF, sends it to Azure OpenAI, and returns:

```json
{
  "summary": "...",
  "keyPoints": ["..."],
  "issues": ["..."],
  "sentiment": "...",
  "model": "gpt-4o"
}
```

When disabled, the endpoint returns `503` with an explanatory message.

## Notes

- The REST API has no authentication — intended for internal/trusted use only
- CORS is open (`AllowAnyOrigin`) — lock this down before exposing externally
- Upload limit is 100 MB per request
- Office → PDF conversions use LibreOffice, or COM automation when the matching Office app is installed on Windows
- PDF → Word, Excel and PowerPoint rebuild the document, so complex layouts won't match exactly. Charts drawn as vector graphics are kept as pictures. OCR is English only
- Visual comparison previews are capped at 12 pages; pages beyond that are text-diffed only
