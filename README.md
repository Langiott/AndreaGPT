ANDREAGPT:

![AndreaGPT](img/image.png)

AndreaGPT è un'interfaccia conversazionale multi-modello, accessibile via browser, che permette di dialogare con diversi 
LLM. Supporta sia modelli open-weight in locale, come Qwen3.8 da 27B, sia modelli via API, come MiniMax3. Si usa per 
conversazioni generiche, anche con ricerca web, ma soprattutto per il question answering su documenti precaricati e 
repository GitHub.
Il sistema si basa su un'architettura RAG (Retrieval-Augmented Generation), che recupera dalla knowledge base le 
informazioni rilevanti e le fornisce all'LLM come contesto per rispondere alla domanda.

Nell'immagine mostra la risposta ad una domanda DI un progetto github pre caricato https://github.com/Langiott/Pianeti_Stelle che oltre a ricreare immagine del Buco nero M87 , ne descirve alcune caratteristiche nel Readme .

STACK:

- Frontend: React, TypeScript, Vite e CSS.
- Backend: Node.js, Express e TypeScript.
- Modelli locali: Ollama per chat ed embedding nomic-embed-text.
- OCR: Python e docTR.
- Visione: Python, Ultralytics YOLO e OpenCV.
- RAG: AnyDoc per i documenti, chunk di testo e ricerca semantica.
- Ricerca web: SearXNG locale.
- Container: Docker e Docker Compose.
- Salvataggio: file locali, cartella OCR e indice Brain.

INSTALLAZIONE:
1. Installare Docker Desktop per Windows: https://www.docker.com/products/docker-desktop/
2. Installare Ollama: https://ollama.com/download/windows
3. Aprire PowerShell e scaricare i modelli locali:
   ollama pull qwen2.5-coder:7b
   ollama pull nomic-embed-text
4. Scaricare il progetto AndreaGPT oppure clonarlo da GitHub.
5. Aprire PowerShell nella cartella del progetto:
   cd C:\Users\utente\Desktop\AndreaGPT
6. Creare il file di configurazione:
   Copiare `.env.example` e rinominarlo `.env`.
   Le chiavi NVIDIA e OpenRouter sono facoltative.
7. Avviare AndreaGPT:
   docker compose up -d --build andreagpt
8. Aprire il browser e visitare:
   http://localhost:3000
9. Per fermare il programma:
   docker compose down

>Docker installa automaticamente Node.js, Python, OCR, YOLO e tutte le librerie necessarie.

RAG:
- Parsing dei documenti (PDF, DOCX, ecc.) e conversione in Markdown con la libreria anydoc
- Crea un riassunto, per rispondere alle domande generiche
- Divisione del testo in chunk 
- Generazione degli embedding con il modello nomic-embed-text
- Indicizzazione vettoriale degli embedding per la ricerca semantica

LIBRERIE:

- AnyDoc: Converte qualsiasi file in file markdown 
- docTR: OCR open source, estrarre testo dalle immagini
- SearXNG: metamotore di ricerca self-hosted e privato
- YOLO: modello di visione per rilevare, segmentare e classificare oggetti in immagini e video
- nomic-embed-text: modello che trasforma testo in vettori per la ricerca semantica e RAG
- Caviman: Progetto per ridurre all'essenziale utilizzo del LLM 


COSA POSSO FARE:
- fare domande su contenuto dei miei documenti 
- ricerche online 
- estrazione testo da immagine OCR 
- analisi semantica o per classificazione di un immagine 
- usare modelli locali e modelli esterni tramite api 
- persoanlizzare il design generale
- definbisci delle istruzioni generali e modo con cui si interfaccia con l'utente

MODELLI: 
- Qwen3.8-27B-GGUF - LOCALE
- Qwen2.5-7B - LOCALE
- MiniMax3 - CONNECT WITH API 

HUGGING FACE: https://huggingface.co/unsloth/Qwen3.8-27B-GGUF

COME IMPLEMNETARE RAG:  https://datamasters.it/blog/come-creare-e-implementare-un-sistema-rag-da-zero/
