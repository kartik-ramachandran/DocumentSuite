# PDF Suite

Open-source PDF tools you run yourself: a REST API, an MCP server for AI clients, and a viewer and editor you can embed in React, Vue, Angular or plain JavaScript apps.

Everything runs on your own infrastructure, so documents stay with you. The one exception is the optional AI review, which is off by default and sends documents to the Azure OpenAI service you configure.

![The viewer open in a window, with a highlight, a rectangle, a text note and a comment on a sample report](docs/screenshots/viewer-modal.png)

## What it does

### Work with documents through an API

More than 40 routes, which you can call with file uploads or with base64 inside JSON.

- **Convert** between PDF and Word, Excel, PowerPoint, HTML, Markdown, text and images. PDF to Office produces editable documents with real paragraphs and tables, not pictures of pages
- **Edit** by merging, splitting, organizing, rotating, cropping, compressing, watermarking, and adding page numbers or image stamps
- **Read** with OCR for scanned pages, searchable PDFs, and document structure as JSON
- **Protect** with permanent redaction, passwords and metadata removal
- **Fill** PDF forms, and optionally flatten them

### Show and edit documents inside your app

The [viewer](viewer/README.md) gives your users a list of files that open in a window they can move and resize, without leaving your app. A click or right-click on a file opens it or shows its menu.

| | |
|---|---|
| ![A list of files with the right-click menu open on one of them](docs/screenshots/file-list.png) | ![The side panel showing the document tools, with the Watermark tool open](docs/screenshots/document-tools.png) |
| **A file list** with a right-click menu | **Document tools** that call the API |
| ![A photo in the viewer, with image rotate and flip buttons in the toolbar](docs/screenshots/image-viewer.png) | ![A Word document open in the viewer](docs/screenshots/word-document.png) |
| **Images** open automatically, with the same annotation tools | **Word, Excel and PowerPoint files** open through the API |

- **Annotate** with highlights, drawing, text, comments, pictures and signatures, all saved into the PDF
- **Fill in forms** right on the page
- **Keep documents on the device** by rendering in the browser, or render on your server instead
- **Download** with the name the file was uploaded with, and optionally ask for a new one first

### Control it all from one set of settings

