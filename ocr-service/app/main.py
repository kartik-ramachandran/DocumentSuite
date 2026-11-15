"""HTTP API for the Document Suite OCR service. The .NET API calls it, so the contract matches SidecarOcrEngine.cs."""

from __future__ import annotations

import re

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from .engines import Engines, ModelUnavailable

MAX_IMAGE_BYTES = 60 * 1024 * 1024
MAX_PIXELS = 120_000_000
LANGUAGES = re.compile(r"^[a-z]{3}(_[a-z]{2,6})?(\+[a-z]{3}(_[a-z]{2,6})?){0,4}$")
TABLE_MODELS = {"none", "structure", "vl"}

app = FastAPI(title="Document Suite OCR service", version="1.0.0")
engines = Engines()


@app.get("/health")
def health() -> dict:
    return {"status": "ok", **engines.status()}


@app.post("/v1/ocr")
def ocr(
    image: UploadFile = File(..., description="A PNG or JPEG of one page or region."),
    languages: str = Form("eng", description="Tesseract-style codes joined with +, such as eng+deu."),
    words: bool = Form(True, description="Read the words and where they are, with PP-OCRv5."),
    tables: str = Form("none", description="none, structure (PP-StructureV3) or vl (PaddleOCR-VL)."),
    dpi: int = Form(300, description="The image's resolution. Not needed by the models, but logged."),
) -> dict:
    """Positions are in pixels of the image from the top-left. Confidence is from 0 to 1."""
    languages = languages.strip().lower()
    if not LANGUAGES.match(languages):
        raise HTTPException(400, "languages must be Tesseract-style codes joined with +, such as eng+deu.")
    if tables not in TABLE_MODELS:
        raise HTTPException(400, "tables must be none, structure or vl.")

    data = image.file.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "The image is larger than 60 MB.")
    picture = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if picture is None:
        raise HTTPException(400, "The image couldn't be read. Send a PNG or JPEG.")
    height, width = picture.shape[:2]
    if width * height > MAX_PIXELS:
        raise HTTPException(413, "The image has too many pixels.")

    codes = languages.split("+")
    try:
        engine, found_words = engines.read_words(picture, codes) if words else ("paddle", [])
        found_tables = engines.read_tables(picture, tables, codes, found_words if words else None) if tables != "none" else []
    except ModelUnavailable as error:
        raise HTTPException(503, str(error)) from error

    return {"engine": engine, "width": width, "height": height, "words": found_words, "tables": found_tables}
