#!/usr/bin/env python3
"""Render the AndreaGPT Draw.io architecture to a PNG preview."""
from __future__ import annotations

import html
import math
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

INPUT = Path(sys.argv[1] if len(sys.argv) > 1 else "DRAW/architettura-andreagpt.drawio")
OUTPUT = Path(sys.argv[2] if len(sys.argv) > 2 else INPUT.with_suffix(".png"))
IS_MAIN_ARCHITECTURE = INPUT.name.lower() == "architettura-andreagpt.drawio"

tree = ET.parse(INPUT)
cells = {cell.attrib["id"]: cell for cell in tree.getroot().iter("mxCell") if "id" in cell.attrib}

def number(value: str | None, default: float = 0.0) -> float:
    try:
        return float(value or default)
    except ValueError:
        return default

def geometry(cell_id: str, seen: set[str] | None = None) -> dict[str, float]:
    seen = set() if seen is None else seen
    if cell_id in seen or cell_id not in cells:
        return {"x": 0, "y": 0, "width": 0, "height": 0}
    seen.add(cell_id)
    cell = cells[cell_id]
    node = next(iter(cell.findall("mxGeometry")), None)
    if node is None:
        return {"x": 0, "y": 0, "width": 0, "height": 0}
    parent_id = cell.attrib.get("parent")
    parent = geometry(parent_id, seen) if parent_id not in (None, "0", "1") else {"x": 0, "y": 0}
    return {
        "x": parent["x"] + number(node.attrib.get("x")),
        "y": parent["y"] + number(node.attrib.get("y")),
        "width": number(node.attrib.get("width")),
        "height": number(node.attrib.get("height")),
    }

def style(cell) -> dict[str, str]:
    result = {}
    for item in cell.attrib.get("style", "").split(";"):
        if "=" in item:
            key, value = item.split("=", 1)
            result[key] = value
        elif item:
            result[item] = "1"
    return result

def color(value: str | None, fallback: str) -> str:
    match = re.search(r"#[0-9a-fA-F]{6}", value or "")
    return match.group(0) if match else fallback

def label(cell) -> str:
    value = html.unescape(cell.attrib.get("value", ""))
    value = re.sub(r"<br\s*/?>", "\n", value, flags=re.I)
    value = re.sub(r"<[^>]+>", "", value)
    return value.strip()

vertices = []
for cell in cells.values():
    if cell.attrib.get("vertex") == "1" and cell.attrib.get("id") not in ("0", "1"):
        vertices.append((cell, geometry(cell.attrib["id"]), style(cell)))

by_id = {cell.attrib["id"]: (cell, geo, st) for cell, geo, st in vertices}
width = max(1800 if IS_MAIN_ARCHITECTURE else 1400, *(geo["x"] + geo["width"] for _, geo, _ in vertices)) + 90
height = max(1100 if IS_MAIN_ARCHITECTURE else 760, *(geo["y"] + geo["height"] for _, geo, _ in vertices)) + 90
image = Image.new("RGB", (int(width), int(height)), "#f8fafc")
draw = ImageDraw.Draw(image)

font_regular = "C:/Windows/Fonts/arial.ttf"
font_bold = "C:/Windows/Fonts/arialbd.ttf"

def font(size: int, bold: bool = False):
    try:
        return ImageFont.truetype(font_bold if bold else font_regular, size)
    except OSError:
        return ImageFont.load_default()

def centered_text(box, text, size, fill, bold=False):
    lines = text.splitlines() or [""]
    fnt = font(size, bold)
    spacing = int(size * 0.25)
    bbox = draw.multiline_textbbox((0, 0), "\n".join(lines), font=fnt, spacing=spacing, align="center")
    x = box["x"] + (box["width"] - (bbox[2] - bbox[0])) / 2
    y = box["y"] + (box["height"] - (bbox[3] - bbox[1])) / 2 - bbox[1]
    draw.multiline_text((x, y), "\n".join(lines), font=fnt, fill=fill, spacing=spacing, align="center")

def point(geo):
    return (geo["x"] + geo["width"] / 2, geo["y"] + geo["height"] / 2)

def arrow(x1, y1, x2, y2, fill):
    angle = math.atan2(y2 - y1, x2 - x1)
    length = 12
    spread = 0.45
    left = (x2 - length * math.cos(angle - spread), y2 - length * math.sin(angle - spread))
    right = (x2 - length * math.cos(angle + spread), y2 - length * math.sin(angle + spread))
    draw.polygon([(x2, y2), left, right], fill=fill)

