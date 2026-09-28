"""Qwen3-VL locale, come CLI o worker JSON-lines persistente."""
import argparse
import json
import math
import sys
from pathlib import Path
from PIL import Image


def resize_for_budget(source, max_pixels):
    image = Image.open(source).convert("RGB")
    width, height = image.size
    scale = min(1.0, math.sqrt(max_pixels / max(1, width * height)))
    resized = (max(32, round(width * scale / 32) * 32), max(32, round(height * scale / 32) * 32))
    if resized != (width, height):
        prepared = source.with_name(f"{source.stem}-prepared{source.suffix}")
        image.resize(resized, Image.Resampling.LANCZOS).save(prepared)
        return prepared, resized
    return source, (width, height)


class VisionRuntime:
    def __init__(self, model_name, requested_device):
        import torch
        from transformers import AutoProcessor, Qwen3VLForConditionalGeneration
        from qwen_vl_utils import process_vision_info
        self.torch, self.process_vision_info, self.model_name = torch, process_vision_info, model_name
        self.device = ("xpu" if hasattr(torch, "xpu") and torch.xpu.is_available() else "cpu") if requested_device == "auto" else requested_device
        self.model = Qwen3VLForConditionalGeneration.from_pretrained(model_name, torch_dtype="auto", low_cpu_mem_usage=True)
        self.model.to(self.device)
        self.model.eval()
        self.processor = AutoProcessor.from_pretrained(model_name)

    def analyze(self, request):
        source = Path(request["input"])
        prepared, resized = resize_for_budget(source, int(request.get("max_pixels", 262144)))
        try:
            messages = [{"role": "user", "content": [{"type": "image", "image": str(prepared.resolve())}, {"type": "text", "text": request["prompt"]}]}]
            text = self.processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
            image_inputs, video_inputs = self.process_vision_info(messages, image_patch_size=16)
            inputs = self.processor(text=[text], images=image_inputs, videos=video_inputs, padding=True, return_tensors="pt")
            inputs = {key: value.to(self.device) if hasattr(value, "to") else value for key, value in inputs.items()}
            with self.torch.inference_mode():
                generated = self.model.generate(**inputs, max_new_tokens=max(32, min(int(request.get("max_tokens", 256)), 1024)), do_sample=False, repetition_penalty=1.15, no_repeat_ngram_size=4)
            answer = self.processor.batch_decode(generated[:, inputs["input_ids"].shape[1]:], skip_special_tokens=True, clean_up_tokenization_spaces=False)[0].strip()
            clean, seen = [], set()
            for line in answer.splitlines():
                normalized = " ".join(line.split()).casefold()
                if normalized and normalized in seen: continue
                if normalized: seen.add(normalized)
                clean.append(line)
            if self.device == "xpu": self.torch.xpu.synchronize()
            return {"text": "\n".join(clean).strip(), "resized": {"width": resized[0], "height": resized[1]}, "model": self.model_name, "device": self.device}
        finally:
            if prepared != source:
                try: prepared.unlink()
                except OSError: pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--input")
    parser.add_argument("--prompt")
    parser.add_argument("--model", default="Qwen/Qwen3-VL-2B-Instruct")
    parser.add_argument("--device", default="auto")
    parser.add_argument("--max-pixels", type=int, default=262144)
    parser.add_argument("--max-tokens", type=int, default=256)
    args = parser.parse_args()
    runtime = VisionRuntime(args.model, args.device)
    if args.serve:
        for line in sys.stdin:
            try:
                payload = json.loads(line)
                # Pre-riscaldamento: il modello è già caricato nel costruttore,
                # si risponde subito così il worker resta caldo per le analisi vere.
                if isinstance(payload, dict) and payload.get("warmup"):
                    result = {"text": "", "warmed": True, "model": runtime.model_name, "device": runtime.device}
                else:
                    result = runtime.analyze(payload)
            except Exception as error: result = {"error": str(error)}
            print(json.dumps(result, ensure_ascii=False), flush=True)
    else:
        if not args.input or not args.prompt: parser.error("--input e --prompt sono obbligatori")
        print(json.dumps(runtime.analyze({"input": args.input, "prompt": args.prompt, "max_pixels": args.max_pixels, "max_tokens": args.max_tokens}), ensure_ascii=False))


if __name__ == "__main__": main()
