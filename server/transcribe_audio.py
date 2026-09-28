import argparse
import json
import os

from faster_whisper import WhisperModel


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--model", default=os.environ.get("WHISPER_MODEL", "small"))
    parser.add_argument("--language", default="it")
    args = parser.parse_args()
    model = WhisperModel(args.model, device="cpu", compute_type="int8", cpu_threads=max(2, os.cpu_count() or 2))
    segments, info = model.transcribe(args.input, language=args.language, vad_filter=True, beam_size=5)
    text = " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()
    # AAC/registrazioni con volume basso possono essere scartate dal VAD.
    # Ripetiamo senza VAD solo quando il primo passaggio è davvero vuoto.
    if not text:
        segments, info = model.transcribe(args.input, language=args.language, vad_filter=False, beam_size=5)
        text = " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()
    print(json.dumps({"text": text, "language": info.language, "duration": info.duration}, ensure_ascii=False))


if __name__ == "__main__":
    main()
