"""Avvia la generazione di immagini Qwen tramite ComfyUI."""
import argparse, json, os, subprocess, sys, time, urllib.parse, urllib.request, urllib.error
from pathlib import Path

p = argparse.ArgumentParser(); p.add_argument("--prompt", required=True); p.add_argument("--output", required=True)
p.add_argument("--width", type=int, default=768); p.add_argument("--height", type=int, default=768)
p.add_argument("--steps", type=int, default=25); p.add_argument("--seed", type=int, default=42); p.add_argument("--model", default="unused")
p.add_argument("--flow", default="qwen", choices=["qwen", "viggle"])
p.add_argument("--lora", default="Qwen-Image-2.1-viggle-turbo-v0.2.1-6step-lora-r128.safetensors")
p.add_argument("--sigmas", default="1.0, 0.9375, 0.875, 0.75, 0.5, 0.25")
a = p.parse_args(); root = Path(__file__).resolve().parents[1]
comfy = Path(os.environ.get("COMFYUI_ROOT", root / "runtime" / "ComfyUI")).resolve()
python = Path(os.environ.get("COMFYUI_PYTHON", comfy / ".venv" / "Scripts" / "python.exe")).resolve()
base = os.environ.get("COMFYUI_URL", "http://127.0.0.1:8188").rstrip("/")

