"""Riordina i candidati del Brain con un cross-encoder: domanda e brano letti insieme.

Modalità serve: una richiesta JSON per riga su stdin, una risposta JSON per riga su stdout.
Richiesta: {"query": str, "passages": [str, ...]}  →  Risposta: {"scores": [float, ...], "ms": float}
"""
import json
import os
import sys
import time

os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
# transformers carica scikit-learn se lo trova, ma il reranker non lo usa: su Windows con
# il controllo delle applicazioni attivo le sue DLL vengono bloccate e l'import fallisce.
sys.modules.setdefault("sklearn", None)
# Download da Hugging Face con i certificati di sistema, come Node con --use-system-ca.
try:
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass
import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

# Multilingue e leggero: su CPU circa 1,3 s per 20 brani. bge-reranker-v2-m3 è circa 10 volte più lento.
MODEL = os.environ.get("BRAIN_RERANK_MODEL", "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1")
MAX_LENGTH = int(os.environ.get("BRAIN_RERANK_MAX_TOKENS", "512"))
BATCH = 8


def load():
    """Carica tokenizer e modello una sola volta, in sola inferenza."""
    torch.set_num_threads(max(1, min(8, os.cpu_count() or 1)))
    tokenizer = AutoTokenizer.from_pretrained(MODEL)
    model = AutoModelForSequenceClassification.from_pretrained(MODEL)
    model.eval()
    return tokenizer, model


def score(tokenizer, model, query, passages):
    """Punteggio di pertinenza per ogni coppia (domanda, brano): sigmoide del logit, da 0 a 1."""
    scores = []
    with torch.inference_mode():
        for offset in range(0, len(passages), BATCH):
            batch = passages[offset:offset + BATCH]
            inputs = tokenizer([query] * len(batch), batch, padding=True, truncation="only_second", max_length=MAX_LENGTH, return_tensors="pt")
            logits = model(**inputs).logits
            # Alcuni cross-encoder hanno una sola uscita (pertinenza), altri due classi (non pertinente/pertinente).
            values = logits[:, 0] if logits.shape[-1] == 1 else logits[:, -1] - logits[:, 0]
            scores.extend(torch.sigmoid(values.float()).tolist())
    return scores


def serve():
    # Node scrive UTF-8; su Windows Python leggerebbe in cp1252 (lettere accentate storpiate o crash).
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    tokenizer, model = load()
    # Il server salta il riordino finché non riceve questa riga: il primo caricamento non blocca la chat.
    print(json.dumps({"ready": True}), flush=True)
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            request = json.loads(line)
            started = time.perf_counter()
            result = {"scores": score(tokenizer, model, str(request["query"]), [str(p) for p in request["passages"]])}
            result["ms"] = round((time.perf_counter() - started) * 1000, 1)
        except Exception as error:  # la risposta deve sempre arrivare, anche in caso di errore
            result = {"error": f"Reranker: {error}"}
        print(json.dumps(result), flush=True)


if __name__ == "__main__":
    serve()
