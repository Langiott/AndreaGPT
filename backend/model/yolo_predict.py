"""Esegue la previsione YOLO su immagini e file ricevuti dal server."""
import argparse
import os
from collections import defaultdict
from pathlib import Path

ocr_root = Path(os.environ.get("OCR_ROOT", Path(__file__).resolve().parents[2] / "OCR"))  # stessa cartella OCR del server
config_dir = ocr_root / "output" / "yolo-config"
config_dir.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("YOLO_CONFIG_DIR", str(config_dir))
system_ca = Path("/etc/ssl/certs/ca-certificates.crt")
if system_ca.is_file():
    os.environ.setdefault("REQUESTS_CA_BUNDLE", str(system_ca))
    os.environ.setdefault("SSL_CERT_FILE", str(system_ca))
import csv
import json
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from ultralytics import YOLO

# Modelli già caricati (modalità --serve), per task e pesi.
_models = {}
BOX_COLORS = ["#e5484d", "#3e63dd", "#30a46c", "#f76b15", "#8e4ec6", "#12a594", "#d6409f", "#946800"]
# Soglia minima di confidenza per un punto del corpo considerato visibile.
KEYPOINT_VISIBLE = 0.5


def percent(value):
    return f"{value * 100:.0f}%"


def count(number, singular, plural):
    return f"{number} {singular if number == 1 else plural}"


def polygon_area(points):
    """Area con la formula di Gauss su punti (x, y) normalizzati."""
    if len(points) < 3:
        return 0.0
    x, y = points[:, 0], points[:, 1]
    return abs(float((x * np.roll(y, -1) - y * np.roll(x, -1)).sum())) / 2


def label(name):
    name = name.replace("_", " ")
    return name[:1].upper() + name[1:]


def describe_boxes(result, extra=None):
    """Raggruppa i box per classe: conteggio e confidenze, opzionalmente un dato per oggetto."""
    groups = defaultdict(list)
    for index, (cls, conf) in enumerate(zip(result.boxes.cls.tolist(), result.boxes.conf.tolist())):
        groups[label(result.names[int(cls)])].append((conf, extra[index] if extra else None))
    lines = []
    for name, items in sorted(groups.items(), key=lambda item: -len(item[1])):
        items.sort(key=lambda item: -item[0])
        details = ", ".join(percent(conf) + (f" ({value})" if value else "") for conf, value in items)
        lines.append(f"- {name} ×{len(items)} · {details}")
    return lines


