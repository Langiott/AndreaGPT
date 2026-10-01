import { routeLocally, type LocalRoute } from "../../backend/router/router";

const cases: Array<{ text: string; expected: LocalRoute }> = [
  { text: "Scrivi una filastrocca breve su un gatto.", expected: "normal" },
  { text: "Spiegami in parole semplici che cos'è una closure JavaScript.", expected: "normal" },
  { text: "Riscrivi questa frase in tono professionale: ci sentiamo dopo.", expected: "normal" },
  { text: "Traduci in inglese: buongiorno a tutti.", expected: "normal" },
  { text: "Calcola 17 per 24.", expected: "normal" },
  { text: "Crea una funzione TypeScript che ordina un array.", expected: "normal" },
  { text: "Correggi la grammatica di questo paragrafo.", expected: "normal" },
  { text: "Inventami un nome per una caffetteria.", expected: "normal" },
  { text: "Che differenza c'è tra classe e interfaccia?", expected: "normal" },
  { text: "Fammi un esempio di espressione regolare.", expected: "normal" },
  { text: "Spiegami la ricorsione, ora.", expected: "normal" },
  { text: "Come si calcola il prezzo con IVA?", expected: "normal" },
  { text: "Scrivi il calendario delle cose da fare.", expected: "normal" },
  { text: "Spiegami cosa sono le notizie false.", expected: "normal" },
  { text: "Ora che ci penso, spiegami Python.", expected: "normal" },
  { text: "Che tempo farà domani a Roma?", expected: "web" },
  { text: "Qual è il prezzo attuale del Bitcoin?", expected: "web" },
  { text: "Cerca le ultime notizie pubblicate oggi su OpenAI.", expected: "web" },
  { text: "Verifica online chi è il CEO attuale di NVIDIA.", expected: "web" },
  { text: "Dammi il link del sito ufficiale di TypeScript.", expected: "web" },
  { text: "Qual è la classifica di Serie A oggi?", expected: "web" },
  { text: "Cerca sul web la versione più recente di Node.js.", expected: "web" },
  { text: "Qual è il cambio euro dollaro adesso?", expected: "web" },
  { text: "Controlla la normativa vigente sulla privacy.", expected: "web" },
  { text: "Quali sono i risultati delle partite di ieri?", expected: "web" },
  { text: "Secondo i miei documenti, chi è Nova?", expected: "brain" },
  { text: "Nel progetto indicizzato, dove viene definita la classe Osservazione?", expected: "brain" },
  { text: "Riassumi il contratto che ho caricato nel Brain.", expected: "brain" },
  { text: "Cerca nel Brain le informazioni su Andrea.", expected: "brain" },
  { text: "In quale file del mio progetto è implementato il router?", expected: "brain" },
  { text: "Dai miei appunti, estrai le scadenze.", expected: "brain" },
  { text: "Nel repository, dove è dichiarata questa funzione?", expected: "brain" },
  { text: "Usa i file indicizzati per descrivere il personaggio.", expected: "brain" },
  { text: "Che cosa dice il documento che ho caricato?", expected: "brain" },
  { text: "Secondo il mio contratto salvato nel Brain, qual è la durata?", expected: "brain" },
];

const threshold = Math.min(1, Math.max(0, Number(process.env.LOCAL_ROUTER_THRESHOLD) || 0.75));
const rows = cases.map((item) => ({ ...item, decision: routeLocally(item.text), baseline: "normal" as LocalRoute }));
const accepted = rows.filter((row) => row.decision.confidence >= threshold);
const correct = rows.filter((row) => row.decision.route === row.expected).length;
const acceptedCorrect = accepted.filter((row) => row.decision.route === row.expected).length;
const baselineCorrect = rows.filter((row) => row.baseline === row.expected).length;
const mistakes = rows.filter((row) => row.decision.route !== row.expected).map((row) => ({ question: row.text, expected: row.expected, actual: row.decision.route, confidence: row.decision.confidence, signals: row.decision.signals }));
const latency = rows.map((row) => row.decision.latencyMs).sort((a, b) => a - b);
const mean = latency.reduce((sum, value) => sum + value, 0) / latency.length;

console.log(JSON.stringify({
  samples: rows.length,
  threshold,
  before: { strategy: "sempre normal", correct: baselineCorrect, accuracy: baselineCorrect / rows.length },
  after: {
    correct,
    accuracy: correct / rows.length,
    coverage: accepted.length / rows.length,
    acceptedAccuracy: accepted.length ? acceptedCorrect / accepted.length : 0,
    averageLatencyMs: Number(mean.toFixed(4)),
    p50LatencyMs: latency[Math.floor(latency.length * 0.5)],
    p95LatencyMs: latency[Math.floor(latency.length * 0.95)],
  },
  improvementPoints: Number(((correct - baselineCorrect) / rows.length * 100).toFixed(1)),
  mistakes,
}, null, 2));

if (mistakes.length || acceptedCorrect !== accepted.length) process.exitCode = 1;
