# AndreaGPT

AndreaGPT è un assistente locale con interfaccia web, backend Node/Express,
modelli Ollama, archivio documentale Brain/RAG, ricerca Web opzionale e pipeline
per OCR, YOLO, analisi immagini, generazione immagini e molto altro. Il progetto
non è un singolo modello addestrato: è un'orchestrazione di servizi e algoritmi
che scelgono il percorso, recuperano il contesto utile e inviano una richiesta al
modello configurato.

Esistono tre modalità di utilizzo della chat: quella che parla direttamente con
il modello, quella che conversa con il modello e può accedere a fonti web, e
quella che utilizza il Brain, cioè i nostri documenti. Usando il Brain non si
possono fare ricerche online. Lo scopo è avere un'applicazione locale e non
orientata alle ricerche web.


![DRAW/architettura-andreagpt1.drawio](DRAW/architettura.png)



## Brain: come funziona

Brain è l'archivio documentale interrogabile da AndreaGPT. Non è un modello
addestrato e non modifica i pesi di Ollama: prepara il contesto che il modello
userà per rispondere. Quando un documento viene caricato nel Brain, il sistema:

- controlla estensione, dimensione, codifica, percorso e sicurezza del file;
- estrae il testo da file, PDF, Office, CSV, JSON, XML e codice;
- divide il contenuto in chunk conservando file, sezione, righe e pagina;
- crea un embedding per ogni chunk con nomic-embed-text tramite Ollama;
- salva testo, metadati, vettori e citazioni nell'indice;
- costruisce lo snapshot SQLite/FTS5 e, se abilitato, l'indice TurboVec;
- combina ricerca lessicale, vettoriale, refusi e feedback;
- riordina i primi 20 candidati con un cross-encoder multilingue (reranker);
- seleziona pochi estratti pertinenti e li inserisce nel prompt;
- restituisce risposta, fonti, punteggi e diagnostica.

![Schema visuale del flusso Brain/RAG](DRAW/rag.png)


La configurazione predefinita usa chunk di circa 1200 caratteri con sovrapposizione
di 180 caratteri. Il Brain può cercare in tutto l'archivio oppure limitarsi a una
fonte selezionata dal pannello o indicata con @percorso. Dopo aver aggiunto o
modificato documenti bisogna reindicizzare. È possibile anche caricare nel Brain
i tuoi progetti pubblici inserendo il link del progetto, ad esempio:
https://github.com/Langiott/Pianeti_Stelle

## Embedding, reranker e metriche

![Embedding, reranker e metriche](DRAW/embedding-reranker.png)

**nomic-embed-text** è un modello che trasforma un brano di testo in una lista di
768 numeri, chiamata *embedding* o *vettore*. Questi numeri sono come le coordinate
di un punto su una mappa del significato: due brani che parlano della stessa cosa
finiscono in punti vicini, anche se usano parole diverse ("automobile" e "macchina"),
mentre brani su argomenti lontani finiscono in punti distanti. È così che il Brain
riesce a trovare un documento anche quando la domanda non contiene le sue stesse
parole.

Per costruire il vettore, ogni documento viene prima tagliato in pezzi di circa 1200
caratteri, i *chunk*, e ogni chunk viene spezzato in *token*, cioè parole o pezzi di
parola. Il modello (un Transformer della famiglia BERT, chiamato NomicBERT) legge
tutti i token insieme e, grazie alla *self-attention*, dà a ciascuno un significato
che dipende dalle parole vicine: "rete" in "rete neurale" e in "rete da pesca"
riceve due vettori $h_i$ diversi. Alla fine il *mean pooling* fa la media di tutti
questi vettori, $E_{chunk} = \frac{1}{n}\sum_{i=1}^{n} h_i$, e ottiene un unico
vettore che riassume l'intero chunk. Nomic vuole anche sapere che ruolo ha il testo,
per questo i chunk vengono preceduti da `search_document:` (insieme al nome del file
e della sezione) e le domande da `search_query:`.

Quando fai una domanda, anche lei diventa un vettore e il Brain la confronta con
tutti i chunk salvati usando la *similarità coseno*,
$\cos(Q,C) = \frac{Q \cdot C}{\lVert Q \rVert \lVert C \rVert}$, che misura quanto
due vettori puntano nella stessa direzione: vale circa 1 se domanda e chunk parlano
della stessa cosa e scende verso 0 se non c'entrano. A questo punteggio si aggiunge
la ricerca classica per parole esatte (FTS5 di SQLite), utile per nomi propri, codici
e sigle, e si ottengono i 20 chunk più promettenti.