def request(path, data=None):
    """Invia una richiesta HTTP al servizio ComfyUI locale."""
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(base + path, body, {"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as response: return json.loads(response.read())
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:800]
        raise RuntimeError(f"ComfyUI HTTP {error.code}: {detail}")

try: request("/system_stats")
except Exception:
    if os.environ.get("COMFYUI_URL"):
        raise RuntimeError("ComfyUI è ancora in avvio o non è raggiungibile. Attendi lo stato Operativo nella chat Image.")
    log = open(comfy / "andreagpt-comfy.log", "a", encoding="utf-8")
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    subprocess.Popen([str(python), str(comfy / "main.py"), "--listen", "127.0.0.1", "--port", "8188", "--lowvram"], cwd=comfy, stdout=log, stderr=log, creationflags=flags)
    for _ in range(120):
        try: request("/system_stats"); break
        except Exception: time.sleep(1)
    else: raise RuntimeError("ComfyUI non si è avviato; controlla runtime/ComfyUI/andreagpt-comfy.log")

if a.flow == "viggle":
    # Con COMFYUI_URL impostato ComfyUI gira altrove (es. host Windows mentre il
    # server è in Docker): il disco locale non è verificabile, sarà ComfyUI a
    # segnalare file mancanti. Controllo diretto solo in autogestione locale.
    if not os.environ.get("COMFYUI_URL"):
        lora_path = comfy / "models" / "loras" / Path(a.lora).name
        if not lora_path.is_file():
            raise RuntimeError(f"LoRA Viggle non trovato in {lora_path}. Scaricalo in models/loras, copia viggle_turbo.py in custom_nodes e riavvia ComfyUI.")
    # Viggle Turbo è addestrata per prompt più strutturati e per esattamente
    # sei passaggi. Il valore globale `steps` della UI non deve trasformare
    # accidentalmente questo workflow in un generatore Qwen normale.
    viggle_prompt = (
        f"{a.prompt}. Single main subject, centered composition, clear readable silhouette, "
        "clean geometry, coherent proportions, sharp details, no duplicate objects."
    )
    workflow = {
     "1":{"class_type":"UnetLoaderGGUF","inputs":{"unet_name":"qwen_image_2.1_Q5_K_M.gguf"}},
     "2":{"class_type":"CLIPLoader","inputs":{"clip_name":"qwen3vl_8b_w4a8.safetensors","type":"qwen_image","device":"default"}},
     "3":{"class_type":"TextEncodeQwenImage21","inputs":{"clip":["2",0],"prompt":viggle_prompt,"negative_prompt":"blurry, deformed, duplicated, cropped, unreadable, malformed geometry","resolution":max(a.width,a.height)}},
     "4":{"class_type":"VAELoader","inputs":{"vae_name":"qwen_image_2.1_vae_bf16.safetensors"}},
     "5":{"class_type":"EmptyLatentImage","inputs":{"width":a.width,"height":a.height,"batch_size":1}},
     "6":{"class_type":"ViggleTurboLora","inputs":{"model":["1",0],"lora_name":Path(a.lora).name,"strength":1.0}},
     "7":{"class_type":"BasicGuider","inputs":{"model":["6",0],"conditioning":["3",0]}},
     "8":{"class_type":"RandomNoise","inputs":{"noise_seed":a.seed}},
     "9":{"class_type":"KSamplerSelect","inputs":{"sampler_name":"euler"}},
     "10":{"class_type":"ViggleTurboSigmas","inputs":{"latent":["5",0],"nodes":a.sigmas}},
     "11":{"class_type":"SamplerCustomAdvanced","inputs":{"noise":["8",0],"guider":["7",0],"sampler":["9",0],"sigmas":["10",0],"latent_image":["5",0]}},
     "12":{"class_type":"VAEDecode","inputs":{"samples":["11",0],"vae":["4",0]}},
     "13":{"class_type":"SaveImage","inputs":{"filename_prefix":"AndreaGPT/ViggleTurbo","images":["12",0]}}
    }
    output_node = "13"
else:
    workflow = {
     "1":{"class_type":"UnetLoaderGGUF","inputs":{"unet_name":"qwen_image_2.1_Q5_K_M.gguf"}},
     "2":{"class_type":"CLIPLoader","inputs":{"clip_name":"qwen3vl_8b_w4a8.safetensors","type":"qwen_image","device":"default"}},
     "3":{"class_type":"TextEncodeQwenImage21","inputs":{"clip":["2",0],"prompt":a.prompt,"negative_prompt":"","resolution":max(a.width,a.height)}},
     "4":{"class_type":"VAELoader","inputs":{"vae_name":"qwen_image_2.1_vae_bf16.safetensors"}},
     "5":{"class_type":"EmptyLatentImage","inputs":{"width":a.width,"height":a.height,"batch_size":1}},
     "6":{"class_type":"KSampler","inputs":{"model":["1",0],"positive":["3",0],"negative":["3",1],"latent_image":["5",0],"seed":a.seed,"steps":a.steps,"cfg":1.0,"sampler_name":"euler","scheduler":"simple","denoise":1.0}},
     "7":{"class_type":"VAEDecode","inputs":{"samples":["6",0],"vae":["4",0]}},
     "8":{"class_type":"SaveImage","inputs":{"filename_prefix":"AndreaGPT/Qwen21","images":["7",0]}}
    }
    output_node = "8"
try:
    prompt_id = request("/prompt", {"prompt": workflow})["prompt_id"]
except Exception as error:
    if a.flow == "viggle":
        raise RuntimeError(f"ComfyUI ha rifiutato il flusso Viggle ({error}). Verifica che il LoRA sia in models/loras e viggle_turbo.py in custom_nodes DELL'ISTANZA ComfyUI, poi riavviala.")
    raise
poll_failures = 0
for _ in range(7200):
    try:
        history = request(f"/history/{prompt_id}")
        poll_failures = 0
    except Exception as error:
        # ComfyUI momentaneamente irraggiungibile (es. riavvio): tollera brevi buchi
        poll_failures += 1
        if poll_failures > 10:
            raise RuntimeError(f"ComfyUI irraggiungibile durante la generazione ({error}).")
        time.sleep(3)
        continue
    if prompt_id in history:
        entry = history[prompt_id]
        status = entry.get("status") or {}
        if status.get("status_str") == "error":
            details = json.dumps(status.get("messages", []), ensure_ascii=False)[:600]
            raise RuntimeError(f"ComfyUI: errore in un nodo del flusso ({details}).")
        images = entry.get("outputs", {}).get(output_node, {}).get("images", [])
        if not images: raise RuntimeError("ComfyUI non ha prodotto immagini")
        item = images[0]
        query = urllib.parse.urlencode({"filename": item["filename"], "subfolder": item.get("subfolder", ""), "type": item.get("type", "output")})
        last_error = None
        for _ in range(3):
            try:
                with urllib.request.urlopen(base + "/view?" + query, timeout=120) as response: image_bytes = response.read()
                last_error = None
                break
            except Exception as error:
                last_error = error
                time.sleep(2)
        if last_error is not None:
            raise RuntimeError(f"Immagine generata ma download da ComfyUI fallito ({last_error}). Cerca il file in output/AndreaGPT.")
        target = Path(a.output).resolve(); target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(image_bytes)
        print(json.dumps({"device":"xpu","device_name":"Intel Arc 140T","flow":a.flow,"output":str(target),"width":a.width,"height":a.height,"seed":a.seed})); sys.exit(0)
    time.sleep(1)
raise RuntimeError("Timeout generazione ComfyUI")
