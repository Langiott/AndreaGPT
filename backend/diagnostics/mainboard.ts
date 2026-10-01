/**
 * Raccoglie risorse, attivita e log solo mentre Mainboard e aperta.
 * Prepara dati compatti per la sidebar e per il report copiabile.
 */
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export type ResourcePoint = {
  at: string;
  cpuSystemPercent: number | null;
  cpuProcessPercent: number;
  gpuUtilizationPercent?: number | null;
  ramUsed: number;
  ramTotal: number;
  processRss: number;
};

export type Activity = {
  id: string;
  label: string;
  path: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  status: "running" | "ok" | "error";
  resourcesStart?: ResourcePoint;
  resourcesEnd?: ResourcePoint;
  resourcesTimeline?: ResourcePoint[];
  averageCpuSystemPercent?: number;
  averageCpuProcessPercent?: number;
};

type CpuTotals = { idle: number; total: number };
type ActiveActivity = Activity & { cpuStart: CpuTotals; processCpuStart: NodeJS.CpuUsage; processStartedAt: bigint };
type ComfyStats = { system?: { ram_total?: number; ram_free?: number; os?: string; comfyui_version?: string; argv?: string[] }; devices?: Array<{ name?: string; type?: string }> };

const active = new Map<string, ActiveActivity>();
const execFileAsync = promisify(execFile);
const recent: Activity[] = [];
const monitoringTtlMs = 10_000;
const diagnosticsDirectory = path.resolve(process.env.DIAGNOSTICS_DIR || path.join(process.cwd(), "data", "logs"));
const historyMarkerPath = path.join(diagnosticsDirectory, ".mainboard-cleared");
let monitoringUntil = 0;
// La scadenza del rinnovo non equivale alla chiusura della sidebar. Serve un
// flag separato per non cancellare i test già raccolti quando una richiesta
// lenta (per esempio il caricamento di un 27B) ritarda il polling frontend.
let mainboardSessionClosed = true;
let historyVisibleAfter = 0;
let previousCpu: CpuTotals | null = null;
let previousProcessCpu = process.cpuUsage();
let previousProcessAt = process.hrtime.bigint();
let latestCpu = { system: 0, process: 0 };
let latestHostMemory: { total: number; used: number; at: number } | null = null;
let hostCpu: number | null = null;
let hostGpu: number | null = null;
let hostAt = 0;
const validPercent = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;

/** Legge l'utilizzo reale dei motori GPU Windows; se non disponibile restituisce null. */
async function readWindowsGpuUtilization(): Promise<number | null> {
  if (process.platform !== "win32") return null;
  try {
    const script = "(Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -ErrorAction Stop).CounterSamples | ForEach-Object { $_.CookedValue } | ConvertTo-Json -Compress";
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 1500, windowsHide: true, maxBuffer: 256 * 1024 });
    const values = JSON.parse(stdout.trim()) as number | number[];
    const samples = (Array.isArray(values) ? values : [values]).filter(value => Number.isFinite(value));
    return samples.length ? Number(Math.max(0, Math.min(100, Math.max(...samples))).toFixed(1)) : null;
  } catch { return null; }
}
const historyMarkerReady = fs.readFile(historyMarkerPath, "utf8").then(value => {
  const saved = Number(value.trim());
  if (Number.isFinite(saved) && saved > 0) historyVisibleAfter = saved;
}).catch(() => undefined);

/** Attiva la raccolta per pochi secondi; il polling rinnova la scadenza. */
export function activateMainboardMonitoring() {
  const now = Date.now();
  if (mainboardSessionClosed) {
    historyVisibleAfter = now;
    active.clear();
    recent.length = 0;
    mainboardSessionClosed = false;
  }
  monitoringUntil = now + monitoringTtlMs;
}

/** Ferma subito la raccolta quando la sidebar viene chiusa. */
export async function deactivateMainboardMonitoring() {
  await historyMarkerReady;
  monitoringUntil = 0;
  mainboardSessionClosed = true;
  active.clear();
  recent.length = 0;
  historyVisibleAfter = Date.now();
  await fs.mkdir(diagnosticsDirectory, { recursive: true });
  await fs.writeFile(historyMarkerPath, String(historyVisibleAfter), { encoding: "utf8", mode: 0o600 });
}

/** Indica se Mainboard e realmente aperta e sta facendo polling. */
export function isMainboardMonitoringActive() {
  return monitoringUntil > Date.now();
}

/** Svuota la cronologia visibile senza cancellare i file diagnostici. */
export async function clearMainboardHistory() {
  recent.length = 0;
  historyVisibleAfter = Date.now();
  await fs.mkdir(diagnosticsDirectory, { recursive: true });
  await fs.writeFile(historyMarkerPath, String(historyVisibleAfter), { encoding: "utf8", mode: 0o600 });
}