Questo primo passaggio è veloce perché domanda e documenti vengono trasformati in
vettori separatamente (si chiama *bi-encoder*): i vettori dei documenti si calcolano
una volta sola, al caricamento, e a ogni domanda basta confrontare numeri. Il limite
è che il modello non legge mai domanda e brano uno accanto all'altro, quindi a volte
mette in cima un brano che parla dell'argomento ma non risponde davvero. Per questo
interviene il **cross-encoder multilingue**
`cross-encoder/mmarco-mMiniLMv2-L12-H384-v1` (ponte `backend/utils/reranker_bridge.py`),
un secondo modello che riceve insieme la coppia `[domanda + brano]`, li legge come
farebbe una persona e dà un voto di pertinenza, anche se domanda e documento sono in
lingue diverse. È molto più preciso ma anche più lento, quindi non scorre tutto
l'archivio: si limita a riordinare i 20 candidati già trovati. Su 98 domande di prova
la fonte giusta al primo posto (Hit@1) passa dal 63% all'85% e l'MRR da 0,73 a 0,91,
al costo di circa 1,3 s su CPU. Si disattiva da Impostazioni → Ricerca nel Brain o con
`BRAIN_RERANK=0`.

Per sapere se tutto questo funziona servono due tipi di misura. Le metriche di
**retrieval** controllano la ricerca, cioè se tra i brani recuperati c'è quello
giusto e quanto in alto compare; si calcolano su un elenco di domande di prova di cui
si conosce già la fonte corretta (`npm run valuta:brain`, risultati in
`runtime/benchmarks/valutazione-retrieval.json`). Le metriche **semantiche**
controllano invece la risposta, cioè se ciò che il modello ha scritto è davvero
sostenuto dai brani che cita; si calcolano automaticamente a ogni risposta del Brain
e si leggono nella diagnostica.

| Metrica | Famiglia | Come si calcola | Lettura |
|---|---|---|---|
| **Recall@5** | Retrieval | Domande con almeno una fonte giusta nei primi 5 risultati / domande totali | 1 = sempre trovata; 0,4 = trovata solo nel 40% dei casi |
| **MRR** | Retrieval | Media di 1 / posizione della prima fonte giusta (0 se assente) | 1 = sempre 1ª; 0,5 = in media 2ª; 0,2 = 5ª |
| **Hit@1** | Retrieval | Domande con la fonte giusta al 1° posto | Quota di risposte che partono dal brano corretto |
| **nDCG@5** | Retrieval | Dà un punteggio a ogni fonte giusta nei primi 5, che vale di più in alto e di meno in basso (diviso per $\log_2$ della posizione), confrontato con l'ordine perfetto | 1 = tutte le fonti giuste in cima; premia averne più di una e ben ordinate |
| **Copertura** | Retrieval | Temi attesi trovati / temi attesi (domande su due temi) | 1 = entrambi i temi recuperati |
| **Affinità** | Semantica | Somiglianza coseno tra il vettore della risposta e quelli delle fonti usate | ≥ 0,75 forte, 0,65–0,75 media, < 0,65 debole: segnala risposte fuori tema, non dice se sono vere |
| **Groundedness** | Semantica | Frasi sostenute / frasi della risposta | Quanta parte della risposta poggia sulle fonti |
| **Faithfulness** | Semantica | Frasi sostenute / frasi con citazione | Affidabilità delle citazioni; sotto 0,75 compare un avviso |
| **Copertura citazioni** | Semantica | Frasi citate / frasi della risposta | Quanto la risposta dichiara le proprie fonti |

Una frase della risposta è *sostenuta* quando cita una fonte che esiste davvero,
almeno il 40% delle sue parole importanti (articoli e congiunzioni esclusi, confrontate
sulle prime 6 lettere così "neurale" e "neurali" contano uguale) compare nella fonte
citata, e ogni numero che contiene si trova anche nella fonte
(`backend/grounding/grounding.ts`). È un controllo sulle parole, non sul senso: se la
fonte dice "A causa B" e la risposta dice "B causa A", le parole coincidono e il
controllo non se ne accorge. Sul benchmark attuale di 47 domande il Brain trova la
fonte giusta tra le prime 5 nell'85% dei casi (Recall@5 0,85, MRR 0,75, Copertura
0,74); fa più fatica con le domande riformulate con parole diverse dal documento
(Recall@5 0,75, MRR 0,59).

