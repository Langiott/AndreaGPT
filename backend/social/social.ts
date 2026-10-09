/**
 * Social: post Instagram salvati e con "mi piace" → didascalia + trascrizione Whisper dei video → riassunto Ollama.
 * La sessione è il cookie sessionid in .env (INSTAGRAM_SESSIONID): non passa mai dalle API né dai log; immagini in OUTPUT/Instagram/<codice>.
 */
import { spawn, execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fetch as upstreamFetch } from "undici";
import { ollamaTransport } from "../config/config";

const execFileAsync = promisify(execFile);

export type Fonte = "saved" | "liked";

export interface SocialPost {
  id: string;
  url: string;
  author: string;
  caption: string;
  takenAt?: string;
  sources: Fonte[];
  images: string[];
  transcript?: string;
  summary?: string;
  addedAt: string;
  error?: string;
  /** Eliminato dall'elenco: resta solo per non riscaricarlo. */
  hidden?: boolean;
}

/** Post elencato dallo script: images e videos sono URL della CDN di Instagram, scaricati qui un post alla volta. */
interface Elencato { id: string; url: string; author: string; caption: string; takenAt?: number; sources: Fonte[]; images: string[]; videos: string[] }

/** Passi di ogni post, in quest'ordine. */
export const PASSI = ["media", "trascrizione", "riassunto", "salvataggio"] as const;
type Passo = "lista" | typeof PASSI[number] | "";

export interface SocialOptions {
  dataDir: string;
  mediaDir: string;
  /** Percorso pubblico delle immagini, es. /outputs/Instagram */
  mediaUrl: string;
  python: string;
  fetchScript: string;
  ollamaUrl: string;
  transcribe: (file: string) => Promise<string>;
}

