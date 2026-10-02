"""Esegue la previsione YOLO su immagini e file ricevuti dal server."""
import argparse
import os
from pathlib import Path

ocr_root = Path(os.environ.get("OCR_ROOT", Path(__file__).resolve().parents[2] / "OCR"))  # stessa cartella OCR del server
config_dir = ocr_root / "output" / "yolo-config"
config_dir.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("YOLO_CONFIG_DIR", str(config_dir))
system_ca = Path("/etc/ssl/certs/ca-certificates.crt")
if system_ca.is_file():
    os.environ.setdefault("REQUESTS_CA_BUNDLE", str(system_ca))
    os.environ.setdefault("SSL_CERT_FILE", str(system_ca))
import sys
from ultralytics import YOLO

# Modelli già caricati (modalità --serve), per task e pesi.
_models = {}


def predict(task, model_name, source):
    """Esegue la previsione e restituisce le righe di testo del risultato."""
    model_path = Path(model_name)
    if model_path.parent == Path("."):
        weights_dir = ocr_root / "models"
        weights_dir.mkdir(parents=True, exist_ok=True)
        model_path = weights_dir / model_path.name
    key = (task, str(model_path))
    if key not in _models:
        _models[key] = YOLO(str(model_path), task=task)
    lines = []
    for result in _models[key].predict(source=source, save=False, verbose=False):
        if result.probs is not None:
            lines.append("Classificazione — probabilità stimate:")
            for index in result.probs.top5:
                name = result.names[index].replace("_", " ")
                name = name[:1].upper() + name[1:]
                confidence = float(result.probs.data[index]) * 100
                percentage = f"{confidence:.2f}".replace(".", ",")
                lines.append(f"- {name}: {percentage}%")
        else:
            lines.append(result.verbose())
    return lines


parser = argparse.ArgumentParser()
parser.add_argument("--serve", action="store_true")
parser.add_argument("--task")
parser.add_argument("--model")
parser.add_argument("--source")
args = parser.parse_args()
if args.serve:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "utils"))
    from json_serve import serve
    serve(lambda request: {"text": "\n".join(predict(request["task"], request["model"], request["source"]))})
else:
    if not (args.task and args.model and args.source):
        parser.error("--task, --model e --source richiesti")
    print("\n".join(predict(args.task, args.model, args.source)))
