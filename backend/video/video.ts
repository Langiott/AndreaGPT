/**
 * Video: file caricato o link (YouTube e simili) → audio WAV mono 16 kHz (ffmpeg) → trascrizione Whisper.
 * Il file arriva in streaming su disco (niente base64 in memoria); la cartella del lavoro si cancella sempre a fine richiesta.
 */
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { fetch as upstreamFetch } from "undici";
import { ollamaTransport } from "../config/config";

const execFileAsync = promisify(execFile);

/** Contesto massimo chiesto a Ollama: la trascrizione intera ci sta quasi sempre (25 min di parlato ≈ 8k token). */
const MAX_CTX = Number(process.env.VIDEO_NUM_CTX) || 32768;
const OUTPUT_TOKENS = 1500;
/** Stima prudente per l'italiano: 3 caratteri per token. */
const tokens = (text: string) => Math.ceil(text.length / 3);

const AVVISO_TRASCRIZIONE = "La trascrizione è automatica: nomi e termini tecnici possono essere storpiati (es. \"qn\" = Qwen, \"enviglia\" = Nvidia): correggili solo quando è evidente.";
const PROMPT_RIASSUNTO = `Riassumi in italiano un video per chi vuole capirlo bene senza guardarlo. Usa solo la trascrizione, non inventare. ${AVVISO_TRASCRIZIONE}
Formato Markdown:
**In breve:** 2-3 frasi con la tesi principale e la conclusione dell'autore.
**Punti chiave:** elenco con i concetti, i confronti, i numeri, i prezzi e i nomi citati.
**Conclusioni e consigli dell'autore:** cosa consiglia di fare o non fare, e perché.
Se cita prodotti, strumenti, siti o risorse aggiungi **Risorse citate:** in elenco. Niente introduzioni, niente conclusioni tue.`;
const PROMPT_DOMANDA = `Rispondi in italiano alla domanda usando solo la trascrizione del video qui sotto: riporta cosa dice l'autore, con numeri e motivazioni. Se la trascrizione non contiene la risposta dillo chiaramente, senza inventare. ${AVVISO_TRASCRIZIONE}`;

export interface VideoChatTurn { role: "user" | "assistant"; content: string }

/** Pezzi della trascrizione divisi a fine frase. */
function pezzi(testo: string, maxChars: number) {
  const parti: string[] = [];
  let resto = testo.trim();
  while (resto.length > maxChars) {
    const finestra = resto.slice(0, maxChars);
    const frase = Math.max(finestra.lastIndexOf(". "), finestra.lastIndexOf("? "), finestra.lastIndexOf("! "));
    const spazio = finestra.lastIndexOf(" ");
    const taglio = frase > maxChars * 0.6 ? frase + 1 : spazio > maxChars * 0.6 ? spazio : maxChars;
    parti.push(resto.slice(0, taglio).trim());
    resto = resto.slice(taglio).trim();
  }
  if (resto) parti.push(resto);
  return parti;
}

/** Trascrizione troppo lunga per una domanda: tiene i pezzi con più parole della domanda, nell'ordine del video. */
function pertinente(testo: string, domanda: string, maxChars: number) {
  if (testo.length <= maxChars) return testo;
  const parole = new Set(domanda.toLowerCase().match(/[\p{L}\d]{4,}/gu) ?? []);
  const parti = pezzi(testo, 2000).map((testo, indice) => ({ testo, indice, punti: (testo.toLowerCase().match(/[\p{L}\d]{4,}/gu) ?? []).filter(parola => parole.has(parola)).length }));
  const scelti: typeof parti = [];
  let totale = 0;
  for (const parte of [...parti].sort((a, b) => b.punti - a.punti)) {
    if (totale + parte.testo.length > maxChars) continue;
    scelti.push(parte);
    totale += parte.testo.length;
  }
  return scelti.sort((a, b) => a.indice - b.indice).map(parte => parte.testo).join("\n[…]\n");
}