export function createSocial(options: SocialOptions) {
  // Ogni PC ha modelli Ollama diversi: si usa il primo installato, così il riassunto non si blocca su un modello mancante.
  const preferiti = [...new Set([process.env.SOCIAL_MODEL, "qwen3:8b", "qwen2.5:7b", "qwen2.5-coder:7b", process.env.CANDIDATURE_MODEL].filter((nome): nome is string => Boolean(nome?.trim())))];
  let model = preferiti[0];
  let sceltoAlle = 0;
  async function scegliModello() {
    if (Date.now() - sceltoAlle < 5 * 60_000) return model;
    try {
      const response = await upstreamFetch(`${options.ollamaUrl}/api/tags`, { dispatcher: ollamaTransport, signal: AbortSignal.timeout(10_000) });
      const installati = new Set(((await response.json()) as { models?: Array<{ name: string }> }).models?.map(item => item.name) ?? []);
      const trovato = preferiti.find(nome => installati.has(nome) || installati.has(`${nome}:latest`));
      if (trovato) { model = trovato; sceltoAlle = Date.now(); }
    } catch { /* Ollama non raggiungibile: resta il modello precedente */ }
    return model;
  }
  const limite = Number(process.env.SOCIAL_LIMITE) || 30;
  const file = path.join(options.dataDir, "post.json");
  let posts: SocialPost[] | undefined;
  let scrittura = Promise.resolve();
  const stato = { running: false, passo: "" as Passo, corrente: "", fatti: 0, totale: 0, utente: "", ultimo: "", errori: [] as string[] };

  async function carica() {
    if (posts) return posts;
    try { posts = JSON.parse(await fs.readFile(file, "utf8")) as SocialPost[]; } catch { posts = []; }
    return posts;
  }
  function salva() {
    const dati = JSON.stringify(posts ?? [], null, 1);
    scrittura = scrittura.then(async () => { await fs.mkdir(options.dataDir, { recursive: true }); await fs.writeFile(`${file}.tmp`, dati); await fs.rename(`${file}.tmp`, file); });
    return scrittura;
  }
  // Letto a ogni sincronizzazione e passato allo script solo via stdin (mai negli argomenti, visibili in ps).
  const cookie = () => process.env.INSTAGRAM_SESSIONID?.trim() || "";

  function scarica(request: Record<string, unknown>) {
    return new Promise<{ user?: string; posts?: Elencato[]; errors?: string[]; seen?: Record<string, Fonte[]>; error?: string }>((resolve, reject) => {
      const child = spawn(options.python, [options.fetchScript], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      let out = "", err = "";
      const timer = setTimeout(() => child.kill(), 45 * 60_000);
      child.stdout.on("data", chunk => { out += chunk; });
      child.stderr.on("data", chunk => { err = (err + chunk).slice(-2000); });
      child.on("error", reject);
      child.on("close", () => {
        clearTimeout(timer);
        try { resolve(JSON.parse(out.trim().split("\n").at(-1) || "")); }
        catch { reject(new Error(`Lo script Instagram non ha risposto${err ? `: ${err.trim().split("\n").at(-1)}` : "."}`)); }
      });
      child.stdin.end(JSON.stringify(request));
    });
  }

  async function scaricaFile(url: string, target: string) {
    const response = await upstreamFetch(url, { signal: AbortSignal.timeout(180_000) });
    if (!response.ok) throw new Error(`Media non scaricato (HTTP ${response.status}).`);
    await fs.writeFile(target, Buffer.from(await response.arrayBuffer()));
  }

  async function trascrivi(video: string) {
    const wav = video.replace(/\.mp4$/, ".wav");
    try {
      await execFileAsync(process.env.FFMPEG_PATH || "ffmpeg", ["-y", "-i", video, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav], { windowsHide: true, timeout: 300_000, maxBuffer: 2_000_000 });
      return await options.transcribe(wav);
    } catch (error) {
      // Video senza traccia audio: non è un errore del post.
      if (/does not contain any stream|Output file .* does not contain/i.test(String(error))) return "";
      throw error;
    } finally {
      await fs.rm(wav, { force: true });
      await fs.rm(video, { force: true });
    }
  }

  async function riassunto(post: SocialPost) {
    const testo = [`Autore: @${post.author}`, post.caption && `Didascalia:\n${post.caption.slice(0, 4000)}`, post.transcript && `Trascrizione del video:\n${post.transcript.slice(0, 12000)}`].filter(Boolean).join("\n\n");
    const system = "Riassumi in italiano un post Instagram salvato da chi legge per capirlo bene senza riguardarlo. Usa solo didascalia e trascrizione, non inventare. Formato Markdown:\n**In breve:** una o due frasi.\n**Punti chiave:** elenco puntato con i concetti, i passaggi o i consigli concreti (numeri, nomi, strumenti citati).\nSe il post cita link, prodotti, libri o risorse aggiungi **Risorse citate:** in elenco. Niente introduzioni, niente conclusioni.";
    const model = await scegliModello();
    const response = await upstreamFetch(`${options.ollamaUrl}/api/chat`, { dispatcher: ollamaTransport, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, stream: false, think: false, keep_alive: "15m", options: { temperature: 0.2, num_ctx: 8192, num_predict: 700 }, messages: [{ role: "system", content: system }, { role: "user", content: testo }] }), signal: AbortSignal.timeout(300_000) });
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status} (modello ${model}).`);
    return ((await response.json() as { message?: { content?: string } }).message?.content || "").trim();
  }

  /** Un post dall'inizio alla fine: media → trascrizione → riassunto → salvataggio. Gli errori restano sul post. */
  async function elabora(item: Elencato, lista: SocialPost[]) {
    const cartella = path.join(options.mediaDir, item.id);
    const post: SocialPost = { id: item.id, url: item.url, author: item.author, caption: item.caption, takenAt: item.takenAt ? new Date(item.takenAt * 1000).toISOString() : undefined, sources: item.sources, images: [], addedAt: new Date().toISOString() };
    stato.corrente = `@${item.author}`;
    try {
      stato.passo = "media";
      await fs.mkdir(cartella, { recursive: true });
      for (const [index, url] of item.images.entries()) { await scaricaFile(url, path.join(cartella, `img_${index + 1}.jpg`)); post.images.push(`${options.mediaUrl}/${item.id}/img_${index + 1}.jpg`); }
      const video = await Promise.all(item.videos.map(async (url, index) => { const target = path.join(cartella, `video_${index + 1}.mp4`); await scaricaFile(url, target); return target; }));
      stato.passo = "trascrizione";
      const parti: string[] = [];
      for (const file of video) { const testo = await trascrivi(file); if (testo) parti.push(testo); }
      if (parti.length) post.transcript = parti.join("\n\n");
      stato.passo = "riassunto";
      post.summary = await riassunto(post);
    } catch (error) {
      post.error = error instanceof Error ? error.message : String(error);
    }
    stato.passo = "salvataggio";
    lista.unshift(post);
    await salva();
  }

  async function esegui(fonti: Fonte[], max: number) {
    const lista = await carica();
    Object.assign(stato, { errori: [], fatti: 0, totale: 0, passo: "lista", corrente: "" });
    const sessione = cookie();
    if (!sessione) throw new Error("INSTAGRAM_SESSIONID mancante nel file .env.");
    const result = await scarica({ cookie: sessione, sources: fonti, both: fonti.length === 2, limit: max, known: lista.map(post => post.id) });
    if (result.error) throw new Error(result.error);
    stato.utente = result.user || "";
    stato.errori = result.errors ?? [];
    // Post già analizzati ritrovati in un altro feed: si aggiunge la fonte (es. salvato che ora ha anche il mi piace).
    let aggiornati = false;
    for (const post of lista) {
      const nuove = (result.seen?.[post.id] ?? []).filter(fonte => !post.sources.includes(fonte));
      if (nuove.length) { post.sources.push(...nuove); aggiornati = true; }
    }
    if (aggiornati) await salva();
    // Dal più vecchio al più recente: se si interrompe, i post mancanti restano sopra quelli già letti e la prossima volta vengono ripresi.
    const nuovi = (result.posts ?? []).reverse();
    stato.totale = nuovi.length;
    for (const item of nuovi) {
      await elabora(item, lista);
      stato.fatti++;
    }
    stato.ultimo = new Date().toISOString();
  }

  return {
    async elenco() { return { posts: (await carica()).filter(post => !post.hidden), stato: { ...stato, sessione: Boolean(cookie()), sessioneFine: cookie().slice(-4), modello: await scegliModello(), limite } }; },
    sincronizza(scelta: { fonti?: unknown; limite?: unknown } = {}) {
      if (stato.running) return;
      const fonti = Array.isArray(scelta.fonti) ? scelta.fonti.filter((item): item is Fonte => item === "saved" || item === "liked") : [];
      const max = Math.min(Math.max(Math.floor(Number(scelta.limite)) || limite, 1), 500);
      stato.running = true;
      void esegui(fonti.length ? fonti : ["saved", "liked"], max)
        .catch(error => { stato.errori = [error instanceof Error ? error.message : String(error), ...stato.errori]; })
        .finally(() => { Object.assign(stato, { running: false, passo: "", corrente: "" }); });
    },
    async rigenera(id: string) {
      const post = (await carica()).find(item => item.id === id);
      if (!post) throw new Error("Post non trovato.");
      post.summary = await riassunto(post);
      delete post.error;
      await salva();
      return post;
    },
    async elimina(id: string) {
      const post = (await carica()).find(item => item.id === id);
      if (!post) throw new Error("Post non trovato.");
      Object.assign(post, { hidden: true, images: [], caption: "", transcript: undefined, summary: undefined });
      await salva();
      await fs.rm(path.join(options.mediaDir, id.replace(/[^\w-]/g, "")), { recursive: true, force: true });
    },
  };
}
