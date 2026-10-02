"""Modalità worker per gli script Python: una richiesta JSON per riga su stdin, una risposta JSON per riga su stdout.

Il modello resta caricato tra una richiesta e l'altra, quindi Python e i pesi si caricano una sola volta.
"""
import json
import os
import sys


def serve(handle):
    """Esegue handle(richiesta) -> dict per ogni riga. Gli errori diventano {"error": ...}, il worker resta vivo."""
    # Node scrive UTF-8; su Windows Python leggerebbe in cp1252.
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.flush()
    # Le librerie (ultralytics, docTR, …) stampano su stdout anche tramite logger creati all'import:
    # il descrittore 1 viene deviato su stderr e le risposte vanno su una sua copia riservata.
    replies = os.fdopen(os.dup(1), "w", encoding="utf-8")
    os.dup2(2, 1)
    sys.stdout = sys.stderr
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            result = handle(json.loads(line))
        except Exception as error:  # la risposta deve sempre arrivare, anche in caso di errore
            result = {"error": f"{type(error).__name__}: {error}"[:600]}
        replies.write(json.dumps(result, ensure_ascii=False) + "\n")
        replies.flush()