def bounding_boxes(result, annotated=None):
    """Coordinate in pixel di ogni box, immagine con box numerati, export CSV e JSON."""
    height, width = result.orig_shape
    rows = []
    if result.boxes is not None:
        for (x1, y1, x2, y2), cls, conf in zip(result.boxes.xyxy.tolist(), result.boxes.cls.tolist(), result.boxes.conf.tolist()):
            x1, y1, x2, y2 = (round(value) for value in (x1, y1, x2, y2))
            rows.append({"classe": label(result.names[int(cls)]), "confidenza": round(conf, 4), "x1": x1, "y1": y1, "x2": x2, "y2": y2, "larghezza": x2 - x1, "altezza": y2 - y1})
    rows.sort(key=lambda row: -row["confidenza"])
    for index, row in enumerate(rows, 1):
        row["id"] = index
    if not rows:
        return {"text": "Nessun oggetto rilevato."}
    lines = [f"{count(len(rows), 'box', 'box')} · immagine {width}×{height} px", "", "| # | Classe | Conf. | x1 | y1 | x2 | y2 | L | A |", "|---:|---|---:|---:|---:|---:|---:|---:|---:|"]
    lines += [f"| {r['id']} | {r['classe']} | {percent(r['confidenza'])} | {r['x1']} | {r['y1']} | {r['x2']} | {r['y2']} | {r['larghezza']} | {r['altezza']} |" for r in rows]
    reply = {"text": "\n".join(lines)}
    if annotated:
        image = Image.open(result.path).convert("RGB")
        draw = ImageDraw.Draw(image)
        stroke = max(2, round(min(width, height) / 300))
        try:
            font = ImageFont.load_default(size=max(14, round(min(width, height) / 40)))
        except TypeError:  # Pillow < 10.1
            font = ImageFont.load_default()
        for row in rows:
            color = BOX_COLORS[(row["id"] - 1) % len(BOX_COLORS)]
            draw.rectangle((row["x1"], row["y1"], row["x2"], row["y2"]), outline=color, width=stroke)
            tag = f"#{row['id']} {row['classe']} {percent(row['confidenza'])}"
            left, top, right, bottom = draw.textbbox((0, 0), tag, font=font)
            tag_height = bottom - top + 2 * stroke
            # etichetta sopra il box, dentro se il box tocca il bordo superiore
            y = row["y1"] - tag_height if row["y1"] >= tag_height else row["y1"]
            tag_width = right - left + 2 * stroke
            x = max(0, min(row["x1"], width - tag_width))
            draw.rectangle((x, y, x + tag_width, y + tag_height), fill=color)
            draw.text((x + stroke, y + stroke - top), tag, fill="white", font=font)
        image.save(annotated, quality=90)
        base = Path(annotated).with_suffix("")
        fields = ["id", "classe", "confidenza", "x1", "y1", "x2", "y2", "larghezza", "altezza"]
        with open(f"{base}.csv", "w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            writer.writerows(rows)
        with open(f"{base}.json", "w", encoding="utf-8") as handle:
            json.dump({"immagine": {"larghezza": width, "altezza": height}, "box": [{field: row[field] for field in fields} for row in rows]}, handle, ensure_ascii=False, indent=2)
        reply["image"] = annotated
        reply["files"] = [f"{base}.csv", f"{base}.json"]
    return reply


def predict(task, model_name, source, annotated=None):
    """Esegue la previsione; restituisce testo e, se richiesto, il percorso dell'immagine annotata."""
    model_path = Path(model_name)
    if model_path.parent == Path("."):
        weights_dir = ocr_root / "models"
        weights_dir.mkdir(parents=True, exist_ok=True)
        model_path = weights_dir / model_path.name
    # bbox usa il modello di detection, cambia solo l'output
    model_task = "detect" if task == "bbox" else task
    key = (model_task, str(model_path))
    if key not in _models:
        _models[key] = YOLO(str(model_path), task=model_task)
    result = next(iter(_models[key].predict(source=source, save=False, verbose=False)))
    if task == "bbox":
        return bounding_boxes(result, annotated)
    lines = []
    found = False
    if task == "classify":
        lines.append("Classificazione — probabilità stimate:")
        for index in result.probs.top5:
            lines.append(f"- {label(result.names[index])}: {float(result.probs.data[index]) * 100:.2f}%".replace(".", ","))
    elif result.boxes is None or len(result.boxes) == 0:
        lines.append({"segment": "Nessun oggetto segmentato.", "pose": "Nessuna persona rilevata."}.get(task, "Nessun oggetto rilevato."))
    elif task == "segment":
        found = True
        # area del contorno (coordinate normalizzate sull'immagine originale) = frazione dell'immagine
        areas = [f"area {percent(area) if (area := polygon_area(polygon)) >= 0.01 else '<1%'}" for polygon in result.masks.xyn] if result.masks is not None else None
        lines.append(count(len(result.boxes), "oggetto segmentato", "oggetti segmentati"))
        lines.extend(describe_boxes(result, areas))
    elif task == "pose":
        found = True
        visible = []
        if result.keypoints is not None and result.keypoints.conf is not None:
            total = result.keypoints.conf.shape[1]
            visible = [f"{int((row > KEYPOINT_VISIBLE).sum())}/{total} punti" for row in result.keypoints.conf]
        lines.append(count(len(result.boxes), "persona", "persone"))
        for index, conf in enumerate(result.boxes.conf.tolist()):
            lines.append(f"- Persona {index + 1} · {percent(conf)}" + (f" · {visible[index]}" if visible else ""))
    else:
        found = True
        lines.append(count(len(result.boxes), "oggetto rilevato", "oggetti rilevati"))
        lines.extend(describe_boxes(result))
    reply = {"text": "\n".join(lines)}
    if annotated and found:
        # plot() restituisce BGR
        Image.fromarray(result.plot()[..., ::-1]).save(annotated, quality=90)
        reply["image"] = annotated
    return reply


parser = argparse.ArgumentParser()
parser.add_argument("--serve", action="store_true")
parser.add_argument("--task")
parser.add_argument("--model")
parser.add_argument("--source")
parser.add_argument("--annotated")
args = parser.parse_args()
if args.serve:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "utils"))
    from json_serve import serve
    serve(lambda request: predict(request["task"], request["model"], request["source"], request.get("annotated")))
else:
    if not (args.task and args.model and args.source):
        parser.error("--task, --model e --source richiesti")
    print(predict(args.task, args.model, args.source, args.annotated)["text"])