## Modelli e motori utilizzati

| Funzione | Modello o motore | Utilizzo |
|---|---|---|
| Chat locale rapida | openbmb/minicpm5-2b:latest | Chat, scrittura, Brain e codice con bassa latenza |
| Chat locale ragionata | qwen3:14b | Ragionamento, italiano, codice e Brain |
| Coding locale | qwen3-coder:30b-a3b-q4_K_M | Repository, codice e agente locale |
| Agente e revisione | ornith-1.5:9b | Ragionamento, strumenti, codice e conversazioni |
| Embedding Brain | nomic-embed-text | Trasforma documenti e query in vettori |
| Reranker Brain | cross-encoder/mmarco-mMiniLMv2-L12-H384-v1 | Riordina i 20 candidati leggendo domanda e brano insieme |
| Visione Analyze | Qwen/Qwen3-VL-2B-Instruct | Descrizione e analisi delle immagini |
| OCR principale | docTR pretrained | Lettura del testo da immagini e PDF |
| OCR fallback | Tesseract | Alternativa quando docTR non è disponibile |
| YOLO | yolo11n.pt e varianti | Detection, segmentazione, classificazione, pose e OBB |
| Generazione Image | Qwen/Qwen-Image-2.1 | Generazione immagini tramite ComfyUI |
| Generazione rapida | Viggle/Qwen-Image-2.1-viggle-turbo-v0.2.1 | Variante veloce a pochi step |
| Cloud | GLM 5.2 via OpenRouter | Ragionamento e coding a lungo contesto |
| Cloud | Gemma 4 31B via OpenRouter | Modello multimodale Google |
| Cloud | MiniMax M3 via NVIDIA API | Conversazione e contenuti generalisti |
| Ricerca Web | SearXNG, Scrapling, Firecrawl, Perplexity | Fonti aggiornate, testo delle pagine e News |

La lista Ollama viene aggiornata interrogando il catalogo locale: ogni modello
installato con ollama pull può comparire nell'interfaccia. I modelli cloud
richiedono le rispettive chiavi API.

## Micelio: solo visualizzazione

Micelio è la mappa grafica dell'archivio: raccolte, file ed estratti collegati
per similarità coseno, con grado, centralità, betweenness, closeness e vitalità.
Nell'EmbeddingSpace sono disponibili anche i raggruppamenti Micelio (comunità del
grafo) e Fuzzy (temi sfumati). Servono a esplorare l'archivio, **non** influenzano
il ranking delle fonti.

La spinta Micelio e il riordino fuzzy nel retrieval sono stati rimossi dopo la
misura su 51 domande della tesi (`docs/report-micelio-fuzzy-tesi.md`):

| Configurazione | Hit@1 | MRR | nDCG@5 |
|---|---|---|---|
| Base | 0.588 | 0.705 | 0.622 |
| Micelio | 0.608 | 0.716 | 0.622 |
| Fuzzy | 0.118 | 0.221 | 0.191 |
| Base, solo tesi | 0.686 | 0.783 | 0.685 |

Micelio è neutro (p = 1.0), il fuzzy è dannoso (p < 0.001). I guadagni veri
vengono da informazione che l'embedding non ha: la fonte indicata e il reranker,
che legge domanda e brano insieme.

## TurboVec: come funziona

TurboVec è l'acceleratore della ricerca vettoriale. Riceve gli embedding prodotti
dal Brain e individua rapidamente i candidati più vicini, evitando di confrontare
ogni documento completo a ogni domanda. Il flusso visuale completo, dall'embedding
fino al ranking, è disponibile qui:

![Flusso TurboVec e retrieval](DRAW/micelio-turbovec.png)

Il ponte è backend/utils/turbovec_bridge.py e la ricostruzione può essere avviata
da POST /api/brain/turbovec. TurboVec non genera testo, non sceglie il modello e
non certifica le risposte. Se non è disponibile, il sistema usa SQLite/FTS5 o il
percorso legacy, con possibile aumento della latenza.

## Ricerca Web e Scrapling

