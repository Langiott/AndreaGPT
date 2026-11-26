// Prova il modello locale dell'ufficio sulle frasi che le regole dirette non coprono.
// Uso: npx tsx scripts/test/office_llm.ts [modello]   (Ollama acceso, OLLAMA_BASE_URL opzionale)
import { modelInstructions } from "../../backend/office/office";
import { planSchema } from "../../backend/office/office_schema";
import { directOfficeIntent } from "../../backend/office/office_requests";
import { OLLAMA_MODEL } from "../../backend/model/models";

const base = (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/$/, "");
const model = process.argv[2] || process.env.OFFICE_MODEL || OLLAMA_MODEL;
const today = new Date().toISOString().slice(0, 10);

// [frase, azione attesa nella prima posizione, controllo opzionale]
const cases: [string, string, ((plan: any) => boolean)?][] = [
  ["salva una nota: comprare il latte e le uova", "add", plan => plan.actions[0].entry?.kind === "note"],
  ["aggiungi abbonamento Netflix 13 euro al mese", "add", plan => plan.actions[0].entry?.kind === "subscription" && plan.actions[0].entry.amount === 13],
  ["segna un appuntamento dal dentista domani alle 15", "add", plan => plan.actions[0].entry?.kind === "appointment" && plan.actions[0].entry.time === "15:00"],
  ["trovami il documento del contratto d'affitto", "list", plan => plan.actions[0].kind === "document"],
  ["mostrami le carte di one piece che ho", "searchCollections"],
  ["quante carte ho nella collezione one piece?", "collectionStats"],
  ["crea la collezione Vinili", "createCollection"],
  ["rinomina la collezione Vinili in Dischi", "renameCollection"],
  ["elimina l'abbonamento Spotify", "remove", plan => plan.actions[0].kind === "subscription"],
  ["il rinnovo di Netflix è il 5 dicembre", "edit", plan => plan.actions[0].kind === "subscription"],
  ["che film devo ancora vedere?", "list", plan => plan.actions[0].kind === "film"],
  ["aggiungi il film Dune parte due", "add", plan => plan.actions[0].entry?.kind === "film"],
  ["salva nella collezione Fumetti il numero 1 di Dylan Dog", "addItem"],
  ["cerca Luffy nelle collezioni", "searchCollections"],
  ["quali documenti scadono nei prossimi 30 giorni?", "list", plan => plan.actions[0].days === 30],
];

async function classify(text: string) {
  const messages = [{ role: "system", content: modelInstructions(today, "Europe/Rome") }, { role: "user", content: text }];
  const response = await fetch(`${base}/api/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false, think: false, format: "json", options: { temperature: 0, num_ctx: 8192, num_predict: 800 } }),
  });
  if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
  const raw = ((await response.json()) as { message?: { content?: string } }).message?.content ?? "";
  const parsed: unknown = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/gi, ""));
  const input = Array.isArray(parsed) ? { actions: parsed } : parsed && typeof parsed === "object" && "action" in parsed ? { actions: [parsed] } : parsed;
  return planSchema.parse(input);
}

let passed = 0;
console.log(`Modello: ${model} · ${base}`);
for (const [text, expected, check] of cases) {
  if (directOfficeIntent(text, false, today)) { console.log(`--  ${text}  (gestita dalle regole dirette, salto)`); continue; }
  const started = performance.now();
  try {
    const plan = await classify(text);
    const action = plan.actions[0].action;
    const ok = action === expected && (!check || check(plan));
    if (ok) passed++;
    console.log(`${ok ? "OK" : "XX"}  ${text}  → ${JSON.stringify(plan.actions)}  (${Math.round(performance.now() - started)} ms)`);
  } catch (error) {
    console.log(`XX  ${text}  → errore: ${error instanceof Error ? error.message.slice(0, 160) : error}`);
  }
}
console.log(`\n${passed}/${cases.length} corrette`);