/** Legge i contatori CPU usati per calcolare una media reale. */
function readCpuTotals(): CpuTotals {
  return os.cpus().reduce((sum, cpu) => {
    const total = Object.values(cpu.times).reduce((value, item) => value + item, 0);
    return { idle: sum.idle + cpu.times.idle, total: sum.total + total };
  }, { idle: 0, total: 0 });
}

/** Calcola la percentuale CPU tra due letture dei contatori. */
function cpuDeltaPercent(start: CpuTotals, end: CpuTotals) {
  const idle = end.idle - start.idle;
  const total = end.total - start.total;
  return total > 0 ? Math.max(0, Math.min(100, (1 - idle / total) * 100)) : 0;
}

/** Calcola l'uso CPU complessivo tra due aggiornamenti Mainboard. */
function cpuPercent() {
  const totals = readCpuTotals();
  if (!previousCpu) { previousCpu = totals; return 0; }
  const value = cpuDeltaPercent(previousCpu, totals);
  previousCpu = totals;
  return value;
}

/** Calcola la CPU usata dal processo AndreaGPT tra due aggiornamenti. */
function processCpuPercent() {
  const now = process.hrtime.bigint();
  const current = process.cpuUsage();
  const usage = { user: current.user - previousProcessCpu.user, system: current.system - previousProcessCpu.system };
  const elapsedMicros = Number(now - previousProcessAt) / 1000;
  previousProcessCpu = current;
  previousProcessAt = now;
  return elapsedMicros > 0 ? Math.max(0, ((usage.user + usage.system) / elapsedMicros) * 100 / Math.max(1, os.cpus().length)) : 0;
}

/** Crea una fotografia leggera di CPU e RAM senza chiamate esterne. */
function resourcePoint(cpuSystemPercent = latestCpu.system, cpuProcessPercent = latestCpu.process): ResourcePoint {
  const memory = process.memoryUsage();
  const cachedMemory = latestHostMemory && Date.now() - latestHostMemory.at < monitoringTtlMs ? latestHostMemory : null;
  const ramTotal = cachedMemory?.total ?? os.totalmem();
  const ramUsed = cachedMemory?.used ?? ramTotal - os.freemem();
  return {
    at: new Date().toISOString(),
    cpuSystemPercent: Date.now() - hostAt < 10000 ? hostCpu : null,
    cpuProcessPercent: Number(cpuProcessPercent.toFixed(1)),
    gpuUtilizationPercent: Date.now() - hostAt < 10000 ? hostGpu : null,
    ramUsed,
    ramTotal,
    processRss: memory.rss,
  };
}

/** Avvia il tracciamento solo se Mainboard e aperta. */
export function beginMainboardActivity(id: string, label: string, route: string) {
  if (!isMainboardMonitoringActive()) return;
  const startPoint = resourcePoint();
  active.set(id, {
    id,
    label,
    path: route,
    startedAt: new Date().toISOString(),
    status: "running",
    resourcesStart: startPoint,
    resourcesTimeline: [startPoint],
    cpuStart: readCpuTotals(),
    processCpuStart: process.cpuUsage(),
    processStartedAt: process.hrtime.bigint(),
  });
}

/** Chiude il tracciamento e salva risorse iniziali, finali e medie. */
export function finishMainboardActivity(id: string, status: "ok" | "error") {
  const item = active.get(id);
  if (!item) return;
  active.delete(id);
  const finishedAt = new Date();
  const cpuEnd = readCpuTotals();
  const processEnd = process.cpuUsage(item.processCpuStart);
  const elapsedMicros = Number(process.hrtime.bigint() - item.processStartedAt) / 1000;
  const endSystemCpu = cpuPercent();
  const endProcessCpu = processCpuPercent();
  latestCpu = { system: endSystemCpu, process: endProcessCpu };
  const endPoint = resourcePoint(endSystemCpu, endProcessCpu);
  const completed: Activity = {
    id: item.id,
    label: item.label,
    path: item.path,
    startedAt: item.startedAt,
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - new Date(item.startedAt).getTime(),
    status,
    resourcesStart: item.resourcesStart,
    resourcesEnd: endPoint,
    resourcesTimeline: [...(item.resourcesTimeline ?? []), endPoint],
    averageCpuProcessPercent: Number((elapsedMicros > 0 ? ((processEnd.user + processEnd.system) / elapsedMicros) * 100 / Math.max(1, os.cpus().length) : 0).toFixed(1)),
  };
  recent.unshift(completed);
  const cutoff = Date.now() - 60 * 60_000;
  while (recent.length > 100 || (recent.at(-1) && new Date(recent.at(-1)!.startedAt).getTime() < cutoff)) recent.pop();
}

