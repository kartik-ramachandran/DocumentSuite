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
| [Tesseract](https://github.com/tesseract-ocr/tesseract) and its language data | Apache-2.0 | OCR, page orientation, and the invisible font in searchable PDFs |
| [qpdf](https://github.com/qpdf/qpdf) | Apache-2.0 | PDF optimisation and form flattening |
| [Google Chrome](https://www.google.com/chrome/) | Proprietary (Google's terms) | HTML to PDF |

**If you publish a built image:** you're distributing these programs too. Poppler's GPL then requires you to make its source available, and redistributing Google Chrome is subject to Google's terms. This repository only contains the Dockerfile, which downloads them when someone builds it.

## OCR service (optional, Python)

The image built from `ocr-service/Dockerfile` installs these packages from PyPI. Models download from PaddlePaddle's model hosting the first time each one is used.

| Package or model | License | Used for |
|---|---|---|
| [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) and [PaddleX](https://github.com/PaddlePaddle/PaddleX) | Apache-2.0 | OCR pipelines |
| [PaddlePaddle](https://github.com/PaddlePaddle/Paddle) | Apache-2.0 | Running the models |
| PP-OCRv5, PP-StructureV3 and PaddleOCR-VL models | Apache-2.0 | Words, layout and tables |
| [OpenCV](https://github.com/opencv/opencv) | Apache-2.0 | Reading images |
| [FastAPI](https://github.com/fastapi/fastapi) | MIT | HTTP API |
| [Uvicorn](https://github.com/encode/uvicorn) | BSD-3-Clause | HTTP server |
| [python-multipart](https://github.com/Kludex/python-multipart) | Apache-2.0 | File uploads |

AGPL-licensed OCR tools, such as MinerU, are deliberately not used, and nothing in the image is under the GPL or AGPL. Of the roughly 100 Python packages PaddleOCR brings in, almost all are MIT, BSD or Apache 2.0. A few are weak copyleft, used unchanged as separate packages: `crc32c`, `cssutils`, `encutils` and `python-bidi` (LGPL), and `certifi` and `tqdm` (MPL 2.0). Run `pip-licenses` inside the image to see every dependency of the exact version you build.
