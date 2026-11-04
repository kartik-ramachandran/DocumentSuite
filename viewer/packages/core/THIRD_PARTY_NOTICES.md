# Third-Party Notices

This project's own code is under the [MIT License](LICENSE). It relies on the projects below, which keep their own licenses. Check the license of the exact version you distribute.

## Viewer (npm)

| Package | License | Used for |
|---|---|---|
| [pdfjs-dist](https://github.com/mozilla/pdf.js) | Apache-2.0 | Rendering PDFs in the browser |
| [pdf-lib](https://github.com/Hopding/pdf-lib) | MIT | Writing annotations into PDFs |
| [Viewer.js](https://github.com/fengyuanchen/viewerjs) | MIT | Viewing images |

## API (NuGet)

| Package | License | Used for |
|---|---|---|
| [PDFsharp](https://github.com/empira/PDFsharp) | MIT | Editing PDFs |
| [PdfPig](https://github.com/UglyToad/PdfPig) | Apache-2.0 | Reading PDF text and images |
| [DocumentFormat.OpenXml](https://github.com/dotnet/Open-XML-SDK) | MIT | Writing Word, Excel and PowerPoint files |
| [SkiaSharp](https://github.com/mono/SkiaSharp) | MIT | Image processing |
| [Markdig](https://github.com/xoofx/markdig) | BSD-2-Clause | Markdown |
| [Azure.AI.OpenAI](https://github.com/Azure/azure-sdk-for-net) | MIT | Optional AI review |
| [Swashbuckle.AspNetCore](https://github.com/domaindrivendev/Swashbuckle.AspNetCore) | MIT | Swagger UI |
| [ModelContextProtocol.AspNetCore](https://github.com/modelcontextprotocol/csharp-sdk) | Apache-2.0 | MCP server |

## Tools in the Docker image

The image built from `backend/Dockerfile` installs these separate programs, and the API runs them as external processes.

| Program | License | Used for |
|---|---|---|
| [Poppler](https://poppler.freedesktop.org) | GPL-2.0-or-later | Rendering PDF pages |
| [LibreOffice](https://www.libreoffice.org) | MPL-2.0 | Office to PDF |
| [Tesseract](https://github.com/tesseract-ocr/tesseract) | Apache-2.0 | OCR |
| [qpdf](https://github.com/qpdf/qpdf) | Apache-2.0 | PDF optimisation and form flattening |
| [Google Chrome](https://www.google.com/chrome/) | Proprietary (Google's terms) | HTML to PDF |

**If you publish a built image:** you're distributing these programs too. Poppler's GPL then requires you to make its source available, and redistributing Google Chrome is subject to Google's terms. This repository only contains the Dockerfile, which downloads them when someone builds it.
