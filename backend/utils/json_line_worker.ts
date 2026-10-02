/**
 * Gestisce un processo esterno che comunica con una riga JSON alla volta.
 * Serve per usare gli script Python senza bloccare il server.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";

type Pending = { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: NodeJS.Timeout; signal?: AbortSignal; abort?: () => void };

export class JsonLineWorker {
  private child?: ChildProcessWithoutNullStreams;
  private lines?: Interface;
  private pending: Pending[] = [];
  private stderr = "";
  /** Vero dopo la riga {"ready":true} dello script (solo per gli script che la inviano, es. il reranker). */
  ready = false;

  /** Prepara il processo esterno, senza avviarlo fino alla prima richiesta. */
  private idleTimer?: NodeJS.Timeout;

  /** idleMs > 0: dopo tanti ms senza richieste il processo si chiude e libera la RAM (si riavvia alla richiesta successiva). */
  constructor(private readonly executable: string, private readonly args: string[], private readonly timeoutMs = 60_000, private readonly idleMs = 0) {}

  /** Invia una richiesta JSON e attende la risposta dello script Python. */
  request<T>(payload: unknown, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(new Error("Operazione annullata."));
    clearTimeout(this.idleTimer);
    this.ensureStarted();
    return new Promise<T>((resolve, reject) => {
      const pending: Pending = { resolve: value => resolve(value as T), reject, timer: setTimeout(() => this.failAll(new Error(`Worker Python scaduto dopo ${this.timeoutMs} ms.`)), this.timeoutMs), signal };
      pending.timer.unref?.();
      if (signal) { pending.abort = () => this.failAll(new Error("Operazione annullata.")); signal.addEventListener("abort", pending.abort, { once: true }); }
      this.pending.push(pending);
      this.child!.stdin.write(`${JSON.stringify(payload)}\n`, error => { if (error) this.failAll(error); });
    });
  }

  /** Chiude il processo e rifiuta le richieste ancora aperte. */
  close() { this.failAll(new Error("Worker chiuso.")); }

  /** Avvia il processo in anticipo (riscaldamento), senza inviare richieste. */
  start() { this.ensureStarted(); }

  /** Avvia il processo esterno solo quando serve. */
  private ensureStarted() {
    if (this.child && !this.child.killed) return;
    this.stderr = "";
    this.ready = false;
    const child = spawn(this.executable, this.args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, PYTHONUNBUFFERED: "1" } });
    this.child = child;
    this.lines = createInterface({ input: child.stdout });
    this.lines.on("line", line => {
      if (line.startsWith('{"ready"')) { this.ready = true; return; }
      const pending = this.pending.shift();
      if (!pending) return;
      this.clearPending(pending);
      try { const value = JSON.parse(line) as { error?: string }; value?.error ? pending.reject(new Error(value.error)) : pending.resolve(value); }
      catch { pending.reject(new Error(`Risposta worker non valida: ${line.slice(0, 240)}`)); }
      if (this.idleMs && !this.pending.length) {
        this.idleTimer = setTimeout(() => { if (!this.pending.length) this.failAll(new Error("Worker chiuso per inattività.")); }, this.idleMs);
        this.idleTimer.unref?.();
      }
    });
    child.stderr.on("data", chunk => { this.stderr = `${this.stderr}${String(chunk)}`.slice(-4000); });
    child.once("error", error => this.failAll(error));
    // Senza questi listener un EPIPE (Python morto mentre gli scriviamo) diventa un'eccezione non gestita e spegne il server.
    for (const stream of [child.stdin, child.stdout, child.stderr]) stream.on("error", error => { if (this.child === child) this.failAll(error); });
    child.once("exit", code => {
      if (this.child !== child) return;
      this.child = undefined; this.lines?.close(); this.lines = undefined;
      if (this.pending.length) this.rejectPending(new Error(`Worker Python terminato (${code ?? "segnale"}). ${this.stderr}`.trim()));
    });
  }

  /** Cancella il timer e l'ascolto di annullamento di una richiesta. */
  private clearPending(pending: Pending) { clearTimeout(pending.timer); if (pending.signal && pending.abort) pending.signal.removeEventListener("abort", pending.abort); }
  /** Chiude tutte le richieste ancora in attesa con lo stesso errore. */
  private rejectPending(error: Error) { for (const pending of this.pending.splice(0)) { this.clearPending(pending); pending.reject(error); } }
  /** Ferma il processo e chiude tutte le richieste aperte. */
  private failAll(error: Error) { const child = this.child; this.child = undefined; this.lines?.close(); this.lines = undefined; if (child && !child.killed) child.kill(); this.rejectPending(error); }
}