def line_dashed(start, end, fill, dashed):
    if not dashed:
        draw.line([start, end], fill=fill, width=3)
        return
    x1, y1 = start
    x2, y2 = end
    distance = math.hypot(x2 - x1, y2 - y1)
    steps = max(1, int(distance / 14))
    for index in range(0, steps, 2):
        a = index / steps
        b = min(1, (index + 1) / steps)
        draw.line([(x1 + (x2 - x1) * a, y1 + (y2 - y1) * a), (x1 + (x2 - x1) * b, y1 + (y2 - y1) * b)], fill=fill, width=3)

for cell in cells.values():
    if cell.attrib.get("edge") != "1":
        continue
    source = by_id.get(cell.attrib.get("source", ""))
    target = by_id.get(cell.attrib.get("target", ""))
    if not source or not target:
        continue
    start = point(source[1])
    end = point(target[1])
    st = style(cell)
    stroke = color(st.get("strokeColor"), "#64748b")
    line_dashed(start, end, stroke, "dashed" in st)
    arrow(start[0], start[1], end[0], end[1], stroke)
    text = label(cell).splitlines()[0] if label(cell) else ""
    if text:
        mid = ((start[0] + end[0]) / 2, (start[1] + end[1]) / 2 - 8)
        draw.text(mid, text, font=font(14), fill=stroke, anchor="mm")

swimlanes = [(cell, geo, st) for cell, geo, st in vertices if "swimlane" in st]
regular = [(cell, geo, st) for cell, geo, st in vertices if "swimlane" not in st]

for cell, geo, st in swimlanes:
    fill = color(st.get("swimlaneFillColor"), color(st.get("fillColor"), "#ffffff"))
    stroke = color(st.get("strokeColor"), "#64748b")
    header = color(st.get("fillColor"), stroke)
    draw.rounded_rectangle((geo["x"], geo["y"], geo["x"] + geo["width"], geo["y"] + geo["height"]), radius=16, fill=fill, outline=stroke, width=3)
    header_height = number(st.get("startSize"), 34)
    draw.rounded_rectangle((geo["x"], geo["y"], geo["x"] + geo["width"], geo["y"] + header_height), radius=16, fill=header)
    draw.rectangle((geo["x"], geo["y"] + header_height - 16, geo["x"] + geo["width"], geo["y"] + header_height), fill=header)
    draw.text((geo["x"] + 18, geo["y"] + 8), label(cell), font=font(20, True), fill=color(st.get("fontColor"), "#ffffff"))

for cell, geo, st in regular:
    fill = color(st.get("fillColor"), "#ffffff")
    stroke = color(st.get("strokeColor"), "#64748b")
    if st.get("shape") == "ellipse":
        draw.ellipse((geo["x"], geo["y"], geo["x"] + geo["width"], geo["y"] + geo["height"]), fill=fill, outline=stroke, width=3)
    elif st.get("shape") == "cylinder":
        draw.rectangle((geo["x"], geo["y"] + 12, geo["x"] + geo["width"], geo["y"] + geo["height"] - 12), fill=fill, outline=stroke, width=3)
        draw.ellipse((geo["x"], geo["y"], geo["x"] + geo["width"], geo["y"] + 24), fill=fill, outline=stroke, width=3)
        draw.ellipse((geo["x"], geo["y"] + geo["height"] - 24, geo["x"] + geo["width"], geo["y"] + geo["height"]), fill=fill, outline=stroke, width=3)
    else:
        draw.rounded_rectangle((geo["x"], geo["y"], geo["x"] + geo["width"], geo["y"] + geo["height"]), radius=10, fill=fill, outline=stroke, width=3)
    centered_text(geo, label(cell), int(number(st.get("fontSize"), 16)), color(st.get("fontColor"), "#1f2937"), st.get("fontStyle") == "1")

if IS_MAIN_ARCHITECTURE:
    draw.text((40, 24), "Architettura AndreaGPT", font=font(30, True), fill="#0f172a")
    draw.text((40, 58), "Flusso reale: UI → API/router → Brain/RAG + Micelio → modello o strumento locale", font=font(16), fill="#475569")
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
image.save(OUTPUT, "PNG", optimize=True)
print(f"Creato {OUTPUT}")
