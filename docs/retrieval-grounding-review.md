# Revisione retrieval e grounding — 30 settembre 2026

## Flusso osservato nel codice

1. `search/search_query.ts` estrae l'ultima domanda, o le ultime due per follow-up espliciti.
2. `brain/brain.ts` carica l'indice JSON oppure lo snapshot SQLite, applica il filtro sorgente, calcola embedding e candidati lessicali/vettoriali.
3. Combina BM25, similarità e regole di ranking; Micelio propaga punteggi fra candidati vicini. Seleziona pochi estratti, non legge integralmente il documento.
4. `grounding/evidence.ts` compatta; `context/context.ts` sceglie gli estratti che entrano nel budget Ollama, stimato dai caratteri.
5. Il modello genera in streaming. Citazioni, numeri e similarità vengono controllati dopo che il testo è già stato mostrato.

## Problemi verificati e correzioni applicate

| Prima | Ora |
| --- | --- |
| Domande contenenti “metodo” venivano ampliate con attention, Dijkstra, heatmap e altri termini fissi. | Nessuna espansione di dominio; la domanda conserva il proprio argomento. Rimossa anche l'espansione specifica Mask RCNN. |
| Sommari e sezioni “in breve” esclusi a priori. | Nessuna esclusione per titolo. Piccolo bonus alle formule solo se richieste; pertinenza primaria. |
| Scelta di una sola fonte per sezione, con rischio di perdere continuazioni. | Per domande dettagliate e con filtro, fino a tre continuazioni della sezione più rilevante fra i candidati, poi altre prove. Limite totale otto. |
| Blocco delle domande metodologiche senza `@file`, oppure senza formule. | Rimosso il blocco specifico. Resta l'astensione generale se non ci sono fonti. Un metodo descrittivo può essere valido. |
| Compattazione poteva eliminare una formula ripetuta accompagnata da definizioni diverse. | Estratti con formule delimitate conservati integralmente durante la compattazione. |
| Fonti recuperate e fonti effettivamente inviate poco distinguibili. | Report con candidati, fonti restituite/inviate/omesse, caratteri e formule delimitate presenti negli estratti. Le omissioni per budget sono contate. |
| Una frase di limitazione poteva saltare il controllo semantico di tutta la risposta. | Il controllo salta solo un'astensione autonoma breve. |
| “Le formule non ci sono” non veniva confrontato con la presenza di formule nel prompt. | Avviso diagnostico se viene negata la presenza di formule ma gli estratti inviati ne contengono. È un controllo euristico, non un verdetto logico. |

La policy comune è in `backend/retrieval/evidence_policy.ts`; audit del contesto e avvisi sono in `backend/grounding/evidence_audit.ts`. Le route coordinano questi moduli.

## Limiti ancora presenti e priorità

1. **Copertura:** otto estratti non garantiscono “tutte le formule”. Non esiste un'esplorazione gerarchica completa indice → sezione → sottosezioni. Le continuazioni aggiunte vengono dai candidati già disponibili, non da una nuova lettura integrale.
2. **Chunking:** i blocchi di circa 1.200 caratteri sono divisi per frasi/righe, senza protezione strutturale di formule multilinea e codice. Gli overlap possono dare intervalli di righe più larghi del testo effettivo. Migliorarlo richiede test dedicati e una migrazione dell'indice: non è stata avviata una reindicizzazione.
3. **Grounding:** citazioni esistenti, numeri presenti e similarità non dimostrano che una frase sia implicata dalle fonti. Manca una verifica delle singole affermazioni con evidenza favorevole/contraria. Gli avvisi arrivano dopo lo streaming e non ritirano il testo.
4. **Budget:** la stima caratteri/token non è il tokenizer del modello; un contesto ridotto può escludere prove corrette. Le metriche ora rendono visibile questa perdita. Aumentare il contesto costa memoria e non risolve automaticamente il ranking.
5. **Valutazione:** il benchmark attuale controlla nomi di documenti con regex. Non misura copertura di formule, correttezza delle citazioni o contraddizioni. Prima di aggiungere un reranker/modello verificatore occorre un piccolo dataset annotato su argomenti diversi, con costi e tempi misurati separatamente.
6. **Altre euristiche:** restano regole preesistenti per identità, ruoli e panoramiche, oltre al feedback e alla propagazione Micelio. Non sono una garanzia generale di pertinenza e vanno valutate sul dataset, senza altre patch per una singola domanda.
7. **Streaming cloud:** il ramo cloud accumula il formato SSE grezzo nel testo da controllare; va separato dal contenuto prima di usare quel grounding come misura affidabile. Questa revisione riguarda il percorso locale e non cambia quel ramo di trasporto.

## Precisazioni rispetto alle diagnosi precedenti

- Il vecchio parser di citazioni già accettava il suffisso `(testo estratto)` perché non era ancorato a fine stringa. Quel suffisso da solo non dimostrava la causa di `semanticSupportChecked=false`.
- Il percorso predefinito sbagliato spiegava il test CLI vuoto. `compose.yaml` imposta esplicitamente `BRAIN_ROOT`: non dimostra che anche l'app Docker stesse usando il percorso sbagliato.
- I punteggi Micelio sono similarità euristiche, non probabilità di correttezza.

## Verifica e perimetro

TypeScript compilato; 49 test mirati passati su Brain, retrieval, contesto e grounding, inclusi metodo descrittivo senza formule, conservazione dei riepiloghi e avvisi sulle formule. Embedding simulati: queste prove verificano regressioni di comportamento, non la qualità reale di Qwen o il ranking dell'intero archivio. Nessuna generazione 27B o benchmark hardware eseguito.

Il prossimo passo utile è il dataset di valutazione e una lettura strutturale delle sezioni. Un ulteriore elenco di parole chiave ad hoc non risolverebbe il problema.
