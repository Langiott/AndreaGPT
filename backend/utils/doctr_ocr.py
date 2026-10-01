"""Estrae testo da immagini e PDF usando docTR in locale."""
import argparse
import os
from pathlib import Path
import tempfile


def raddrizza_foglio(image):
    """Raddrizza una pagina prima di passarla al motore OCR."""
    """Raddrizza una foto del foglio prima di passarla a docTR."""
    import cv2
    import numpy as np
    from PIL import Image

    rgb = np.array(image.convert("RGB"))
    height, width = rgb.shape[:2]
    ratio = min(1.0, 1200.0 / max(height, width))
    small = cv2.resize(rgb, (max(1, round(width * ratio)), max(1, round(height * ratio)))) if ratio < 1 else rgb
    gray = cv2.cvtColor(small, cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 50, 150)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)
    corners = None
    for contour in contours[:20]:
        perimeter = cv2.arcLength(contour, True)
        polygon = cv2.approxPolyDP(contour, 0.02 * perimeter, True)
        if len(polygon) == 4 and cv2.contourArea(polygon) > small.shape[0] * small.shape[1] * 0.25:
            corners = polygon.reshape(4, 2).astype("float32") / ratio
            break
    if corners is None:
        return image

    ordered = np.zeros((4, 2), dtype="float32")
    sums = corners.sum(axis=1)
    diffs = np.diff(corners, axis=1).reshape(-1)
    ordered[0], ordered[2] = corners[np.argmin(sums)], corners[np.argmax(sums)]
    ordered[1], ordered[3] = corners[np.argmin(diffs)], corners[np.argmax(diffs)]
    out_width = int(max(np.linalg.norm(ordered[1] - ordered[0]), np.linalg.norm(ordered[2] - ordered[3])))
    out_height = int(max(np.linalg.norm(ordered[3] - ordered[0]), np.linalg.norm(ordered[2] - ordered[1])))
    destination = np.array([[0, 0], [out_width - 1, 0], [out_width - 1, out_height - 1], [0, out_height - 1]], dtype="float32")
    matrix = cv2.getPerspectiveTransform(ordered, destination)
    corrected = cv2.warpPerspective(rgb, matrix, (out_width, out_height), borderMode=cv2.BORDER_REPLICATE)
    return Image.fromarray(corrected)


def main() -> None:
    """Legge input e output dai parametri e salva il testo estratto."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    cache_dir = Path(args.output).parent / "doctr-cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("DOCTR_CACHE_DIR", str(cache_dir))

    from doctr.io import DocumentFile
    from doctr.models import ocr_predictor
    from PIL import Image, ImageOps

    source = Path(args.input)
    temporary = None
    if source.suffix.lower() == ".pdf":
        document = DocumentFile.from_pdf(str(source))
    else:
        image = raddrizza_foglio(ImageOps.exif_transpose(Image.open(source)))
        temporary = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
        image.save(temporary.name)
        temporary.close()
        document = DocumentFile.from_images(temporary.name)
    predictor = ocr_predictor(pretrained=True)
    result = predictor(document)
    lines = []
    for page in result.pages:
        # docTR a volte assegna un'intera tabella o un modulo a una sola
        # ``line``. Usiamo quindi la geometria delle singole parole: è molto
        # più affidabile per preventivi, intestazioni e colonne vicine.
        words = []
        for block in page.blocks:
            for line in block.lines:
                for word in line.words:
                    value = word.value.strip()
                    if not value:
                        continue
                    (x0, y0), (x1, y1) = word.geometry
                    words.append({
                        "x": float(x0),
                        "y": (float(y0) + float(y1)) / 2,
                        "height": max(0.001, float(y1) - float(y0)),
                        "value": value,
                    })

        if words:
            heights = sorted(word["height"] for word in words)
            median_height = heights[len(heights) // 2]
            # Parole della stessa riga hanno normalmente centri verticali
            # entro circa metà dell'altezza del carattere.
            row_tolerance = max(0.006, median_height * 0.65)
            rows = []
            for word in sorted(words, key=lambda item: (item["y"], item["x"])):
                row = min(rows, key=lambda item: abs(item["y"] - word["y"]), default=None)
                if row is None or abs(row["y"] - word["y"]) > row_tolerance:
                    rows.append({"y": word["y"], "words": [word]})
                else:
                    row["words"].append(word)
                    row["y"] = sum(item["y"] for item in row["words"]) / len(row["words"])

            rows.sort(key=lambda item: item["y"])
            previous_y = None
            for row in rows:
                row_words = sorted(row["words"], key=lambda item: item["x"])
                value = " ".join(item["value"] for item in row_words).strip()
                if not value:
                    continue
                if previous_y is not None and row["y"] - previous_y > median_height * 2.2:
                    lines.append("")
                lines.append(value)
                previous_y = row["y"]
        if words:
            lines.append("")
    if temporary:
        Path(temporary.name).unlink(missing_ok=True)
    Path(args.output).write_text("\n".join(lines).strip() + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
