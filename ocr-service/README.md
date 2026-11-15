# Document Suite OCR service

An optional service that gives the Document Suite API more accurate OCR and table recognition, using [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR). Everything in it is under the Apache 2.0, MIT or BSD licence. AGPL-licensed tools such as MinerU are deliberately left out.

The API works without this service, using Tesseract. Add it when you have noisy scans, photos of documents, Chinese, Japanese or Korean text, or tables that come out wrong.

| What | Model | Hardware |
|---|---|---|
| Words and their positions | PP-OCR (v6 for English, Chinese and Japanese, v5 for other scripts) | CPU or GPU |
| Tables (`tables=structure`) | PP-StructureV3 | CPU or GPU |
| Tables (`tables=vl`) | PaddleOCR-VL, a 0.9-billion-parameter vision-language model | NVIDIA GPU |

## Run it

With the rest of Document Suite, from the repository root:

```bash
# CPU
OCR_ENGINE=paddle OCR_TABLES=structure docker compose --profile ocr up

# NVIDIA GPU, which also allows tables=vl
OCR_ENGINE=paddle OCR_TABLES=vl OCR_SERVICE_URL=http://ocr-gpu:8000/ docker compose --profile gpu up
```

On its own:

```bash
docker build -t document-suite-ocr ocr-service
docker run -p 8000:8000 -v ocr-models:/home/ocr/.paddlex document-suite-ocr
```

Then point the API at it with `Ocr:ServiceUrl` (`http://localhost:8000/`) and set `Ocr:Engine` to `paddle`. See [OCR in the main README](../README.md#ocr) for the API's settings.

Models download the first time each one is used, about 130 MB for English words and 1.2 GB with PP-StructureV3, so keep the `/home/ocr/.paddlex` volume between restarts. The first request after a start is slow while the models load.

## Speed

Measured on a 32-core CPU, once the models have loaded, for one noisy, tilted, letter-size scan through the API's `/api/pdf/ocr` route (rendering, turning and straightening included):

| Engine | Time | Result on that scan |
|---|---|---|
| Tesseract | 7 to 11 seconds | Text right, two table cells misread |
| PaddleOCR | about 9 seconds | Everything right |
| PaddleOCR with PP-StructureV3 tables | about 21 seconds | Everything right, table structure from the model |

The first request after a start takes much longer while the models download and load. Pages are read in parallel, so a long document takes less than this per page. A GPU is much faster, and needed for PaddleOCR-VL.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `OCR_ONEDNN` | `true` | Use oneDNN on the CPU, which makes OCR about ten times faster. Set to `false` if a PaddlePaddle version crashes with it |
| `OCR_ALLOW_VL_ON_CPU` | `false` | Allow PaddleOCR-VL without a GPU. It works, but takes minutes per page |
| `OCR_VL_SERVER_URL` | | Send PaddleOCR-VL's model to a separate vLLM or SGLang server, for higher throughput |
| `OCR_VL_BACKEND` | `vllm-server` | The kind of server at `OCR_VL_SERVER_URL` |

PaddlePaddle is pinned to 3.2.2, because 3.3's oneDNN CPU kernels fail on the current PP-OCR models.

## API

`GET /health` reports whether the service is up and which table models can run here.

`POST /v1/ocr` takes a multipart form:

| Field | Default | Meaning |
|---|---|---|
| `image` | required | A PNG or JPEG of one page or region, up to 60 MB |
| `languages` | `eng` | Tesseract codes joined with `+`, such as `eng+deu`. PaddleOCR reads one script at a time, so the first Asian or non-English script wins |
| `words` | `true` | Read the words and their positions |
| `tables` | `none` | `none`, `structure` or `vl` |

It returns positions in pixels from the top-left of the image, and confidence from 0 to 1:

```json
{
  "engine": "paddle-ppocr-en",
  "width": 2550, "height": 3300,
  "words": [{ "text": "Total", "left": 300, "top": 812, "width": 140, "height": 52, "confidence": 0.998, "line": 4 }],
  "tables": [{ "left": 298, "top": 791, "width": 1924, "height": 726, "rows": [["Item", "Amount"], ["Rent", "1,200.00"]] }]
}
```

A model that can't run here, such as `tables=vl` without a GPU, returns `503` with a `detail` message. The API then carries on without that model and says so, unless the request asked for it by name.

If PP-StructureV3 finds a table's cells but reads no text in them, which happens on some pages, the cells are filled from the words PP-OCR read inside each cell. The API checks every table against the words in the same area either way, so text a model made up is flagged rather than passed on.

## Tests

The table parsing tests need only Python and pytest, not PaddleOCR:

```bash
cd ocr-service
pip install pytest
python -m pytest tests
```
