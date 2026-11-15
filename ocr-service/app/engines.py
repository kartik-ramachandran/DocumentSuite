"""PaddleOCR pipelines: PP-OCR for words, PP-StructureV3 and PaddleOCR-VL for tables. All Apache 2.0."""

from __future__ import annotations

import logging
import os
import threading
from typing import Any

import numpy as np

from .tables import grid_from_cells, is_empty, parse_table

log = logging.getLogger("ocr")

# Tesseract codes to PaddleOCR languages. Languages that share a script share PaddleOCR's model for that script.
PADDLE_LANGUAGES = {
    "eng": "en",
    "chi_sim": "ch",
    "chi_tra": "chinese_cht",
    "jpn": "japan",
    "kor": "korean",
    "ara": "ar",
    "fas": "fa",
    "urd": "ur",
    "rus": "ru",
    "ukr": "uk",
    "bel": "be",
    "bul": "bg",
    "srp": "rs_cyrillic",
    "hin": "hi",
    "mar": "mr",
    "nep": "ne",
    "tha": "th",
    "ell": "el",
    "tam": "ta",
    "tel": "te",
    "deu": "de",
    "fra": "fr",
    "spa": "es",
    "ita": "it",
    "por": "pt",
    "nld": "nl",
    "swe": "sv",
    "dan": "da",
    "nor": "no",
    "fin": "fi",
    "pol": "pl",
    "ces": "cs",
    "slk": "sk",
    "hun": "hu",
    "ron": "ro",
    "hrv": "hr",
    "slv": "sl",
    "tur": "tr",
    "vie": "vi",
    "ind": "id",
    "msa": "ms",
    "lat": "la",
}

# Asian scripts come first, since their models also read English.
PRIORITY = ["ch", "chinese_cht", "japan", "korean"]


class ModelUnavailable(Exception):
    """The model can't run here, such as PaddleOCR-VL without a GPU."""


def paddle_language(codes: list[str]) -> str:
    """Picks one PaddleOCR language for a list of Tesseract codes, since PaddleOCR reads one script at a time."""
    languages = [PADDLE_LANGUAGES.get(code, "") for code in codes]
    for preferred in PRIORITY:
        if preferred in languages:
            return preferred
    others = [language for language in languages if language and language != "en"]
    if others:
        return others[0]
    return "en"


