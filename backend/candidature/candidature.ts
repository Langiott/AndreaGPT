/**
 * Candidature mirate: coda delle offerte, punteggio rispetto al CV, lettera generata e invio via n8n.
 * n8n raccoglie le offerte ogni giorno e invia le email; qui restano coda, punteggio, lettere e approvazione.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fetch as upstreamFetch } from "undici";
import { ollamaTransport } from "../config/config";

export const STATI = ["nuova", "inviata", "scartata", "risposta", "colloquio", "rifiuto"] as const;
export type Stato = typeof STATI[number];

export interface Offerta {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  description: string;
  source: string;
  email?: string;
  foundAt: string;
  score?: number;
  letter?: string;
  subject?: string;
  status: Stato;
  sentAt?: string;
  followUpAt?: string;
  error?: string;
}

export interface OffertaGrezza { title?: unknown; company?: unknown; location?: unknown; url?: unknown; description?: unknown; source?: unknown }

interface Segreti { token: string; webhook: string }

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Indirizzi che non portano a una persona: rispondere lì non serve.
const EMAIL_SCARTATE = /^(no-?reply|noreply|donotreply|privacy|gdpr|dpo|info@adzuna|support)/i;
const GIORNO = 24 * 60 * 60_000;

const testo = (value: unknown, max: number) => typeof value === "string" ? value.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim().slice(0, max) : "";

/** Chiave stabile dell'offerta: stesso annuncio da fonti o pagine diverse non entra due volte. */
export function chiaveOfferta(title: string, company: string, url: string) {
  const firma = company && title ? `${company}|${title}`.toLocaleLowerCase("it-IT").replace(/[^a-z0-9|]+/g, "") : url.replace(/[#?].*$/, "");
  return createHash("sha1").update(firma).digest("hex").slice(0, 16);
}

/** Primo indirizzo email utile nel testo dell'annuncio. */
export function emailDaAnnuncio(description: string) {
  return (description.match(EMAIL) ?? []).map(value => value.toLowerCase()).find(value => !EMAIL_SCARTATE.test(value));
}

/** Normalizza le offerte arrivate da n8n; scarta quelle senza titolo o link valido. */
export function normalizzaOfferte(raw: OffertaGrezza[], now = new Date()): Offerta[] {
  const out = new Map<string, Offerta>();
  for (const item of raw) {
    const title = testo(item.title, 200), company = testo(item.company, 120), url = testo(item.url, 600);
    if (!title || !/^https?:\/\//i.test(url)) continue;
    const description = testo(item.description, 6000);
    const id = chiaveOfferta(title, company, url);
    if (!out.has(id)) out.set(id, { id, title, company, location: testo(item.location, 120), url, description, source: testo(item.source, 40) || "n8n", email: emailDaAnnuncio(description), foundAt: now.toISOString(), status: "nuova" });
  }
  return [...out.values()];
}

export function coseno(a: number[], b: number[]) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Inviate da almeno 7 giorni senza risposta e senza follow-up. */
export function followUpDovuto(offerta: Offerta, now = Date.now()) {
  return offerta.status === "inviata" && !offerta.followUpAt && !!offerta.sentAt && now - Date.parse(offerta.sentAt) >= 7 * GIORNO;
}

export function tokenValido(atteso: string, ricevuto: unknown) {
  if (typeof ricevuto !== "string" || ricevuto.length !== atteso.length) return false;
  return timingSafeEqual(Buffer.from(atteso), Buffer.from(ricevuto));
}

// Workflow n8n. Nomi fissi: una nuova creazione aggiorna quelli esistenti invece di duplicarli.
export const WORKFLOW_RACCOLTA = "AndreaGPT · Raccolta offerte";
export const WORKFLOW_INVIO = "AndreaGPT · Invio candidatura";

/** Codice del nodo n8n che scarica Adzuna Italia (IT) e Remotive (software, remoto) e li normalizza. */
export function codiceRaccolta(adzuna: { id: string; key: string } | undefined, pagine: number) {
  return `const offers = [];
const adzuna = ${JSON.stringify(adzuna ?? null)};
if (adzuna) {
  for (let page = 1; page <= ${pagine}; page++) {
    const data = await this.helpers.httpRequest({ url: \`https://api.adzuna.com/v1/api/jobs/it/search/\${page}\`, qs: { app_id: adzuna.id, app_key: adzuna.key, category: 'it-jobs', results_per_page: 50, max_days_old: 3, sort_by: 'date', 'content-type': 'application/json' }, json: true });
    const results = data.results || [];
    for (const r of results) offers.push({ title: r.title, company: r.company && r.company.display_name, location: r.location && r.location.display_name, url: r.redirect_url, description: r.description, source: 'Adzuna' });
    if (results.length < 50) break;
  }
}
const remote = await this.helpers.httpRequest({ url: 'https://remotive.com/api/remote-jobs', qs: { category: 'software-dev', limit: 300 }, json: true });
const ok = /(italy|italia|europe|emea|cet|worldwide|anywhere)/i;
for (const r of remote.jobs || []) if (!r.candidate_required_location || ok.test(r.candidate_required_location)) offers.push({ title: r.title, company: r.company_name, location: 'Remoto · ' + (r.candidate_required_location || 'ovunque'), url: r.url, description: r.description, source: 'Remotive' });
return [{ json: { offers } }];`;
}

type Nodo = { id: string; name: string; type: string; typeVersion: number; position: [number, number]; parameters: Record<string, unknown>; webhookId?: string; credentials?: Record<string, { id: string; name: string }> };

export function workflowRaccolta(opts: { andreaUrl: string; token: string; webhook: string; adzuna?: { id: string; key: string }; pagine: number; cron: string }) {
  const nodes: Nodo[] = [
    { id: "pianifica", name: "Ogni giorno", type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2, position: [0, 0], parameters: { rule: { interval: [{ field: "cronExpression", expression: opts.cron }] } } },
    { id: "adesso", name: "Raccogli ora", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [0, 200], webhookId: `${opts.webhook}-raccolta`, parameters: { httpMethod: "POST", path: `${opts.webhook}-raccolta`, responseMode: "onReceived", options: {} } },
    { id: "scarica", name: "Scarica offerte", type: "n8n-nodes-base.code", typeVersion: 2, position: [260, 100], parameters: { jsCode: codiceRaccolta(opts.adzuna, opts.pagine) } },
    { id: "consegna", name: "Manda ad AndreaGPT", type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: [520, 100], parameters: { method: "POST", url: `${opts.andreaUrl}/api/candidature/import`, sendHeaders: true, headerParameters: { parameters: [{ name: "X-Candidature-Token", value: opts.token }] }, sendBody: true, specifyBody: "json", jsonBody: "={{ JSON.stringify($json) }}", options: { timeout: 60000 } } },
  ];
  return { name: WORKFLOW_RACCOLTA, nodes, settings: { executionOrder: "v1" }, connections: {
    "Ogni giorno": { main: [[{ node: "Scarica offerte", type: "main", index: 0 }]] },
    "Raccogli ora": { main: [[{ node: "Scarica offerte", type: "main", index: 0 }]] },
    "Scarica offerte": { main: [[{ node: "Manda ad AndreaGPT", type: "main", index: 0 }]] },
  } };
}

export function workflowInvio(opts: { webhook: string; from: string; credential: { id: string; name: string } }) {
  const nodes: Nodo[] = [
    { id: "ricevi", name: "Candidatura approvata", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [0, 0], webhookId: `${opts.webhook}-invio`, parameters: { httpMethod: "POST", path: `${opts.webhook}-invio`, responseMode: "lastNode", options: {} } },
    { id: "allega", name: "Allega CV", type: "n8n-nodes-base.code", typeVersion: 2, position: [260, 0], parameters: { jsCode: "const b = $json.body;\nreturn [{ json: { to: b.to, subject: b.subject, text: b.text }, binary: { cv: { data: b.cv, mimeType: 'application/pdf', fileName: b.cvName, fileExtension: 'pdf' } } }];" } },
    { id: "invia", name: "Invia email", type: "n8n-nodes-base.emailSend", typeVersion: 2.1, position: [520, 0], credentials: { smtp: opts.credential }, parameters: { fromEmail: opts.from, toEmail: "={{ $json.to }}", subject: "={{ $json.subject }}", emailFormat: "text", text: "={{ $json.text }}", options: { attachments: "cv", appendAttribution: false } } },
  ];
  return { name: WORKFLOW_INVIO, nodes, settings: { executionOrder: "v1" }, connections: {
    "Candidatura approvata": { main: [[{ node: "Allega CV", type: "main", index: 0 }]] },
    "Allega CV": { main: [[{ node: "Invia email", type: "main", index: 0 }]] },
  } };
}

export interface CandidatureOptions {
  dataDir: string;
  ollamaUrl: string;
  readCv: () => Promise<{ text: string; pdf?: { name: string; data: Buffer } }>;
}

export function createCandidature(options: CandidatureOptions) {
  const env = process.env;
  const n8nUrl = (env.N8N_URL || "http://127.0.0.1:5678").replace(/\/$/, "");
  const soglia = Number(env.CANDIDATURE_SOGLIA) || 0.62;
  const lettereGiorno = Number(env.CANDIDATURE_LETTERE_GIORNO) || 80;
  const model = env.CANDIDATURE_MODEL || "qwen2.5-coder:7b";
  const file = path.join(options.dataDir, "coda.json");
  const secretFile = path.join(options.dataDir, "segreti.json");
  let coda: Offerta[] | undefined;
  let scrittura = Promise.resolve();
  let lavoro: Promise<void> | undefined;
  let cvEmbedding: { text: string; vector: number[] } | undefined;

  async function carica() {
    if (coda) return coda;
    try { coda = JSON.parse(await fs.readFile(file, "utf8")) as Offerta[]; } catch { coda = []; }
    return coda;
  }
  function salva() {
    // Scritture in fila e via file temporaneo: un crash a metà non corrompe la coda.
    scrittura = scrittura.then(async () => {
      await fs.mkdir(options.dataDir, { recursive: true });
      await fs.writeFile(`${file}.tmp`, JSON.stringify(coda, null, 1));
      await fs.rename(`${file}.tmp`, file);
    });
    return scrittura;
  }
  async function segreti(): Promise<Segreti> {
    try { return JSON.parse(await fs.readFile(secretFile, "utf8")) as Segreti; }
    catch {
      const created = { token: randomBytes(24).toString("hex"), webhook: `andreagpt-${randomBytes(8).toString("hex")}` };
      await fs.mkdir(options.dataDir, { recursive: true });
      await fs.writeFile(secretFile, JSON.stringify(created));
      return created;
    }
  }

  async function embed(texts: string[]) {
    const response = await upstreamFetch(`${options.ollamaUrl}/api/embed`, { dispatcher: ollamaTransport, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "nomic-embed-text", input: texts, truncate: true, keep_alive: "15m" }), signal: AbortSignal.timeout(180_000) });
    if (!response.ok) throw new Error(`Embedding Ollama HTTP ${response.status}.`);
    return (await response.json() as { embeddings: number[][] }).embeddings;
  }
  async function chat(system: string, user: string, maxTokens: number) {
    const response = await upstreamFetch(`${options.ollamaUrl}/api/chat`, { dispatcher: ollamaTransport, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, stream: false, think: false, keep_alive: "15m", options: { temperature: 0.4, num_ctx: 8192, num_predict: maxTokens }, messages: [{ role: "system", content: system }, { role: "user", content: user }] }), signal: AbortSignal.timeout(180_000) });
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status} con ${model}.`);
    return ((await response.json() as { message?: { content?: string } }).message?.content || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  }
  async function vettoreCv() {
    const cv = await options.readCv();
    if (cvEmbedding?.text !== cv.text) cvEmbedding = { text: cv.text, vector: (await embed([`search_query: ${cv.text.slice(0, 6000)}`]))[0] };
    return cvEmbedding.vector;
  }

  async function scriviLettera(offerta: Offerta) {
    const cv = (await options.readCv()).text.slice(0, 6000);
    const lettera = await chat(
      "Scrivi lettere di candidatura in italiano corretto, registro formale (dai del Lei all'azienda, mai del tu). Apri con 'Gentile team di selezione di <azienda>,' e chiudi con 'Cordiali saluti,' e il nome del CV. Usa solo fatti presenti nel CV: niente esperienze, numeri o tecnologie inventate. Niente formule vuote ('sono una persona motivata', 'sono confidente'). Massimo 170 parole, 3 paragrafi brevi. Niente oggetto, niente segnaposto tra parentesi.",
      `CV:\n${cv}\n\nOFFERTA: ${offerta.title} presso ${offerta.company || "azienda non indicata"} (${offerta.location})\n${offerta.description.slice(0, 2500)}\n\nScrivi la lettera: aggancia 2-3 requisiti dell'offerta a esperienze concrete del CV.`,
      450,
    );
    if (!lettera) throw new Error("Lettera vuota dal modello.");
    return lettera;
  }

  /** Punteggi e lettere in background: n8n riceve risposta subito. */
  function elabora() {
    lavoro ??= (async () => {
      const lista = await carica();
      const senzaPunteggio = lista.filter(item => item.status === "nuova" && item.score === undefined);
      if (senzaPunteggio.length) {
        const cv = await vettoreCv();
        for (let i = 0; i < senzaPunteggio.length; i += 16) {
          const batch = senzaPunteggio.slice(i, i + 16);
          const vectors = await embed(batch.map(item => `search_document: ${item.title}. ${item.company}. ${item.description.slice(0, 1500)}`));
          batch.forEach((item, index) => { item.score = Number(coseno(cv, vectors[index]).toFixed(3)); });
          await salva();
        }
      }
      const oggi = new Date().toISOString().slice(0, 10);
      let scritte = lista.filter(item => item.letter && item.foundAt.startsWith(oggi)).length;
      const daScrivere = lista.filter(item => item.status === "nuova" && !item.letter && (item.score ?? 0) >= soglia).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      for (const item of daScrivere) {
        if (scritte >= lettereGiorno) break;
        try { item.letter = await scriviLettera(item); item.subject = `Candidatura: ${item.title}`; item.error = undefined; scritte++; }
        catch (error) { item.error = error instanceof Error ? error.message : "Lettera non generata."; }
        await salva();
      }
    })().finally(() => { lavoro = undefined; });
    return lavoro;
  }

  async function importa(raw: OffertaGrezza[]) {
    const lista = await carica();
    const note = new Set(lista.map(item => item.id));
    const nuove = normalizzaOfferte(raw).filter(item => !note.has(item.id));
    lista.push(...nuove);
    await salva();
    void elabora().catch(error => console.warn(`Candidature: ${error instanceof Error ? error.message : error}`));
    return { ricevute: raw.length, nuove: nuove.length, totale: lista.length };
  }

  async function elenco() {
    const lista = await carica();
    const now = Date.now();
    return {
      offerte: [...lista].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).map(item => ({ ...item, followUp: followUpDovuto(item, now) })),
      elaborazione: Boolean(lavoro), soglia, model,
    };
  }

  async function trova(id: string) {
    const item = (await carica()).find(entry => entry.id === id);
    if (!item) throw new Error("Offerta non trovata.");
    return item;
  }

  async function n8n(pathname: string, init: { method?: string; body?: unknown } = {}) {
    const key = env.N8N_API_KEY?.trim();
    if (!key) throw new Error("N8N_API_KEY mancante nel file .env.");
    const response = await upstreamFetch(`${n8nUrl}/api/v1${pathname}`, { method: init.method || "GET", headers: { "X-N8N-API-KEY": key, "Content-Type": "application/json", Accept: "application/json" }, body: init.body === undefined ? undefined : JSON.stringify(init.body), signal: AbortSignal.timeout(20_000) })
      .catch(() => { throw new Error(`n8n non raggiungibile su ${n8nUrl}.`); });
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new Error(`n8n ${pathname} HTTP ${response.status}: ${String(data.message || "").slice(0, 200)}`);
    return data;
  }

  async function webhook(kind: "invio" | "raccolta", body: unknown) {
    const { webhook: base } = await segreti();
    const response = await upstreamFetch(`${n8nUrl}/webhook/${base}-${kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) })
      .catch(() => { throw new Error(`n8n non raggiungibile su ${n8nUrl}.`); });
    if (response.status === 404) throw new Error("Workflow n8n non attivo: premi Crea workflow.");
    if (!response.ok) throw new Error(`n8n ${kind} HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }

  async function invia(id: string, overrides: { letter?: string; subject?: string; to?: string }) {
    const item = await trova(id);
    const to = overrides.to || item.email;
    if (!to) throw new Error("Offerta senza email: candidati dal link.");
    const letter = overrides.letter ?? item.letter;
    if (!letter) throw new Error("Lettera mancante.");
    const pdf = (await options.readCv()).pdf;
    if (!pdf) throw new Error("Per l'invio serve il CV in PDF in ANDREA-BRAIN/CV.");
    const followUp = item.status === "inviata";
    const subject = overrides.subject ?? (followUp ? `Re: ${item.subject || `Candidatura: ${item.title}`}` : item.subject || `Candidatura: ${item.title}`);
    await webhook("invio", { to, subject, text: letter, cv: pdf.data.toString("base64"), cvName: pdf.name });
    if (followUp) item.followUpAt = new Date().toISOString();
    else Object.assign(item, { status: "inviata", sentAt: new Date().toISOString(), letter, subject, email: to, error: undefined });
    await salva();
    return item;
  }

  async function aggiorna(id: string, patch: { status?: Stato; letter?: string; subject?: string }) {
    const item = await trova(id);
    if (patch.status === "inviata" && item.status === "nuova") item.sentAt = new Date().toISOString();
    Object.assign(item, Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)));
    await salva();
    return item;
  }

  async function lettera(id: string, tipo: "candidatura" | "followup") {
    const item = await trova(id);
    if (tipo === "candidatura") { item.letter = await scriviLettera(item); item.subject ??= `Candidatura: ${item.title}`; await salva(); return { letter: item.letter }; }
    const testoFollowUp = await chat("Scrivi follow-up brevi in italiano, cortesi e concreti, massimo 80 parole, senza segnaposto. Firma con il nome del CV.", `CV (solo per il nome):\n${(await options.readCv()).text.slice(0, 600)}\n\nUna settimana fa mi sono candidato per ${item.title} presso ${item.company}. Scrivi il follow-up.`, 200);
    return { letter: testoFollowUp };
  }

  async function creaWorkflow(andreaUrl: string) {
    const { token, webhook: base } = await segreti();
    const adzuna = env.ADZUNA_APP_ID && env.ADZUNA_APP_KEY ? { id: env.ADZUNA_APP_ID, key: env.ADZUNA_APP_KEY } : undefined;
    const smtp = { host: env.SMTP_HOST, port: Number(env.SMTP_PORT) || 465, user: env.SMTP_USER, password: env.SMTP_PASSWORD };
    if (!smtp.host || !smtp.user || !smtp.password) throw new Error("SMTP_HOST, SMTP_USER e SMTP_PASSWORD mancanti nel file .env.");
    const esistenti = ((await n8n("/workflows?limit=250")).data ?? []) as Array<{ id: string; name: string }>;
    // Una sola credenziale SMTP: quella vecchia si toglie dopo aver rimosso i workflow che la usano.
    const vecchieCredenziali = ((await n8n("/credentials?limit=250").catch(() => ({ data: [] }))).data ?? []) as Array<{ id: string; name: string }>;
    const credenziale = await n8n("/credentials", { method: "POST", body: { name: "AndreaGPT SMTP", type: "smtp", data: { user: smtp.user, password: smtp.password, host: smtp.host, port: smtp.port, secure: smtp.port === 465 } } }) as { id: string; name: string };
    const definizioni = [
      workflowRaccolta({ andreaUrl, token, webhook: base, adzuna, pagine: Math.min(20, Number(env.ADZUNA_PAGINE) || 10), cron: env.CANDIDATURE_CRON || "30 7 * * *" }),
      workflowInvio({ webhook: base, from: env.SMTP_FROM || smtp.user, credential: { id: credenziale.id, name: credenziale.name } }),
    ];
    const creati = [];
    for (const definizione of definizioni) {
      // Il workflow precedente va disattivato e cancellato: i webhook con lo stesso path non possono coesistere.
      for (const vecchio of esistenti.filter(item => item.name === definizione.name)) {
        await n8n(`/workflows/${vecchio.id}/deactivate`, { method: "POST" });
        // n8n 2.x disattiva in modo asincrono: la cancellazione risponde 409 finché non ha finito.
        for (let tentativo = 1; ; tentativo++) {
          try { await n8n(`/workflows/${vecchio.id}`, { method: "DELETE" }); break; }
          catch (error) { if (tentativo >= 15 || !/HTTP 409/.test(String(error))) throw error; await new Promise(resolve => setTimeout(resolve, 1000)); }
        }
      }
      const creato = await n8n("/workflows", { method: "POST", body: definizione }) as { id: string };
      await n8n(`/workflows/${creato.id}/activate`, { method: "POST" });
      creati.push({ id: creato.id, name: definizione.name, url: `${(env.N8N_PUBLIC_URL || "http://127.0.0.1:5678").replace(/\/$/, "")}/workflow/${creato.id}` });
    }
    for (const vecchia of vecchieCredenziali.filter(item => item.name === "AndreaGPT SMTP")) await n8n(`/credentials/${vecchia.id}`, { method: "DELETE" }).catch(() => undefined);
    return { workflows: creati, adzuna: Boolean(adzuna) };
  }

  async function stato() {
    const cv = await options.readCv().then(value => ({ ok: true, pdf: Boolean(value.pdf) }), (error: Error) => ({ ok: false, pdf: false, error: error.message }));
    let n8nOk = false, workflow = false;
    try { const data = (await n8n("/workflows?limit=250")).data as Array<{ name: string; active: boolean }>; n8nOk = true; workflow = [WORKFLOW_RACCOLTA, WORKFLOW_INVIO].every(name => data.some(item => item.name === name && item.active)); } catch { /* n8n spento o chiave assente. */ }
    return { cv, n8n: n8nOk, workflow, apiKey: Boolean(env.N8N_API_KEY?.trim()), smtp: Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD), adzuna: Boolean(env.ADZUNA_APP_ID && env.ADZUNA_APP_KEY) };
  }

  return { importa, elenco, invia, aggiorna, lettera, creaWorkflow, stato, segreti, raccogliOra: () => webhook("raccolta", {}) };
}
