/**
 * Foto: galleria del telefono via ADB Wi-Fi (debug wireless) → indice locale in data/tools/foto (foto_index.py).
 * Prima passata su tutte le foto, poi solo le nuove: a ogni collegamento e ogni FOTO_CONTROLLO_MIN minuti.
 * Gli originali non restano sul PC: si scaricano, si analizzano e si cancellano; si rileggono dal telefono quando si aprono.
 */
import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Response } from "express";
import { JsonLineWorker } from "../utils/json_line_worker";

const execFileAsync = promisify(execFile);
const ESTENSIONI = ["jpg", "jpeg", "png", "heic", "webp"];
const MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

export interface FotoOptions {
  dataDir: string;
  python: string;
  script: string;
  /** Coda dei lavori pesanti del server: una foto alla volta, così chat e OCR non restano bloccati per ore. */
  heavy: <T>(task: () => Promise<T>) => Promise<T>;
}

type Passo = "" | "collegamento" | "elenco" | "analisi" | "volti";
interface Collegamento { ip: string; porta: number }
interface FileRemoto { remoto: string; size: number; mtime: number }

export function createFoto(options: FotoOptions) {
  const adbBin = process.env.ADB_PATH || "adb";
  // Chiavi ADB nel volume dati: l'associazione col telefono sopravvive ai rebuild del container.
  const adbEnv = { ...process.env, HOME: path.join(options.dataDir, "adb") };
  const cartelle = (process.env.FOTO_CARTELLE || "/sdcard/DCIM,/sdcard/Pictures").split(",").map(item => item.trim()).filter(Boolean);
  const fileCollegamento = path.join(options.dataDir, "collegamento.json");
  const temp = path.join(os.tmpdir(), "andreagpt-foto");
  // Due processi: l'analisi (minuti al primo avvio, per il download dei modelli) non blocca elenco, ricerca e nomi.
  const analisi = new JsonLineWorker(options.python, [options.script, "--serve"], 15 * 60_000, 10 * 60_000);
  const consulta = new JsonLineWorker(options.python, [options.script, "--serve"], 5 * 60_000, 10 * 60_000);
  const stato = { running: false, passo: "" as Passo, fatti: 0, totale: 0, nuove: 0, errori: [] as string[], ultimo: "" };
  let fermare = false;
  // Dopo un riavvio del container il server ADB riparte vuoto: lo stato ritenta l'ultimo IP:porta, al massimo una volta al minuto.
  let ultimoTentativo = 0;

  const indice = <T>(op: string, extra: Record<string, unknown> = {}) => (["analyze", "group", "recheck"].includes(op) ? analisi : consulta).request<T>({ dir: options.dataDir, op, ...extra });

  async function adb(args: string[], timeout = 20_000) {
    await fs.mkdir(adbEnv.HOME, { recursive: true });
    const { stdout, stderr } = await execFileAsync(adbBin, args, { env: adbEnv, timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
    return `${stdout}${stderr}`;
  }

  async function salvato(): Promise<Collegamento | undefined> {
    try { return JSON.parse(await fs.readFile(fileCollegamento, "utf8")) as Collegamento; } catch { return undefined; }
  }

  async function dispositivi() {
    const out = await adb(["devices"]).catch(() => "");
    return out.split("\n").slice(1).map(line => line.trim().split(/\s+/)).filter(parts => parts.length >= 2).map(([seriale, tipo]) => ({ seriale, tipo }));
  }

  /** Seriale del telefono collegato; prova a ricollegare l'ultimo IP:porta se non c'è. */
  async function seriale(ricollega = true) {
    const conf = await salvato();
    const atteso = conf ? `${conf.ip}:${conf.porta}` : "";
    let lista = await dispositivi();
    if (ricollega && conf && !lista.some(item => item.seriale === atteso && item.tipo === "device")) {
      await adb(["connect", atteso], 8_000).catch(() => "");
      lista = await dispositivi();
    }
    return (lista.find(item => item.seriale === atteso && item.tipo === "device") ?? lista.find(item => item.tipo === "device"))?.seriale;
  }

  async function elenca(dispositivo: string): Promise<FileRemoto[]> {
    const nomi = ESTENSIONI.map(ext => `-iname '*.${ext}'`).join(" -o ");
    const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
    const comando = `find ${cartelle.map(quote).join(" ")} -type f \\( ${nomi} \\) ! -path '*/.*' -exec stat -c '%s|%Y|%n' {} + 2>/dev/null; true`;
    const out = await adb(["-s", dispositivo, "shell", comando], 120_000);
    return out.split("\n").map(line => line.trim().match(/^(\d+)\|(\d+)\|(.+)$/)).filter((m): m is RegExpMatchArray => !!m)
      .map(m => ({ size: Number(m[1]), mtime: Number(m[2]), remoto: m[3] }));
  }

  /** Avviso breve per la card: nome del file e cosa non è andato, senza comandi né percorsi. */
  function avvisa(testo: string) {
    if (!stato.errori.includes(testo)) stato.errori = [testo, ...stato.errori].slice(0, 30);
  }

  /** Foto cancellate dal telefono → via anche dall'indice. Se ne mancano troppe è più probabile un errore di lettura: non si tocca niente. */
  async function allineaCancellate(dispositivo: string) {
    const remoti = await elenca(dispositivo);
    const { noti, escluse } = await indice<{ noti: Record<string, [number, number]>; escluse: string[] }>("known");
    const presenti = new Set(remoti.map(item => item.remoto));
    const sparite = [...Object.keys(noti), ...escluse].filter(remoto => !presenti.has(remoto));
    // Controllo di sicurezza: il telefono conferma file per file che non esistono più (una lettura fallita non cancella niente).
    const confermate: string[] = [];
    if (remoti.length) {
      const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
      for (let i = 0; i < sparite.length; i += 80) {
        const blocco = sparite.slice(i, i + 80);
        const out = await adb(["-s", dispositivo, "shell", `for f in ${blocco.map(quote).join(" ")}; do [ -e "$f" ] || echo "$f"; done`], 60_000).catch(() => "");
        const assenti = new Set(out.split("\n").map(line => line.trim()).filter(Boolean));
        confermate.push(...blocco.filter(remoto => assenti.has(remoto)));
      }
    }
    if (confermate.length) await indice("remove", { remoti: confermate });
    return { remoti, noti, escluse };
  }

  async function esegui() {
    Object.assign(stato, { passo: "collegamento", fatti: 0, totale: 0, nuove: 0, errori: [] });
    const dispositivo = await seriale();
    if (!dispositivo) throw new Error("Telefono non collegato.");
    stato.passo = "elenco";
    const { remoti, noti, escluse } = await allineaCancellate(dispositivo);
    for (const remoto of escluse) noti[remoto] = [-1, -1];
    // Più recenti per prime: durante la prima passata le foto utili compaiono subito.
    const nuove = remoti.filter(item => { const noto = noti[item.remoto]; return !noto || (noto[0] !== -1 && (noto[0] !== item.size || noto[1] !== item.mtime)); }).sort((a, b) => b.mtime - a.mtime);
    Object.assign(stato, { passo: "analisi", totale: nuove.length, nuove: nuove.length });
    await fs.mkdir(temp, { recursive: true });
    for (const [numero, item] of nuove.entries()) {
      if (fermare) break;
      const locale = path.join(temp, `${numero}${path.extname(item.remoto).toLowerCase()}`);
      let scaricata = false;
      try {
        await adb(["-s", dispositivo, "pull", item.remoto, locale], 180_000);
        scaricata = true;
        await options.heavy(() => indice("analyze", { path: locale, remote: item.remoto, size: item.size, mtime: item.mtime }));
      } catch (error) {
        // Non scaricata perché cancellata nel frattempo: non è un errore, la toglie l'allineamento.
        const cancellata = !scaricata && /does not exist|No such file/i.test(String((error as { stderr?: string })?.stderr ?? error));
        if (!cancellata) avvisa(`${path.basename(item.remoto)} · ${scaricata ? "analisi non riuscita" : "non scaricata"}`);
      } finally { await fs.rm(locale, { force: true }); }
      stato.fatti++;
      // Durante la prima passata i gruppi di volti compaiono a blocchi e le cancellazioni dal telefono arrivano senza aspettare la fine.
      if (stato.fatti % 200 === 0) {
        await indice("group").catch(() => undefined);
        await allineaCancellate(dispositivo).catch(() => undefined);
      }
    }
    stato.passo = "volti";
    await allineaCancellate(dispositivo).catch(() => undefined);
    await indice("group");
    stato.ultimo = new Date().toISOString();
  }

  /** "Aggiorna": secondo controllo sulle sole foto con persone. Originale dal telefono se collegato, altrimenti la miniatura. */
  async function ricontrollaPersone() {
    Object.assign(stato, { passo: "volti", fatti: 0, totale: 0, nuove: 0, errori: [] });
    const dispositivo = await seriale();
    if (dispositivo) await allineaCancellate(dispositivo).catch(() => undefined);
    const { foto } = await indice<{ foto: Array<{ id: number; remoto: string }> }>("candidates");
    stato.totale = foto.length;
    await fs.mkdir(temp, { recursive: true });
    for (const item of foto) {
      if (fermare) break;
      let originale = "";
      if (dispositivo) {
        originale = path.join(temp, `r${item.id}${path.extname(item.remoto).toLowerCase()}`);
        await adb(["-s", dispositivo, "pull", item.remoto, originale], 180_000).catch(() => { originale = ""; });
      }
      try { await options.heavy(() => indice("recheck", { id: item.id, path: originale || path.join(options.dataDir, "thumbs", `${item.id}.jpg`) })); }
      catch { avvisa(`${path.basename(item.remoto)} · controllo non riuscito`); }
      finally { if (originale) await fs.rm(originale, { force: true }); }
      stato.fatti++;
    }
    await indice("group");
    if (!dispositivo) avvisa("Telefono non collegato: usate le miniature");
    stato.ultimo = new Date().toISOString();
  }

  function avvia(lavoro: () => Promise<void>) {
    if (stato.running) return;
    stato.running = true;
    fermare = false;
    void lavoro()
      .catch(error => { avvisa(error instanceof Error ? error.message.split("\n")[0].slice(0, 120) : String(error)); })
      .finally(() => { Object.assign(stato, { running: false, passo: "" }); });
  }
  const analizza = () => avvia(esegui);

  const minuti = Number(process.env.FOTO_CONTROLLO_MIN ?? 15);
  const controllo = minuti > 0 ? setInterval(() => { void salvato().then(conf => { if (conf && !stato.running) analizza(); }); }, minuti * 60_000) : undefined;
  controllo?.unref();

  return {
    async stato() {
      const ritenta = Date.now() - ultimoTentativo > 60_000;
      if (ritenta) ultimoTentativo = Date.now();
      const [conf, dispositivo, riepilogo] = await Promise.all([salvato(), seriale(ritenta && !stato.running), indice<{ totale: number; categorie: Record<string, number> }>("summary")]);
      return { ...stato, collegato: Boolean(dispositivo), dispositivo: dispositivo ?? "", ip: conf?.ip ?? "", porta: conf?.porta ?? "", foto: riepilogo.totale, categorie: riepilogo.categorie };
    },
    /** indirizzo = IP:porta della schermata Debug wireless; associazione + codice = finestra "Associa con codice" (solo la prima volta). */
    async collega(input: { indirizzo?: unknown; associazione?: unknown; codice?: unknown }) {
      const leggi = (value: unknown) => {
        const m = String(value ?? "").trim().match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/);
        return m && Number(m[2]) <= 65535 ? { ip: m[1], porta: Number(m[2]) } : undefined;
      };
      const indirizzo = leggi(input.indirizzo);
      const codice = String(input.codice ?? "").trim();
      if (!indirizzo && !codice) throw new Error("Indirizzo IP:porta non valido.");
      if (codice) {
        const associazione = leggi(input.associazione);
        if (!associazione || !/^\d{6}$/.test(codice)) throw new Error("Associazione: serve IP:porta e codice a 6 cifre.");
        const out = await adb(["pair", `${associazione.ip}:${associazione.porta}`, codice], 30_000).catch(error => String(error?.stdout || error?.message || error));
        if (!/success/i.test(out)) throw new Error(`Associazione non riuscita: ${out.trim().split("\n").at(-1)}`);
        if (!indirizzo) return { associato: true, collegato: false };
      }
      const { ip, porta } = indirizzo!;
      const out = await adb(["connect", `${ip}:${porta}`], 15_000).catch(error => String(error?.stdout || error?.message || error));
      if (!/connected to/i.test(out)) throw new Error(`Collegamento non riuscito: ${out.trim().split("\n").at(-1)}`);
      await fs.mkdir(options.dataDir, { recursive: true });
      await fs.writeFile(fileCollegamento, JSON.stringify({ ip, porta }));
      analizza();
      return { associato: Boolean(codice), collegato: true };
    },
    analizza,
    ricontrolla: () => avvia(ricontrollaPersone),
    ferma() { fermare = true; },
    lista: (query: Record<string, unknown>) => indice("list", query),
    persone: () => indice("people"),
    dettaglio: (id: number) => indice("detail", { id }),
    rinomina: (id: number, nome: string) => indice("rename", { id, nome }),
    nascondi: (id: number, mostra = false) => indice("hide", { id, mostra }),
    unisci: (id: number, verso: number) => indice("merge", { id, in: verso }),
    elimina: (ids: number[]) => indice<{ tolte: number }>("remove", { ids }),
    volto: (id: number, persona: number | "nuova" | null, nome?: string) => indice("face", { id, persona, nome }),
    /** Originale riletto dal telefono; senza telefono (o HEIC, non visibile nel browser) torna la miniatura. */
    async originale(id: number, response: Response) {
      const { remoto } = await indice<{ remoto: string }>("detail", { id });
      const ext = path.extname(remoto).slice(1).toLowerCase();
      const dispositivo = MIME[ext] ? await seriale(false) : undefined;
      if (!dispositivo) { response.redirect(`/media/foto/thumbs/${id}.jpg`); return; }
      const child = spawn(adbBin, ["-s", dispositivo, "exec-out", `cat '${remoto.replace(/'/g, "'\\''")}'`], { env: adbEnv, windowsHide: true });
      response.setHeader("Content-Type", MIME[ext]);
      response.setHeader("Cache-Control", "private, max-age=3600");
      child.stdout.pipe(response);
      child.on("error", () => response.destroy());
      response.on("close", () => child.kill());
    },
    close() { clearInterval(controllo); analisi.close(); consulta.close(); },
  };
}