What a click does, where the toolbar sits, whether a watermark appears, which features are on: all of it is a setting. Set them in code, or give people the ready-made settings screen. Choices can be remembered in the browser or [saved on your server](viewer/README.md#saving-settings-on-the-server), for each app, team or user.

| | |
|---|---|
| ![The settings screen, with groups for the file list, viewer window, downloads, viewer, editing and watermark](docs/screenshots/settings-panel.png) | ![The settings screen in dark mode](docs/screenshots/settings-panel-dark.png) |
| ![A report with CONFIDENTIAL written diagonally across the page](docs/screenshots/watermark.png) | ![The viewer with its toolbar down the left side](docs/screenshots/toolbar-left.png) |
| **A watermark**, on screen and in prints and downloads | **The toolbar** on any side of the viewer |

### Use it from AI clients

The [MCP server](#mcp-server) gives AI clients six tools for working with documents. Files stay in a workspace folder and are referred to by name, so documents don't pass through the model or use up its tokens.

## Quick start

You need Docker.

```bash
git clone https://github.com/kartik-ramachandran/PDF.git
cd PDF
docker compose up -d --build
```

Open http://localhost:8080/swagger to try the API, or convert a file straight away:

```bash
curl -o report.pdf -F "files=@report.docx" http://localhost:8080/api/pdf/word-to-pdf
```

To try the viewer, keep that running and start a demo. You'll need Node.js too.

```bash
cd viewer
npm install
npm run build
npm run build:examples
npm run preview -w example-react
```

Then open http://localhost:5173. The list has sample files to click on, and **Settings** above it lets you try every option. There are also `example-vue` and `example-angular` demos.

> **Don't expose this to the internet as it stands.** The REST API has no login or rate limits. Read [SECURITY.md](SECURITY.md) before deploying it.

## Project status

This is an early release, at version 0.1.0.

- **The viewer packages aren't on npm yet.** To use them now, build them from this repository, as [CONTRIBUTING.md](CONTRIBUTING.md) describes
- **The API needs protecting.** Put it behind your own gateway for login and rate limits
- **Viewer settings shape the interface, and aren't security controls.** Turning off downloads or adding a watermark happens in the browser, so protect sensitive documents on your server

## What's here

| Path | Contents |
|---|---|
| [`backend`](backend) | The REST API and MCP server (ASP.NET Core, .NET 10) |
| [`viewer`](viewer/README.md) | The viewer and editor for React, Vue, Angular and plain JavaScript |
| [`viewer/examples`](viewer/examples) | Demos for React, Vue and Angular |
| [`docs/screenshots`](docs/screenshots) | The screenshots above, which only show generated sample files |

Contributions are welcome, so please see [CONTRIBUTING.md](CONTRIBUTING.md). This project is under the [MIT License](LICENSE), and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) lists what it relies on.

## Architecture

- **PdfProcessingService** — deterministic PDF operations (merge, split, compress, rotate, watermark, protect, unlock, page numbers, repair, and conversions)
- **DocumentConversionService** — converts between PDF and Word/Excel/PowerPoint/HTML/Markdown/Text/Images
- **PdfLayoutService / PdfLayoutAnalyzer** — read each page's text and images, run OCR on scanned pages, and rebuild reading order, paragraphs and tables
- **EditableDocumentWriter** — writes that layout as editable DOCX, XLSX and PPTX
- **PdfCompressionService** — re-encodes images and optimises PDF structure
- **PdfToolkitService** — page organising, searchable PDFs, redaction, metadata, image extraction, stamps, cropping and forms
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
| POST | `/api/pdf/rotate` | Rotate pages by `degrees` (multiples of 90). Optional `pages`, default all |
| POST | `/api/pdf/watermark` | Stamp a diagonal text watermark on every page. Optional `opacity` (above 0, up to 1) and `fontSize` |
| POST | `/api/pdf/page-numbers` | Add `n / total` to every page. Optional `position` (`top-left` to `bottom-right`, default `bottom-center`) and `startAt` |
| POST | `/api/pdf/organize` | Reorder pages. `pages` lists them in output order, such as `3,1,5-8`. Pages not listed are dropped |
| POST | `/api/pdf/remove-pages` | Delete the listed `pages` |
| POST | `/api/pdf/split/ranges` | Split into several PDFs, returned as a ZIP. Use `ranges` (`1-3,4,5-9`) or `everyPages` |
| POST | `/api/pdf/searchable` | Add selectable, searchable text to scanned pages with OCR. `X-Ocr-Page-Count` reports how many pages changed |
| POST | `/api/pdf/redact` | Permanently remove text. Send one or more `terms`, optional `matchCase`. Matching pages become pictures with black boxes. Returns 422 if nothing matched |
| POST | `/api/pdf/metadata` | Read title, author, subject, keywords, dates and page count |
| POST | `/api/pdf/metadata/update` | Set `title`, `author`, `subject` or `keywords`. `clear=true` removes existing metadata first |
| POST | `/api/pdf/extract-images` | Original embedded pictures, without duplicates, as a ZIP |
| POST | `/api/pdf/stamp-image` | Draw an `image`, such as a logo or a picture of a signature, at `x`, `y`, `width` in points from the top-left. Optional `pages` |
| POST | `/api/pdf/crop` | Trim `left`, `right`, `top`, `bottom` margins in points. Optional `pages`. The trimmed content stays in the file, so use redact for secrets |
| POST | `/api/pdf/forms` | List form fields with their types and values |
| POST | `/api/pdf/forms/fill` | Fill fields from `values`, a JSON object such as `{"name":"Ada","agree":"true"}`. `flatten=true` makes the values permanent |
| POST | `/api/pdf/repair` | Re-write corrupt or malformed PDF |
| POST | `/api/pdf/unlock` | Remove password protection |
| POST | `/api/pdf/protect` | Add user and owner passwords |
| POST | `/api/pdf/ocr` | Full document text as plain text. Pages with no text layer, such as scans, are read with OCR (requires Tesseract) |

### Conversions — PDF out

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/pdf/pdf-to-word` | PDF → editable DOCX with paragraphs, tables, text styling and pictures |
| POST | `/api/pdf/pdf-to-excel` | PDF → XLSX with one sheet per page and tables split into cells. Plain numbers become numeric cells |
| POST | `/api/pdf/pdf-to-powerpoint` | PDF → PPTX with one slide per page and editable, positioned text boxes |
| POST | `/api/pdf/pdf-to-images` | PDF → JPG or PNG. One page returns an image, several return a ZIP. Optional `dpi` from 36 to 600, default 150 (requires Poppler) |
| POST | `/api/pdf/pdf-to-html` | PDF → self-contained HTML with embedded page images |
| POST | `/api/pdf/pdf-to-markdown` | PDF → Markdown with embedded page images |
| POST | `/api/pdf/pdf-to-text` | PDF → plain text (requires Poppler `pdftotext`) |

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
| POST | `/api/pdf/any-to-pdf` | Any supported file → PDF, based on its file name |

### Analysis

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/pdf/compare` | Text diff + visual pixel comparison of two PDFs |
| POST | `/api/pdf/validate` | Validate an operation outcome against original and output files |
| POST | `/api/pdf/review` | AI document review — **disabled by default**, see below |

Results are named after the uploaded file, so `report.docx` comes back as `report.pdf`. Combining several files returns `merged.pdf`.

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
  http://localhost:8080/api/pdf/pdf-to-word
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

## JSON API

Every route under `/api/pdf` also works with JSON at `/api/json`, so a client can send documents without building multipart forms. For example, `/api/pdf/word-to-pdf` becomes `/api/json/word-to-pdf`.

Send files as base64 under the same field name the normal route uses. Single files go in an object and several go in an array. `data` can also be a `data:` URL. Other properties become ordinary options.

```bash
curl http://localhost:8080/api/json/word-to-pdf \
  -H "Content-Type: application/json" \
  -d '{"files":[{"name":"report.docx","data":"UEsDBBQ..."}]}'
```

```bash
curl http://localhost:8080/api/json/rotate \
  -H "Content-Type: application/json" \
  -d '{"file":{"name":"report.pdf","data":"JVBERi0..."},"degrees":90}'
```

A file result comes back as:

```json
{ "fileName": "converted.pdf", "contentType": "application/pdf", "bytes": 7267, "data": "JVBERi0..." }
```

Routes that already return JSON, and all errors, come back unchanged. Base64 makes requests and responses about a third larger than the file. The 100 MB limit applies to the decoded files.

### Document contents as JSON

`POST /api/pdf/any-to-json`, or `/api/json/any-to-json`, returns a document's structure. It accepts PDF, Word, Excel, PowerPoint, HTML, Markdown, text and image files. Positions and sizes are in points from the top-left of the page. Set `includeImages` to include picture data as base64.

```json
{
  "pageCount": 1,
  "pages": [{
    "number": 1, "width": 612, "height": 792, "ocr": false,
    "blocks": [
      { "type": "paragraph", "text": "Annual Report", "left": 72, "top": 60, "fontSize": 24, "bold": true },
      { "type": "table", "left": 72, "top": 120, "columnWidths": [120, 80], "rows": [["Region", "Units"], ["North", "1,250"]] },
      { "type": "image", "left": 72, "top": 220, "width": 180, "height": 120, "contentType": "image/png", "bytes": 5120 }
    ]
  }]
}
```

Reading is one way for now: this JSON can't be turned back into a document.

## Viewer Server Mode

These routes support the viewer's server mode. Uploaded documents are temporary: they're deleted after 30 idle minutes, when 200 are stored, or when the app stops. Change this with `Viewer:DocumentLifetimeMinutes` and `Viewer:MaxDocuments`. A document's long random ID is the only thing protecting it.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/pdf/viewer/documents` | Store a document and return its `id`, `pageCount` and page sizes. Non-PDF files are converted first |
| GET | `/api/pdf/viewer/documents/{id}/pages/{page}?dpi=96` | A page as a PNG. `dpi` is 36 to 300 |
| GET | `/api/pdf/viewer/documents/{id}/pages/{page}/text` | The page's words and positions, using OCR on scanned pages |
| GET | `/api/pdf/viewer/documents/{id}/file` | The stored PDF |
| DELETE | `/api/pdf/viewer/documents/{id}` | Delete it now |

## Viewer Settings

These routes keep the viewer's [settings](viewer/README.md#saving-settings-on-the-server) on the server. A `scope` can be an app, a team or a user. It can contain letters, numbers, hyphens and underscores, up to 64 characters.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/settings/{scope}` | The saved settings, or `{}` if there are none |
| PUT | `/api/settings/{scope}` | Replace them with a flat JSON object, up to 64 KB |
| DELETE | `/api/settings/{scope}` | Delete them |

Reading is open. Changing them needs `Authorization: Bearer <key>` once `Settings__WriteKey` is set, which you can do with `SETTINGS_WRITE_KEY` when using Docker Compose. With no key, development instances accept changes and every other environment refuses them. The API checks who may change settings, not whose they are, so to give each user their own scope, enforce that at your gateway.

Settings are stored as files in `Settings__Path`, which Docker Compose keeps in the `viewer-settings` volume.

## MCP Server

AI clients can use the service through the [Model Context Protocol](https://modelcontextprotocol.io). The tools are built to save tokens:

- **Documents never pass through the model.** Tools take file paths and write results to files.
- **Results are short summaries**, such as `{"output":"report.docx","bytes":50814}`.
- **There are only six tools**, so they add little to every request.

| Tool | Purpose |
|------|---------|
| `pdf_info` | Page count, size, encryption, title, author, form field count and whether a PDF has a text layer |
| `pdf_convert` | PDF to docx, xlsx, pptx, txt, html, md, jpg or png |
| `pdf_create` | Combine pdf, Office, html, md, txt and image files into one PDF |
| `pdf_edit` | Compress, organize, remove pages, split into files, rotate, watermark, add page numbers, redact, make searchable, extract images, clear metadata, repair, protect or unlock |
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

- Redaction doesn't detect text inside pictures on pages that have a normal text layer, so check those pages by eye. Stamps are visual only, not cryptographic signatures
- Upload limit is 100 MB per request
- Office → PDF conversions use LibreOffice, or COM automation when the matching Office app is installed on Windows
- PDF → Word, Excel and PowerPoint rebuild the document, so complex layouts won't match exactly. Charts drawn as vector graphics are kept as pictures. OCR is English only
- Visual comparison previews are capped at 12 pages; pages beyond that are text-diffed only