![Ricerca Web con Scrapling](DRAW/scrapling-web.png)

SearXNG restituisce titoli, URL e snippet di poche righe, spesso insufficienti per
rispondere. Per questo le fonti finali delle modalità Web e News passano dal servizio
**Scrapling** (`scrapling/server.py`, container `andreagpt-scrapling` sulla porta 8090,
variabile `SCRAPLING_URL`), che con una sola chiamata `POST /extract` scarica fino a 8
pagine in parallelo. [Scrapling](https://github.com/D4Vinci/Scrapling) usa il `Fetcher`
HTTP basato su curl_cffi, che imita l'impronta TLS e gli header di Chrome e segue i
redirect, così molti siti che bloccano i client automatici rispondono normalmente;
l'immagine installa solo `scrapling[fetchers]`, senza browser headless, e resta leggera.
L'HTML viene poi ripulito da **trafilatura**, che toglie menu, commenti e pubblicità ed
estrae titolo, data di pubblicazione e testo principale. Le pagine con errore HTTP o con
meno di 200 caratteri utili vengono scartate e ogni fonte entra nel prompt con al
massimo 1500 caratteri, data e citazione. Se il servizio non risponde entro 15 secondi
il backend continua con gli snippet di SearXNG, quindi Scrapling migliora le risposte
ma non è mai un punto di blocco.

## Diagnostica: Fonti, Tempi, Log, Semantic e SHAP

Sotto ogni risposta compaiono dei pulsanti che aprono pannelli chiusi per default e
mostrano cosa è successo dietro le quinte. Si attivano da Impostazioni → Diagnostica e
ognuno risponde a una domanda diversa: da dove viene la risposta, quanto ci ha messo,
cosa è andato storto, dove il modello era insicuro e perché la ricerca ha scelto
quelle fonti.

**Fonti Brain / Fonti Web** mostrano i brani che il modello ha davvero ricevuto per
rispondere, con lo stesso numero che compare nelle citazioni `[Cit. n]` del testo. Per
il Brain si vede il file con le righe e l'estratto completo, per il Web titolo, link e
testo della pagina. Accanto a ogni fonte Brain ci sono 👍 e 👎: dicono al Brain se
quel brano era giusto per quella domanda, e la volta successiva, su domande simili, la
fonte sale o scende in classifica. È l'unico pannello che modifica qualcosa; gli altri
si limitano a osservare.

**Tempi** spiega dove è andato il tempo di attesa. Riporta quanto è durata la ricerca
nei documenti, dopo quanto è arrivata la prima parola e il totale; se è intervenuto il
router locale, quale percorso ha scelto (normale, Brain o Web) e con che sicurezza.
Mostra poi i token letti dal modello (domanda, cronologia e fonti) e quelli scritti,
con la velocità in token al secondo, e infine la scomposizione di Ollama: caricamento
del modello in memoria, lettura del prompt e generazione. Se il caricamento è alto il
modello era "freddo"; se è alta la lettura del prompt, il contesto era molto lungo.

**Log** è il diario della richiesta, una card per ogni fase: REQUEST (richiesta
validata, modello e modalità), ROUTER (percorso scelto), RAG ed EMBEDDING (ricerca nel
Brain), SEARCHX (ricerca Web), MODEL (il modello ha accettato), SEMANTIC (Affinità tra
risposta e fonti) e RESPONSE (controlli sulla lingua, citazioni presenti, inesistenti o
non sostenute). Ogni card ha un'icona: ✓ tutto bene, *i* informazione, **!**
avviso, × errore; il numero sul pulsante conta avvisi ed errori, quindi `Log (0)`
significa che non c'è niente da guardare. Il *Request ID* in cima identifica la
richiesta: cliccandolo si apre il report diagnostico completo, da copiare quando
qualcosa non va.

**Semantic** mostra quanto il modello era sicuro di ogni parola che ha scritto. Mentre
genera, il modello non sceglie una parola sola ma assegna una probabilità a molte
candidate (le *logprobs* di Ollama); AndreaGPT le registra, ricompone i pezzi di
parola e calcola una **confidenza** complessiva, la media geometrica della sicurezza
sulle parole di contenuto (articoli e preposizioni esclusi): alta sopra il 90%, media
sopra il 75%, bassa sotto. Le parole in cui la prima scelta stava sotto il 60% e
un'alternativa superava il 12% sono evidenziate come *incerte*: cliccandone una si
vedono le alternative con la loro probabilità ("1989" 52%, "1991" 31%), e cliccando
un'alternativa si genera un **ramo**, cioè la risposta riscritta da quel punto con
l'altra parola. Una parola incerta non è per forza sbagliata, ma è lì che conviene
controllare, soprattutto su numeri, date e nomi.

**SHAP** (solo con il Brain) spiega quali parole della domanda hanno portato la
ricerca verso le fonti scelte. Il metodo viene dalla teoria dei giochi (*valori di
Shapley*): ogni parola è un "giocatore", e per capire quanto conta si rifà la ricerca
togliendo e rimettendo le parole in tutte le combinazioni possibili, misurando ogni
volta quanto il vettore della domanda resta vicino a quello di ciascuna fonte. Il
contributo di una parola è la media di quanto sposta la somiglianza in tutte queste
combinazioni (calcolo esatto fino a 8 parole, stima su 40 ordini casuali fino a 12).
Il pannello mostra una barra per parola: positiva se avvicina alle fonti, negativa
(in rosso) se allontana, e accanto quante fonti contengono davvero quella parola. Se
la parola chiave della domanda ha una barra piccola o nessuna fonte la contiene, la
ricerca ha seguito altro e conviene riformulare o indicare la fonte con `@percorso`.
Nel *Dettaglio per fonte* la stessa scomposizione è ripetuta per ogni brano.

## Funzionalità disponibili

I menu **File** e **Audio** raggruppano rispettivamente OCR/Converti e Trascrivi/Registra.

| Funzionalità | Pulsante | Descrizione |
|---|---|---|
| **Chat** | <img src="img/README/Screenshot%202026-10-02%20081754.png" alt="Nuova conversazione" height="32"> | Invia la conversazione al modello scelto, in locale con Ollama o verso un provider cloud configurato. Supporta streaming, Markdown, formule, allegati testuali, scelta del modello, temperatura, copia, modifica e nuovo invio. Mostra modello, token, velocità e tempi della richiesta. |
| **Brain** | <img src="img/README/Screenshot%202026-10-02%20081113.png" alt="Brain" height="32"> | Cerca nell'archivio locale prima di generare la risposta. Permette upload, import GitHub, reindicizzazione, filtro per fonte, lettura del documento, citazioni, feedback positivo/negativo e ricostruzione TurboVec. |
| **Micelio** | <img src="img/README/Screenshot%202026-10-02%20081748.png" alt="Micelio" height="32"> | Vista grafica della rete Brain. Serve per esplorare i collegamenti tra raccolte, file ed estratti, capire quali nodi sono centrali e usare un nodo come fonte della chat. |
| **Web** | <img src="img/README/Screenshot%202026-10-02%20081109.png" alt="Web" height="32"> | Attiva la ricerca esterna tramite SearXNG e, se configurati, Firecrawl o Perplexity. Utile per notizie, prezzi, normativa, meteo, versioni recenti e informazioni che cambiano. Mostra titoli, URL ed estratti delle fonti. |
| **Codice** | <img src="img/README/Screenshot%202026-10-02%20081118.png" alt="Codice" height="32"> | Legge il progetto configurato e propone modifiche senza applicarle. Richiede un modello locale Ollama con strumenti. |
| **OCR** | <img src="img/README/Screenshot%202026-10-02%20081144.png" alt="OCR" height="32"> | Dal menu File. Legge testo da immagini e PDF con docTR e Tesseract come fallback. Il testo riconosciuto può essere modificato nell'interfaccia e salvato in OUTPUT/OCR. |
| **Converti** | <img src="img/README/Screenshot%202026-10-02%20081144.png" alt="Converti" height="32"> | Dal menu File. Converte PDF, DOCX, Markdown e TXT, anche in modalità multipla con ZIP. Può correggere tabelle e tradurre Markdown tramite Ollama. I risultati sono scaricabili dal pannello Output. |
| **YOLO** | <img src="img/README/Screenshot%202026-10-02%20081121.png" alt="YOLO" height="32"> | Esegue detection, segmentazione, classificazione, pose e object detection orientata. I risultati e le immagini annotate vengono salvati in OUTPUT/YOLO. |
| **Analyze** | <img src="img/README/Screenshot%202026-10-02%20081130.png" alt="Analyze" height="32"> | Invia immagini a Qwen3-VL per ottenere descrizione e analisi visuale. Diverso da YOLO: Analyze interpreta l'immagine, YOLO restituisce oggetti, classi, coordinate, pose o maschere. |
| **Image** | <img src="img/README/Screenshot%202026-10-02%20081137.png" alt="Image" height="32"> | Genera immagini con Qwen Image 2.1 tramite ComfyUI. Si possono scegliere risoluzione, step, seed e flusso Qwen o Viggle Turbo. Il backend crea un job asincrono, restituisce un jobId e salva il risultato in OUTPUT/Image. |
| **Trascrivi** | <img src="img/README/Screenshot%202026-10-02%20081105.png" alt="Audio" height="32"><br><img src="img/README/Screenshot%202026-10-02%20081310.png" alt="Trascrivi" height="32"> | Dal menu Audio. Trasforma un file audio in testo usando faster-whisper. Il risultato può essere inserito in una nuova conversazione o salvato negli output. |
| **Registra** | <img src="img/README/Screenshot%202026-10-02%20081315.png" alt="Registra" height="32"> | Dal menu Audio. Usa MediaRecorder del browser per registrare dal microfono. Al termine invia l'audio al percorso di trascrizione e riporta il testo nella conversazione. |
| **Compatta chat** | <img src="img/README/Screenshot%202026-10-02%20081303.png" alt="Compatta chat" height="32"> | Esporta la conversazione completa in Markdown mantenendo l'ordine originale. È un'esportazione locale, non un riassunto generato dal modello, e salva il file in OUTPUT/Compatta_chat. |
| **News** | <img src="img/README/Screenshot%202026-10-02%20081141.png" alt="News" height="32"> | Costruisce edizioni su AI, paper scientifici oppure scienza e curiosità. Cerca fonti aggiornate, applica filtri di data e categoria e produce un articolo con citazioni. Se il redattore non è disponibile usa un fallback basato sugli estratti trovati. |

## Struttura dei file

~~~text
AndreaGPT/
├─ backend/                 Backend TypeScript e pipeline Python
│  ├─ index.ts              Server Express e tutte le API HTTP
│  ├─ brain/                Indicizzazione, embedding, store e Micelio
│  ├─ retrieval/            Token, ranking, selezione delle prove
│  ├─ grounding/            Audit delle citazioni e supporto semantico
│  ├─ context/              Costruzione del prompt e budget del contesto
│  ├─ router/               Scelta locale normal/brain/web
│  ├─ search/               Parsing e normalizzazione delle ricerche Web
│  ├─ model/                Catalogo modelli e pipeline Python
│  ├─ code/                 Agente codice, simboli e workspace
│  ├─ diagnostics/          Mainboard, tempi e tracce operative
│  ├─ config/               Configurazione applicativa
│  ├─ http/                 Test del comportamento HTTP
│  └─ utils/                OCR, PDF, worker, audio, TurboVec e helper
├─ frontend/                Interfaccia React/Vite
│  ├─ main.tsx              Entry point dell'applicazione
│  ├─ pages/                Pagina Chat
│  ├─ components/           Brain, Mainboard, conversione e impostazioni
│  ├─ model/                Selezione dei modelli dal client
│  ├─ config/               Lingua e limiti upload Brain
│  ├─ types/                Tipi condivisi del frontend
│  ├─ utils/                Storage, clipboard, stream e conversioni
│  └─ styles/               CSS dell'interfaccia
├─ ANDREA-BRAIN/            Archivio documentale e indici locali
│  ├─ documents/            Documenti personali indicizzabili
│  ├─ progetti/             Materiale dei progetti
│  └─ .index/               Manifest, SQLite, vettori e feedback
├─ OCR/                     Input e output dei processi OCR
├─ OUTPUT/                  Risultati: Image, OCR, YOLO e chat
├─ DRAW/                    Diagrammi Draw.io, SVG e PNG
├─ scripts/                 Avvio, benchmark, test e strumenti
├─ docs/                    Documentazione aggiuntiva
├─ public/                  Logo, icone e asset statici
├─ data/                    Cache e dati runtime locali
├─ searxng/                 Configurazione della ricerca Web
├─ scrapling/               Servizio di estrazione testo delle pagine Web
├─ compose.yaml             Servizi Docker AndreaGPT e SearXNG
├─ Dockerfile               Build Node + ambiente Python
├─ vite.config.ts           Dev server, proxy API e build frontend
└─ package.json             Script e dipendenze JavaScript/TypeScript
~~~




## Librerie e runtime

### JavaScript/TypeScript

| Libreria o runtime | Funzione nel progetto |
|---|---|
| Node.js >= 22.13 | Runtime backend e node:sqlite |
| TypeScript | Tipizzazione statica e controllo con tsc |
| React e React DOM | Interfaccia utente |
| Vite | Sviluppo e build frontend |
| Express | API HTTP e server statico |
| Zod | Validazione stretta dei payload |
| Ollama via HTTP/fetch | Chat ed embedding locali |
| React Markdown, remark-gfm, remark-math, rehype-katex, KaTeX | Markdown, tabelle e formule |
| Lucide React | Icone dell'interfaccia |
| fast-xml-parser | Parsing XML e documenti Office |
| adm-zip | Lettura archivi Office |
| @firecrawl/anydoc | Conversione di PDF e documenti Office in Markdown |
| undici | Trasporto HTTP configurabile |
| dotenv e CORS | Configurazione e accesso controllato |

### Python e strumenti di sistema

| Libreria o strumento | Funzione nel progetto |
|---|---|
| PyTorch e torchvision | Inferenza dei modelli visivi |
| python-doctr | OCR principale |
| Ultralytics | Pipeline YOLO |
| Transformers, diffusers, accelerate | Qwen3-VL e Qwen Image |
| turbovec | Indice vettoriale accelerato |
| faster-whisper | Trascrizione audio |
| Transformers (cross-encoder) | Reranker multilingue dei candidati Brain |
| Scrapling | Download delle pagine Web con impronta Chrome |
| trafilatura | Estrazione del testo principale, titolo e data |
| Pillow, OpenCV, NumPy, SciPy | Immagini e calcolo numerico |
| pdf2docx e pypdfium2 | Gestione e conversione documenti |
| Tesseract | Fallback OCR |
| Poppler | Estrazione e rasterizzazione PDF |
| Pandoc e LibreOffice | Conversione documenti |
| FFmpeg | Supporto ai formati audio/video |

## Concetti chiave implementati

- **RAG locale:** il modello riceve estratti selezionati, non l'intero archivio.
- **Chunk con provenienza:** ogni passaggio conserva file, righe, pagina e citazione.
- **Retrieval ibrido:** FTS5, embedding/coseno e ranking combinato.
- **Reranker:** cross-encoder multilingue sui primi 20 candidati.
- **Metriche:** Recall@5, MRR, nDCG@5 per la ricerca; Affinità, Groundedness e
  Faithfulness per la risposta.
- **Scrapling:** testo completo delle pagine Web al posto degli snippet.
- **Snapshot SQLite atomico:** il manifest pubblica lo store attivo senza interrompere
  le generazioni precedenti.
- **TurboVec:** accelera la ricerca dei candidati senza generare testo.
- **Micelio:** mappa grafica dell'archivio; non entra nel ranking.
- **Grounding:** controlla citazioni, fonti inesistenti e numeri non supportati.
- **Router locale:** seleziona il percorso senza inviare la domanda fuori dal
  computer; Brain e Web manuali restano prioritari.
- **Prompt con budget:** limita cronologia e fonti al contesto disponibile.
- **Lazy loading:** Brain e pipeline costose si caricano solo quando servono.
- **Sicurezza del workspace:** payload, dimensioni, percorsi, symlink e accesso LAN
  vengono controllati.
- **Job asincroni:** la generazione immagini restituisce un jobId.
- **Diagnostica riproducibile:** tempi e fasi sono esposti nella Mainboard.

## Riassunto finale

AndreaGPT unisce una chat locale con un archivio Brain capace di cercare nei
documenti, una mappa Micelio per esplorare le relazioni semantiche, TurboVec che
accelera il recupero e controlli di grounding che mostrano le fonti usate. Attorno
a questo nucleo offre ricerca Web, OCR, YOLO, analisi immagini, generazione Image,
conversione documenti, trascrizione e registrazione audio, esportazione delle chat
e News. Il modello genera la risposta, ma la qualità dipende dal modello scelto,
dai documenti indicizzati e dalla verifica delle fonti.