export const VIDEO_MAX_BYTES = (Number(process.env.VIDEO_MAX_MB) || 2048) * 1024 * 1024;
export const VIDEO_EXTENSIONS = [".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".mpeg", ".mpg", ".3gp", ".wmv", ".flv", ".ts"];

export interface VideoTranscript { text: string; language: string; duration: number; title: string }

export interface VideoOptions {
  workDir: string;
  ollamaUrl: string;
  /** Trascrive un WAV già normalizzato. */
  transcribe: (file: string) => Promise<{ text?: string; language?: string; duration?: number }>;
}

export function createVideo(options: VideoOptions) {
  const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
  async function ytDlp() {
    if (process.env.YTDLP_PATH?.trim()) return process.env.YTDLP_PATH.trim();
    try { await fs.access("/opt/doctr/bin/yt-dlp"); return "/opt/doctr/bin/yt-dlp"; } catch { return "yt-dlp"; }
  }

  async function lavoro<T>(task: (cartella: string) => Promise<T>) {
    const cartella = path.join(options.workDir, `video-${randomUUID()}`);
    await fs.mkdir(cartella, { recursive: true });
    try { return await task(cartella); } finally { await fs.rm(cartella, { recursive: true, force: true }); }
  }

  async function trascrivi(sorgente: string, cartella: string, title: string): Promise<VideoTranscript> {
    const wav = path.join(cartella, "audio.wav");
    try {
      await execFileAsync(ffmpeg, ["-y", "-i", sorgente, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav], { windowsHide: true, timeout: 20 * 60_000, maxBuffer: 4_000_000 });
    } catch (error) {
      if (/does not contain any stream|Output file .* does not contain|matches no streams/i.test(String((error as { stderr?: string }).stderr ?? error))) throw new Error("Il video non ha una traccia audio.");
      throw new Error(`Estrazione audio non riuscita: ${String((error as { stderr?: string }).stderr ?? error).trim().split("\n").at(-1)?.slice(0, 300)}`);
    }
    const result = await options.transcribe(wav);
    return { text: result.text?.trim() || "", language: result.language || "", duration: result.duration || 0, title };
  }

  // Modello per riassunti e domande: il primo installato tra quelli adatti al testo lungo in italiano.
  const preferiti = [...new Set([process.env.VIDEO_MODEL, process.env.SOCIAL_MODEL, "qwen3:8b", "qwen3:14b", "qwen2.5:7b", "qwen2.5-coder:7b", process.env.CANDIDATURE_MODEL].filter((nome): nome is string => Boolean(nome?.trim())))];
  let modello = preferiti[0];
  let sceltoAlle = 0;
  async function scegliModello() {
    if (Date.now() - sceltoAlle < 5 * 60_000) return modello;
    try {
      const response = await upstreamFetch(`${options.ollamaUrl}/api/tags`, { dispatcher: ollamaTransport, signal: AbortSignal.timeout(10_000) });
      const installati = new Set(((await response.json()) as { models?: Array<{ name: string }> }).models?.map(item => item.name) ?? []);
      const trovato = preferiti.find(nome => installati.has(nome) || installati.has(`${nome}:latest`));
      if (trovato) { modello = trovato; sceltoAlle = Date.now(); }
    } catch { /* Ollama non raggiungibile: resta il modello precedente */ }
    return modello;
  }

  /** Chat Ollama in streaming: ogni pezzo di testo va a onToken, alla fine restituisce tutto. */
  async function chat(messages: Array<{ role: string; content: string }>, signal: AbortSignal, onToken?: (token: string) => void) {
    const model = await scegliModello();
    const usati = messages.reduce((totale, message) => totale + tokens(message.content) + 16, 0);
    const numCtx = Math.min(MAX_CTX, Math.ceil((usati + OUTPUT_TOKENS + 256) / 2048) * 2048);
    const response = await upstreamFetch(`${options.ollamaUrl}/api/chat`, { dispatcher: ollamaTransport, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, stream: true, think: false, keep_alive: "15m", options: { temperature: 0.2, num_ctx: numCtx, num_predict: OUTPUT_TOKENS }, messages }), signal });
    if (!response.ok || !response.body) throw new Error(`Ollama HTTP ${response.status} (modello ${model}).`);
    let testo = "", buffer = "";
    const decoder = new TextDecoder();
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk as Uint8Array, { stream: true });
      const righe = buffer.split("\n");
      buffer = righe.pop() ?? "";
      for (const riga of righe) {
        if (!riga.trim()) continue;
        const evento = JSON.parse(riga) as { message?: { content?: string }; error?: string };
        if (evento.error) throw new Error(evento.error);
        const token = evento.message?.content ?? "";
        if (token) { testo += token; onToken?.(token); }
      }
    }
    return testo.trim();
  }

  /** Spazio per la trascrizione in una sola richiesta, lasciando posto a istruzioni e risposta. */
  const maxTrascrizione = (MAX_CTX - OUTPUT_TOKENS - 1200) * 3;

  return {
    modello: scegliModello,
    /** Riassunto in streaming; una trascrizione oltre il contesto (ore di video) passa prima da appunti per parti. */
    async riassumi(trascrizione: string, signal: AbortSignal, onToken: (token: string) => void, onStato: (stato: string) => void) {
      let materiale = trascrizione;
      for (let giro = 1; materiale.length > maxTrascrizione; giro++) {
        const parti = pezzi(materiale, maxTrascrizione);
        const appunti: string[] = [];
        for (const [indice, parte] of parti.entries()) {
          onStato(`${giro > 1 ? `giro ${giro} · ` : ""}parte ${indice + 1}/${parti.length}`);
          appunti.push(await chat([{ role: "system", content: `Prendi appunti dettagliati in italiano su una parte di un video: tesi, confronti, numeri, prezzi, nomi, consigli. Solo elenco puntato. ${AVVISO_TRASCRIZIONE}` }, { role: "user", content: parte }], signal));
        }
        materiale = appunti.map((testo, indice) => `### Parte ${indice + 1}\n${testo}`).join("\n\n");
      }
      onStato("");
      return chat([{ role: "system", content: PROMPT_RIASSUNTO }, { role: "user", content: `Trascrizione del video:\n\n${materiale}` }], signal, onToken);
    },
    /** Domanda sul video: trascrizione (o i pezzi più pertinenti) + ultimi scambi della chat. */
    async chiedi(trascrizione: string, domanda: string, storia: VideoChatTurn[], signal: AbortSignal, onToken: (token: string) => void) {
      const recenti = storia.slice(-6).map(turno => ({ role: turno.role, content: turno.content.slice(0, 3000) }));
      const spazio = maxTrascrizione - recenti.reduce((totale, turno) => totale + turno.content.length, 0) - domanda.length;
      return chat([{ role: "system", content: `${PROMPT_DOMANDA}\n\nTrascrizione del video:\n${pertinente(trascrizione, domanda, Math.max(6000, spazio))}` }, ...recenti, { role: "user", content: domanda }], signal, onToken);
    },
    /** Video caricato: il corpo della richiesta è il file grezzo. */
    daFile(body: Readable, nome: string) {
      const extension = path.extname(nome).toLowerCase();
      if (!VIDEO_EXTENSIONS.includes(extension)) throw new Error("Formato video non supportato.");
      return lavoro(async cartella => {
        const input = path.join(cartella, `video${extension}`);
        let letti = 0;
        const limite = new Transform({ transform(chunk: Buffer, _encoding, done) { letti += chunk.length; done(letti > VIDEO_MAX_BYTES ? new Error(`Video oltre ${Math.round(VIDEO_MAX_BYTES / 1024 / 1024)} MB.`) : null, chunk); } });
        await pipeline(body, limite, createWriteStream(input));
        if (!letti) throw new Error("Video vuoto.");
        return trascrivi(input, cartella, path.basename(nome, extension));
      });
    },
    /** Link: yt-dlp scarica solo l'audio migliore, poi stessa trascrizione del file. */
    daLink(url: string) {
      let parsed: URL;
      try { parsed = new URL(url.trim()); } catch { throw new Error("Link non valido."); }
      if (!/^https?:$/.test(parsed.protocol)) throw new Error("Link non valido.");
      return lavoro(async cartella => {
        const bin = await ytDlp();
        let stdout = "";
        // YouTube a volte risponde 403 su un URL di stream: un nuovo tentativo ottiene URL nuovi e di solito passa.
        for (let tentativo = 1; ; tentativo++) {
          try {
            // no-certifi: certificati di sistema (CA Norton inclusa); node come runtime JS per le firme di YouTube.
            ({ stdout } = await execFileAsync(bin, ["--no-playlist", "--no-progress", "--compat-options", "no-certifi", "--js-runtimes", "node", "--retries", "10", "--fragment-retries", "10", "-f", "bestaudio/best", "-o", path.join(cartella, "sorgente.%(ext)s"), "--print", "after_move:%(title)s", "--max-filesize", String(VIDEO_MAX_BYTES), parsed.href], { windowsHide: true, timeout: 20 * 60_000, maxBuffer: 4_000_000 }));
            break;
          } catch (error) {
            const message = String((error as { stderr?: string }).stderr || (error as Error).message || error);
            if (/ENOENT|not found|is not recognized/i.test(message)) throw new Error("yt-dlp non installato: ricostruisci il container (Avvia-AndreaGPT.bat).");
            if (tentativo < 4 && /HTTP Error 403/i.test(message)) {
              for (const name of await fs.readdir(cartella)) await fs.rm(path.join(cartella, name), { force: true });
              await new Promise(resolve => setTimeout(resolve, 1500 * tentativo));
              continue;
            }
            throw new Error(`Download non riuscito: ${message.trim().split("\n").filter(line => /ERROR/i.test(line)).at(-1)?.replace(/^ERROR:\s*/, "").slice(0, 300) || message.slice(-300)}`);
          }
        }
        const file = (await fs.readdir(cartella)).find(name => name.startsWith("sorgente."));
        if (!file) throw new Error("Download non riuscito: nessun file ricevuto.");
        return trascrivi(path.join(cartella, file), cartella, stdout.trim().split("\n").at(-1) || parsed.hostname);
      });
    },
  };
}
