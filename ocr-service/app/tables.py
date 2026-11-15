"""Turns the HTML and Markdown tables that layout models write into rows of cell text."""

from __future__ import annotations

import re
from html.parser import HTMLParser


class _TableParser(HTMLParser):
    """Collects rows of cells, repeating nothing: a cell spanning several columns or rows leaves the others empty."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[list[str]] = []
        self._row: list[str] | None = None
        self._cell: list[str] | None = None
        self._spans: list[tuple[int, int]] = []  # (colspan, rowspan) for the cells in the current row
        self._pending: dict[int, int] = {}  # column -> rows still covered by a rowspan above

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "tr":
            self._row = []
            self._spans = []
        elif tag in ("td", "th") and self._row is not None:
            values = dict(attrs)
            self._cell = []
            self._spans.append((_span(values.get("colspan")), _span(values.get("rowspan"))))
        elif tag == "br" and self._cell is not None:
            self._cell.append(" ")

    def handle_endtag(self, tag: str) -> None:
        if tag in ("td", "th") and self._row is not None and self._cell is not None:
            self._row.append(" ".join("".join(self._cell).split()))
            self._cell = None
        elif tag == "tr" and self._row is not None:
            self.rows.append(self._expand(self._row, self._spans))
            self._row = None

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell.append(data)

    def _expand(self, cells: list[str], spans: list[tuple[int, int]]) -> list[str]:
        row: list[str] = []
        column = 0
        for text, (colspan, rowspan) in zip(cells, spans):
            while self._pending.get(column, 0) > 0:
                self._pending[column] -= 1
                row.append("")
                column += 1
            row.append(text)
            if rowspan > 1:
                self._pending[column] = rowspan - 1
            for extra in range(1, colspan):
                row.append("")
                if rowspan > 1:
                    self._pending[column + extra] = rowspan - 1
            column += colspan
        while self._pending.get(column, 0) > 0:
            self._pending[column] -= 1
            row.append("")
            column += 1
        return row


def _span(value: str | None) -> int:
    try:
        return max(1, min(int(value or 1), 100))
    except ValueError:
        return 1


def parse_html_table(html: str) -> list[list[str]]:
    """Rows of cell text from the first table in an HTML fragment."""
    parser = _TableParser()
    parser.feed(html)
    parser.close()
    return _pad([row for row in parser.rows if row])


_SEPARATOR = re.compile(r"^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$")


def parse_markdown_table(markdown: str) -> list[list[str]]:
    """Rows of cell text from a Markdown pipe table."""
    rows = []
    for line in markdown.splitlines():
        if "|" not in line or _SEPARATOR.match(line):
            continue
        cells = line.strip().strip("|").split("|")
        rows.append([" ".join(cell.split()) for cell in cells])
    return _pad(rows)


def parse_table(content: str) -> list[list[str]]:
    """Rows from a table that a layout model wrote as HTML or Markdown."""
    if "<t" in content.lower():
        return parse_html_table(content)
    return parse_markdown_table(content)


def is_empty(rows: list[list[str]]) -> bool:
    return not any(cell.strip() for row in rows for cell in row)


def grid_from_cells(cell_boxes: list, words: list[dict]) -> list[list[str]]:
    """
    Builds a table from the cell boxes a table model found, filling each cell with the OCR words whose centres fall inside it.
    Rows and columns come from where the boxes start, so a cell spanning several columns fills the first of them.
    """
    boxes = [tuple(float(value) for value in list(box)[:4]) for box in cell_boxes if len(box) >= 4]
    if not boxes:
        return []
    heights = sorted(bottom - top for _, top, _, bottom in boxes)
    widths = sorted(right - left for left, _, right, _ in boxes)
    row_starts = _cluster([top for _, top, _, _ in boxes], heights[len(heights) // 2] * 0.4)
    column_starts = _cluster([left for left, _, _, _ in boxes], widths[len(widths) // 2] * 0.4)

    grid = [[[] for _ in column_starts] for _ in row_starts]
    for left, top, right, bottom in boxes:
        row = _nearest(row_starts, top)
        column = _nearest(column_starts, left)
        inside = [
            word for word in words
            if left <= word["left"] + word["width"] / 2 <= right and top <= word["top"] + word["height"] / 2 <= bottom
        ]
        grid[row][column].extend(sorted(inside, key=lambda word: (word["top"] // max(word["height"], 1), word["left"])))

    rows = [[" ".join(word["text"] for word in cell) for cell in row] for row in grid]
    return [] if is_empty(rows) else rows


def _cluster(values: list[float], tolerance: float) -> list[float]:
    starts: list[float] = []
    for value in sorted(values):
        if not starts or value - starts[-1] > tolerance:
            starts.append(value)
    return starts


def _nearest(starts: list[float], value: float) -> int:
    return min(range(len(starts)), key=lambda index: abs(starts[index] - value))


def _pad(rows: list[list[str]]) -> list[list[str]]:
    width = max((len(row) for row in rows), default=0)
    return [row + [""] * (width - len(row)) for row in rows]
