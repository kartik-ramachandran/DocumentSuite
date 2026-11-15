from app.tables import parse_html_table, parse_markdown_table, parse_table


def test_html_table_with_spans():
    html = """
    <table>
      <tr><th>Item</th><th colspan="2">Amount</th></tr>
      <tr><td rowspan="2">Rent</td><td>1,200.00</td><td>NZD</td></tr>
      <tr><td>1,250.00</td><td>NZD</td></tr>
    </table>
    """
    assert parse_html_table(html) == [
        ["Item", "Amount", ""],
        ["Rent", "1,200.00", "NZD"],
        ["", "1,250.00", "NZD"],
    ]


def test_html_cells_keep_line_breaks_as_spaces():
    assert parse_html_table("<table><tr><td>Unit<br>price</td><td>&amp; tax</td></tr></table>") == [["Unit price", "& tax"]]


def test_markdown_table():
    markdown = "| Name | Qty |\n|---|---:|\n| Bolts | 40 |\n| Nuts |\n"
    assert parse_markdown_table(markdown) == [["Name", "Qty"], ["Bolts", "40"], ["Nuts", ""]]


def test_parse_table_detects_the_format():
    assert parse_table("<table><tr><td>a</td></tr></table>") == [["a"]]
    assert parse_table("| a | b |") == [["a", "b"]]


def test_grid_from_cells_fills_cells_from_words_in_any_box_order():
    from app.tables import grid_from_cells

    # Cell boxes arrive column by column, as PP-StructureV3 sometimes returns them.
    cells = [[0, 0, 100, 50], [0, 50, 100, 100], [100, 0, 200, 50], [100, 50, 200, 100]]
    words = [
        {"text": "Rent", "left": 10, "top": 60, "width": 40, "height": 20},
        {"text": "Item", "left": 10, "top": 10, "width": 40, "height": 20},
        {"text": "1,200.00", "left": 110, "top": 60, "width": 60, "height": 20},
        {"text": "Amount", "left": 110, "top": 10, "width": 60, "height": 20},
    ]
    assert grid_from_cells(cells, words) == [["Item", "Amount"], ["Rent", "1,200.00"]]


def test_grid_from_cells_with_no_words_is_empty():
    from app.tables import grid_from_cells

    assert grid_from_cells([[0, 0, 10, 10]], []) == []
