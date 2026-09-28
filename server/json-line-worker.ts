import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";

type Pending = { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: NodeJS.Timeout; signal?: AbortSignal; abort?: () => void };

export class JsonLineWorker {
  private child?: ChildProcessWithoutNullStreams;
  private lines?: Interface;
  private pending: Pending[] = [];
  private stderr = "";

  constructor(private readonly executable: string, private readonly args: string[], private readonly timeoutMs = 60_000) {}

  request<T>(payload: unknown, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(new Error("Operazione annullata."));
    this.ensureStarted();
    return new Promise<T>((resolve, reject) => {
      const pending: Pending = { resolve: value => resolve(value as T), reject, timer: setTimeout(() => this.failAll(new Error(`Worker Python scaduto dopo ${this.timeoutMs} ms.`)), this.timeoutMs), signal };
      pending.timer.unref?.();
      if (signal) { pending.abort = () => this.failAll(new Error("Operazione annullata.")); signal.addEventListener("abort", pending.abort, { once: true }); }
      this.pending.push(pending);
      this.child!.stdin.write(`${JSON.stringify(payload)}\n`, error => { if (error) this.failAll(error); });
    });
  }

  close() { this.failAll(new Error("Worker chiuso.")); }

  private ensureStarted() {
    if (this.child && !this.child.killed) return;
    this.stderr = "";
    const child = spawn(this.executable, this.args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, PYTHONUNBUFFERED: "1" } });
    this.child = child;
    this.lines = createInterface({ input: child.stdout });
    this.lines.on("line", line => {
      const pending = this.pending.shift();
      if (!pending) return;
      this.clearPending(pending);
      try { const value = JSON.parse(line) as { error?: string }; value?.error ? pending.reject(new Error(value.error)) : pending.resolve(value); }
      catch { pending.reject(new Error(`Risposta worker non valida: ${line.slice(0, 240)}`)); }
    });
    child.stderr.on("data", chunk => { this.stderr = `${this.stderr}${String(chunk)}`.slice(-4000); });
    child.once("error", error => this.failAll(error));
    child.once("exit", code => {
      if (this.child !== child) return;
      this.child = undefined; this.lines?.close(); this.lines = undefined;
      if (this.pending.length) this.rejectPending(new Error(`Worker Python terminato (${code ?? "segnale"}). ${this.stderr}`.trim()));
    });
  }

  private clearPending(pending: Pending) { clearTimeout(pending.timer); if (pending.signal && pending.abort) pending.signal.removeEventListener("abort", pending.abort); }
  private rejectPending(error: Error) { for (const pending of this.pending.splice(0)) { this.clearPending(pending); pending.reject(error); } }
  private failAll(error: Error) { const child = this.child; this.child = undefined; this.lines?.close(); this.lines = undefined; if (child && !child.killed) child.kill(); this.rejectPending(error); }
}
