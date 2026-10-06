"""Trascrive file audio in testo usando il modello Whisper locale."""
import argparse
import json
import os
import sys

from faster_whisper import WhisperModel

# Modelli già caricati (modalità --serve): il secondo audio non ricarica i pesi.
_models = {}


def transcribe(source, model_name, language, retry=True):
    """Trascrive un file audio e restituisce testo, lingua e durata."""
    if model_name not in _models:
        _models[model_name] = WhisperModel(model_name, device="cpu", compute_type="int8", cpu_threads=min(8, max(2, os.cpu_count() or 2)))  # oltre 8 i thread si contendono i core assegnati a Docker
    model = _models[model_name]
    language = None if language == "auto" else language  # "auto": Whisper riconosce la lingua (reel in inglese)
    segments, info = model.transcribe(source, language=language, vad_filter=True, beam_size=5)
    text = " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()
    # AAC/registrazioni con volume basso possono essere scartate dal VAD.
    # Ripetiamo senza VAD solo quando il primo passaggio è davvero vuoto.
    # retry=False (reel Instagram): audio di sola musica resta vuoto, senza il secondo passaggio lento.
    if not text and retry:
        segments, info = model.transcribe(source, language=language, vad_filter=False, beam_size=5)
        text = " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()
    return {"text": text, "language": info.language, "duration": info.duration}


def main():
    """Trascrive l'audio indicato e restituisce il risultato in JSON, oppure resta in ascolto con --serve."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--input")
    parser.add_argument("--model", default=os.environ.get("WHISPER_MODEL", "small"))
    parser.add_argument("--language", default="it")
    args = parser.parse_args()
    if args.serve:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from json_serve import serve
        serve(lambda request: transcribe(request["input"], request.get("model") or args.model, request.get("language") or args.language, request.get("retry", True)))
        return
    if not args.input:
        parser.error("--input richiesto")
    print(json.dumps(transcribe(args.input, args.model, args.language), ensure_ascii=False))


if __name__ == "__main__":
    main()
