import argparse
import os
from pathlib import Path

ocr_root = Path(os.environ.get("OCR_ROOT", Path(__file__).resolve().parents[1] / "OCR"))
config_dir = ocr_root / "output" / "yolo-config"
config_dir.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("YOLO_CONFIG_DIR", str(config_dir))
system_ca = Path("/etc/ssl/certs/ca-certificates.crt")
if system_ca.is_file():
    os.environ.setdefault("REQUESTS_CA_BUNDLE", str(system_ca))
    os.environ.setdefault("SSL_CERT_FILE", str(system_ca))
from ultralytics import YOLO

parser = argparse.ArgumentParser()
parser.add_argument("--task", required=True)
parser.add_argument("--model", required=True)
parser.add_argument("--source", required=True)
args = parser.parse_args()

model_path = Path(args.model)
if model_path.parent == Path("."):
    weights_dir = ocr_root / "models"
    weights_dir.mkdir(parents=True, exist_ok=True)
    model_path = weights_dir / model_path.name
model = YOLO(str(model_path), task=args.task)
for result in model.predict(source=args.source, save=False, verbose=False):
    if result.probs is not None:
        print("Classificazione — probabilità stimate:")
        for index in result.probs.top5:
            name = result.names[index].replace("_", " ")
            name = name[:1].upper() + name[1:]
            confidence = float(result.probs.data[index]) * 100
            percentage = f"{confidence:.2f}".replace(".", ",")
            print(f"- {name}: {percentage}%")
    else:
        print(result.verbose())