class Engines:
    """Loads each pipeline on first use and keeps it. Pipelines aren't thread-safe, so each has a lock."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._ocr: dict[str, Any] = {}
        self._ocr_locks: dict[str, threading.Lock] = {}
        self._structure: Any = None
        self._structure_lock = threading.Lock()
        self._vl: Any = None
        self._vl_lock = threading.Lock()
        self.device = _device()
        self.allow_vl_on_cpu = _flag("OCR_ALLOW_VL_ON_CPU", False)
        # oneDNN makes the CPU models about ten times faster. Turn it off if a PaddlePaddle version can't run it.
        self.options: dict[str, Any] = {"enable_mkldnn": _flag("OCR_ONEDNN", True)} if self.device == "cpu" else {}

    def status(self) -> dict:
        return {
            "device": self.device,
            "words": "PP-OCR",
            "tables": {"structure": True, "vl": self.device == "gpu" or self.allow_vl_on_cpu},
        }

    # ── Words ────────────────────────────────────────────────────────

    def read_words(self, image: np.ndarray, codes: list[str]) -> tuple[str, list[dict]]:
        language = paddle_language(codes)
        pipeline, lock = self._ocr_pipeline(language)
        with lock:
            results = list(pipeline.predict(image, return_word_box=True))

        words: list[dict] = []
        for result in results:
            data = _result_data(result)
            texts = data.get("rec_texts") or []
            scores = data.get("rec_scores") or []
            boxes = data.get("rec_boxes") or []
            word_texts = data.get("text_word") or []
            word_boxes = data.get("text_word_region") or data.get("text_word_boxes") or []
            for line, (text, score, box) in enumerate(zip(texts, scores, boxes)):
                if not str(text).strip():
                    continue
                line_words = _line_words(text, box, word_texts[line] if line < len(word_texts) else None, word_boxes[line] if line < len(word_boxes) else None)
                for word_text, (left, top, right, bottom) in line_words:
                    words.append({
                        "text": word_text,
                        "left": round(float(left), 1),
                        "top": round(float(top), 1),
                        "width": round(float(right - left), 1),
                        "height": round(float(bottom - top), 1),
                        "confidence": round(float(score), 4),
                        "line": line,
                    })
        return f"paddle-ppocr-{language}", words

    def _ocr_pipeline(self, language: str) -> tuple[Any, threading.Lock]:
        with self._lock:
            if language not in self._ocr:
                from paddleocr import PaddleOCR

                # The .NET API has already turned and straightened the page, so PaddleOCR's own steps for that are off.
                log.info("Loading PP-OCR for %s", language)
                self._ocr[language] = PaddleOCR(
                    lang=language,
                    use_doc_orientation_classify=False,
                    use_doc_unwarping=False,
                    use_textline_orientation=False,
                    **self.options,
                )
                self._ocr_locks[language] = threading.Lock()
            return self._ocr[language], self._ocr_locks[language]

    # ── Tables ───────────────────────────────────────────────────────

    def read_tables(self, image: np.ndarray, model: str, codes: list[str], words: list[dict] | None = None) -> list[dict]:
        """
        Tables with their cell text. When PP-StructureV3 finds a table's cells but reads no text in them, which happens on
        some pages, the cells are filled from the PP-OCR words inside each cell box instead.
        """
        if model == "structure":
            pipeline, lock = self._structure_pipeline(), self._structure_lock
        elif model == "vl":
            pipeline, lock = self._vl_pipeline(), self._vl_lock
        else:
            return []

        with lock:
            results = list(pipeline.predict(image))

        tables = []
        for result in results:
            data = _result_data(result)
            cell_sets = [table.get("cell_box_list") or [] for table in data.get("table_res_list") or [] if isinstance(table, dict)]
            for block in data.get("parsing_res_list") or []:
                label = str(_field(block, "block_label", "label") or "").lower()
                content = _field(block, "block_content", "content") or ""
                bbox = _field(block, "block_bbox", "bbox")
                if label != "table" or not content or bbox is None or len(bbox) < 4:
                    continue
                left, top, right, bottom = (float(value) for value in bbox[:4])
                rows = parse_table(str(content))
                if is_empty(rows):
                    cells = _cells_inside(cell_sets, (left, top, right, bottom))
                    if cells:
                        if words is None:
                            words = self.read_words(image, codes)[1]
                        rows = grid_from_cells(cells, words)
                if not rows:
                    continue
                tables.append({
                    "left": round(left, 1),
                    "top": round(top, 1),
                    "width": round(right - left, 1),
                    "height": round(bottom - top, 1),
                    "rows": rows,
                })
        return tables

    def _structure_pipeline(self) -> Any:
        with self._lock:
            if self._structure is None:
                from paddleocr import PPStructureV3

                log.info("Loading PP-StructureV3")
                self._structure = PPStructureV3(
                    use_doc_orientation_classify=False,
                    use_doc_unwarping=False,
                    use_seal_recognition=False,
                    use_formula_recognition=False,
                    use_chart_recognition=False,
                    **self.options,
                )
            return self._structure

    def _vl_pipeline(self) -> Any:
        if self.device != "gpu" and not self.allow_vl_on_cpu:
            raise ModelUnavailable(
                "PaddleOCR-VL needs an NVIDIA GPU. Run the ocr-gpu service, use tables=structure, "
                "or set OCR_ALLOW_VL_ON_CPU=true to run it slowly on the CPU."
            )
        with self._lock:
            if self._vl is None:
                from paddleocr import PaddleOCRVL

                options: dict[str, Any] = {"use_doc_orientation_classify": False, "use_doc_unwarping": False, **self.options}
                # A separate vLLM or SGLang server can serve the vision-language model for higher throughput.
                if server := os.environ.get("OCR_VL_SERVER_URL"):
                    options["vl_rec_backend"] = os.environ.get("OCR_VL_BACKEND", "vllm-server")
                    options["vl_rec_server_url"] = server
                log.info("Loading PaddleOCR-VL")
                self._vl = PaddleOCRVL(**options)
            return self._vl


def _cells_inside(cell_sets: list[list], region: tuple[float, float, float, float]) -> list:
    """The cell boxes of the table whose cells mostly sit inside the region."""
    left, top, right, bottom = region
    for cells in cell_sets:
        centres = [((box[0] + box[2]) / 2, (box[1] + box[3]) / 2) for box in cells if len(box) >= 4]
        inside = sum(1 for x, y in centres if left <= x <= right and top <= y <= bottom)
        if centres and inside >= len(centres) * 0.8:
            return cells
    return []


def _flag(name: str, default: bool) -> bool:
    value = os.environ.get(name, "").strip().lower()
    return default if not value else value in ("1", "true", "yes")


def _device() -> str:
    try:
        import paddle

        if paddle.device.is_compiled_with_cuda() and paddle.device.cuda.device_count() > 0:
            return "gpu"
    except Exception:  # noqa: BLE001 - any failure means no usable GPU
        pass
    return "cpu"


def _result_data(result: Any) -> dict:
    data = getattr(result, "json", None)
    if callable(data):
        data = data()
    if isinstance(data, dict):
        return data.get("res", data)
    return dict(result) if hasattr(result, "keys") else {}


def _field(block: Any, *names: str) -> Any:
    for name in names:
        if isinstance(block, dict) and name in block:
            return block[name]
        if hasattr(block, name):
            return getattr(block, name)
    return None


def _line_words(text: str, box: Any, word_texts: Any, word_boxes: Any) -> list[tuple[str, tuple[float, float, float, float]]]:
    """Splits a recognised line into words. Uses PaddleOCR's word boxes when present, otherwise splits the line by character count."""
    left, top, right, bottom = (float(value) for value in list(box)[:4])

    if word_texts and word_boxes and len(word_texts) == len(word_boxes):
        words: list[tuple[str, tuple[float, float, float, float]]] = []
        current, start, end = "", None, None
        for piece, piece_box in zip(list(word_texts) + [" "], list(word_boxes) + [None]):
            if piece_box is not None:
                xs, ys = _box_extent(piece_box)
            if piece.strip() == "" or piece_box is None:
                if current:
                    words.append((current, (start, top, end, bottom)))
                current, start, end = "", None, None
                continue
            current += piece
            start = xs[0] if start is None else min(start, xs[0])
            end = xs[1] if end is None else max(end, xs[1])
        if words and "".join(word for word, _ in words).replace(" ", "") == text.replace(" ", ""):
            return words

    tokens = text.split()
    total = sum(len(token) for token in tokens) + max(len(tokens) - 1, 0)
    if total == 0:
        return []
    width = right - left
    words = []
    position = 0
    for token in tokens:
        start = left + width * position / total
        end = left + width * (position + len(token)) / total
        words.append((token, (start, top, end, bottom)))
        position += len(token) + 1
    return words


def _box_extent(box: Any) -> tuple[tuple[float, float], tuple[float, float]]:
    points = np.asarray(box, dtype=float).reshape(-1)
    if points.size == 4:
        return (points[0], points[2]), (points[1], points[3])
    xs, ys = points[0::2], points[1::2]
    return (float(xs.min()), float(xs.max())), (float(ys.min()), float(ys.max()))
