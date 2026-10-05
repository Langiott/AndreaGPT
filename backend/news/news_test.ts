/** Verifica la redazione News per articolo: italiano, fallback singolo e consegna progressiva. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { looksItalian, writeEdition, type NewsArticle, type OllamaChat } from "./news_edition";

const sources = [
  { id: 1, title: "A new benchmark for LLM robustness", url: "https://arxiv.org/abs/2610.00001", description: "We introduce a benchmark with 1,260 manuscripts." },
  { id: 2, title: "Sparse attention at scale", url: "https://arxiv.org/abs/2610.00002", description: "We propose sparse attention that halves latency." },
];
const italian = JSON.stringify({
  titolo: "Un nuovo banco di prova per la robustezza dei modelli",
  sintesi: "Gli autori presentano un benchmark con 1.260 manoscritti per misurare la robustezza dei revisori automatici. Il risultato mostra che la retorica sposta il giudizio.",
  dettagli: "Il metodo confronta versioni controllate dello stesso articolo e valuta 30 revisori.",
  perche_conta: "Serve a capire quanto sono affidabili le revisioni fatte con i modelli.",
  limiti: "Preprint non revisionato.",
});

test("riconosce l'italiano e scarta l'inglese", () => {
  assert.ok(looksItalian("Gli autori presentano un metodo che riduce la latenza per la prima volta con dati del benchmark"));
  assert.ok(!looksItalian("The authors present a method that reduces the latency of the model for the first time"));
});

test("un articolo in inglese ricade sull'estratto solo per quella fonte", async () => {
  const english = JSON.stringify({ titolo: "Sparse attention", sintesi: "The authors propose sparse attention that halves the latency of the model.", dettagli: "", perche_conta: "", limiti: "" });
  const chat: OllamaChat = async (body) => {
    const user = (body as { messages: Array<{ content: string }> }).messages[1].content;
    return { ok: true, status: 200, json: async () => ({ message: { content: user.includes("[1]") ? italian : english } }) };
  };
  const articles: NewsArticle[] = [];
  await writeEdition(chat, "test", sources, new AbortController().signal, article => articles.push(article));
  const byId = new Map(articles.map(article => [article.id, article]));
  assert.equal(byId.get(1)?.fallback, false);
  assert.match(byId.get(1)!.markdown, /^## Un nuovo banco di prova .* \[1\]/);
  assert.match(byId.get(1)!.markdown, /\*\*Limiti\.\*\* Preprint/);
  assert.equal(byId.get(2)?.fallback, true);
  assert.match(byId.get(2)!.markdown, /Estratto originale/);
});