/** Toglie i contatori interni prima di inviare una attivita attiva alla UI. */
function publicActivity(item: ActiveActivity): Activity {
  return {
    id: item.id,
    label: item.label,
    path: item.path,
    startedAt: item.startedAt,
    status: item.status,
    resourcesStart: item.resourcesStart,
    resourcesTimeline: item.resourcesTimeline,
  };
}

/** Legge i log completi dell'ultima ora senza caricare file grandi per intero. */
async function recentDiagnostics() {
  await historyMarkerReady;
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(diagnosticsDirectory, `diagnostics-${day}.jsonl`);
  try {
    const info = await fs.stat(file);
    const size = Math.min(info.size, 2 * 1024 * 1024);
    const handle = await fs.open(file, "r");
    try {
      const buffer = Buffer.alloc(size);
      await handle.read(buffer, 0, size, info.size - size);
      const cutoff = Math.max(Date.now() - 60 * 60_000, historyVisibleAfter);
      return buffer.toString("utf8").split(/\r?\n/).filter(Boolean).slice(info.size > size ? 1 : 0).flatMap(line => {
        try {
          const item = JSON.parse(line) as {
            at?: string;
            requestId?: string;
            conversationId?: string;
            outcome?: string;
            events?: Array<{ at?: string; stage?: string; status?: string; message?: string; durationMs?: number; details?: Record<string, string | number | boolean | null> }>;
            summary?: { durationMs?: number; timings?: Record<string, number>; sources?: Array<{ type: "brain" | "web"; label: string; url?: string }> };
          };
          if (!item.at || new Date(item.at).getTime() < cutoff) return [];
          return [{ at: item.at, requestId: item.requestId ?? "", conversationId: item.conversationId, outcome: item.outcome ?? "", events: item.events ?? [], summary: item.summary }];
        } catch { return []; }
      }).reverse().slice(0, 100);
    } finally { await handle.close(); }
  } catch { return []; }
}

/** Legge RAM, CPU, GPU, VRAM, attivita e log per Mainboard. */
export async function getMainboardSnapshot(comfyUrl: string, extraActive: Activity[] = []) {
  await historyMarkerReady;
  let comfy: ComfyStats | null = null;
  try {
    const response = await fetch(`${comfyUrl.replace(/\/$/, "")}/system_stats`, { signal: AbortSignal.timeout(1800) });
    if (response.ok) comfy = await response.json() as ComfyStats;
  } catch { /* ComfyUI puo essere spento. */ }
  const memory = process.memoryUsage();
  const hostTotal = comfy?.system?.ram_total ?? os.totalmem();
  const hostFree = comfy?.system?.ram_free ?? os.freemem();
  latestHostMemory = { total: hostTotal, used: hostTotal - hostFree, at: Date.now() };
  latestCpu = { system: cpuPercent(), process: processCpuPercent() };
  const device = comfy?.devices?.[0];
  let gpuUtilizationPercent: number | null = null;
  hostCpu = null;
  hostGpu = null;
  let telemetrySource = 'Windows: campione assente o scaduto';
  try {
    const sample = JSON.parse(await fs.readFile(path.join(diagnosticsDirectory, 'host-telemetry.json'), 'utf8'));
    const age = Date.now() - Date.parse(sample.at);
    if (age >= -2000 && age < 10000) {
      hostAt = Date.parse(sample.at);
      hostCpu = validPercent(sample.cpu) ? sample.cpu : null;
      hostGpu = validPercent(sample.gpu) ? sample.gpu : null;
      gpuUtilizationPercent = hostGpu;
      telemetrySource = 'Windows CIM';
    }
  } catch { /* Nessun dato host: non sostituirlo con la CPU della VM. */ }
  const sample = resourcePoint(latestCpu.system, latestCpu.process);
  for (const item of active.values()) {
    const timeline = item.resourcesTimeline ?? (item.resourcesTimeline = item.resourcesStart ? [item.resourcesStart] : []);
    const last = timeline.at(-1);
    if (!last || Date.parse(sample.at) - Date.parse(last.at) >= 1000) timeline.push(sample);
  }
  return {
    at: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    cpu: { percent: hostCpu, source: telemetrySource, processPercent: Number(latestCpu.process.toFixed(1)), cores: os.cpus().length, model: os.cpus()[0]?.model ?? "CPU" },
    ram: { total: hostTotal, used: hostTotal - hostFree, free: hostFree, processRss: memory.rss, heapUsed: memory.heapUsed },
    gpu: device ? { available: true, name: device.name ?? "GPU", type: device.type ?? "", utilizationPercent: gpuUtilizationPercent } : { available: false, name: "GPU non rilevata", type: "", utilizationPercent: gpuUtilizationPercent },
    active: [...active.values()].map(publicActivity).concat(extraActive),
    recent: recent.filter(item => new Date(item.startedAt).getTime() >= Math.max(Date.now() - 60 * 60_000, historyVisibleAfter)),
    logs: await recentDiagnostics(),
  };
}
