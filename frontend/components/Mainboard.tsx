/**
 * Sidebar Mainboard aperta con F12.
 * Mostra risorse, attivita e log recenti in forma compatta e copiabile.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Activity, Copy, Cpu, MemoryStick, RefreshCw, Trash2, X } from "lucide-react";
import { writeClipboard } from "../utils/clipboard";

type ResourcePoint = { at: string; cpuSystemPercent: number | null; cpuProcessPercent: number; gpuUtilizationPercent?: number | null; ramUsed: number; ramTotal: number; processRss: number };
type Operation = { id?: string; label: string; path?: string; startedAt: string; finishedAt?: string; durationMs?: number; status: "running" | "ok" | "error"; resourcesStart?: ResourcePoint; resourcesEnd?: ResourcePoint; resourcesTimeline?: ResourcePoint[]; averageCpuSystemPercent?: number; averageCpuProcessPercent?: number };
type DiagnosticLog = {
  at: string;
  requestId: string;
  conversationId?: string;
  outcome: string;
  events: Array<{ at?: string; stage?: string; status?: string; message?: string; durationMs?: number; details?: Record<string, string | number | boolean | null> }>;
  summary?: { durationMs?: number; timings?: Record<string, number>; sources?: Array<{ type: "brain" | "web"; label: string; url?: string }> };
};
type MainboardData = {
  at: string;
  uptimeSeconds: number;
  cpu: { percent: number | null; source?: string; processPercent: number; cores: number; model: string };
  ram: { total: number; used: number; free: number; processRss: number; heapUsed: number };
  gpu: { available: boolean; name: string; type: string; utilizationPercent: number | null };
  active: Operation[];
  recent: Operation[];
  logs: DiagnosticLog[];
};

const gib = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
const time = (value: string) => new Date(value).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const percent = (used: number, total: number) => total > 0 ? Math.round(used / total * 100) : 0;

/** Rende leggibile una durata espressa in millisecondi. */
function duration(value = 0) {
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`;
}

/** Traduce i nomi tecnici dei tempi piu utili. */
function timingLabel(key: string) {
  const labels: Record<string, string> = {
    totalMs: "totale",
    firstTokenMs: "primo token",
    promptBuildMs: "preparazione prompt",
    retrievalMs: "retrieval",
    groundingMs: "grounding",
    indexStatusMs: "stato indice",
    routerLatencyMs: "router",
    load_duration: "caricamento modello",
    prompt_eval_duration: "lettura prompt",
    eval_duration: "generazione",
  };
  return labels[key] ?? key;
}

/** Converte in millisecondi anche i tempi nanosecondi ricevuti da Ollama. */
function timingDuration(key: string, value: number) {
  return duration(key.endsWith("_duration") ? value / 1_000_000 : value);
}

/** Scrive CPU e RAM di un singolo momento. */
function resourceLine(label: string, point?: ResourcePoint) {
  if (!point) return `${label}: dati non disponibili`;
  return `${label}: CPU sistema ${point.cpuSystemPercent === null ? 'N/D' : `${point.cpuSystemPercent}%`} · CPU solo Node ${point.cpuProcessPercent}% · RAM ${gib(point.ramUsed)} / ${gib(point.ramTotal)} · app ${gib(point.processRss)}`;
}

/** Riassume una operazione nella lista compatta della sidebar. */
function operationDetail(item: Operation) {
  const parts = [item.durationMs !== undefined ? duration(item.durationMs) : item.path ?? "in corso"];
  if (item.resourcesTimeline?.length) return `${parts[0]} · ${item.resourcesTimeline.length} campioni risorse`;
  if (item.resourcesStart && item.resourcesEnd) {
    parts.push(`CPU ${item.resourcesStart.cpuSystemPercent ?? "N/D"} → ${item.resourcesEnd.cpuSystemPercent ?? "N/D"}`);
    parts.push(`RAM ${gib(item.resourcesStart.ramUsed)}→${gib(item.resourcesEnd.ramUsed)}`);
  }
  return parts.join(" · ");
}

/** Crea il testo completo da copiare. */
function createReport(data: MainboardData, clientActivity?: Operation | null) {
  const lines = [
    `MAINBOARD ANDREAGPT · ${new Date(data.at).toLocaleString("it-IT")}`,
    `CPU ADESSO: ${data.cpu.percent === null ? 'N/D' : `${data.cpu.percent}%`} sistema · ${data.cpu.processPercent}% solo Node · ${data.cpu.cores} thread · ${data.cpu.model}`,
    `RAM ADESSO: ${gib(data.ram.used)} / ${gib(data.ram.total)} (${percent(data.ram.used, data.ram.total)}%) · app ${gib(data.ram.processRss)}`,
    `GPU: ${data.gpu.available ? data.gpu.name : "non rilevata"}${data.gpu.utilizationPercent === null ? " · utilizzo non disponibile" : ` · ${data.gpu.utilizationPercent}%`}`,
  ];
  const operations = [...(clientActivity ? [clientActivity] : []), ...data.active, ...data.recent];
  lines.push("", "ATTIVITA E RISORSE");
  if (!operations.length) lines.push("Nessuna attività registrata mentre Mainboard era aperta.");
  let chatNumber = 0;
  for (const item of operations) {
    const log = item.id ? data.logs.find(entry => entry.requestId === item.id) : undefined;
    chatNumber += 1;
    const requestDetails = log?.events.find(event => event.stage === "request")?.details;
    lines.push("", `================ CHAT ${chatNumber} ================`);
    lines.push(`Request ID: ${item.id ?? log?.requestId ?? "N/D"}`);
    lines.push(`Conversation ID: ${log?.conversationId ?? "N/D"}`);
    lines.push(`Modello: ${requestDetails?.model ?? "N/D"}`);
    lines.push(`Provider: ${requestDetails?.provider ?? "N/D"}`);
    lines.push(`Brain: ${requestDetails?.brainRequested === true ? "attivo" : "non richiesto"} Â· Web: ${requestDetails?.webRequested === true ? "attivo" : "non richiesto"}`);
    lines.push("", `[${item.status.toUpperCase()}] ${item.label} · ${item.path ?? "client"}`);
    lines.push(`Inizio: ${new Date(item.startedAt).toLocaleString("it-IT")}`);
    lines.push(`Fine: ${item.finishedAt ? new Date(item.finishedAt).toLocaleString("it-IT") : "in corso"}`);
    lines.push(`Durata: ${item.durationMs !== undefined ? duration(item.durationMs) : "in corso"}`);
    lines.push(resourceLine("Risorse inizio", item.resourcesStart));
    lines.push(resourceLine("Risorse fine", item.resourcesEnd));
    if (item.averageCpuSystemPercent !== undefined) lines.push(`CPU media attività: sistema ${item.averageCpuSystemPercent}% · AndreaGPT ${item.averageCpuProcessPercent ?? 0}%`);
    if (log?.summary?.timings && Object.keys(log.summary.timings).length) {
      lines.push("Tempi:");
      for (const [key, value] of Object.entries(log.summary.timings)) lines.push(`  - ${timingLabel(key)}: ${timingDuration(key, value)}`);
    }
    if (log?.summary?.sources?.length) {
      lines.push("Fonti:");
      for (const source of log.summary.sources) lines.push(`  - ${source.type.toUpperCase()}: ${source.label}${source.url ? ` · ${source.url}` : ""}`);
    } else lines.push("Fonti: nessuna");
    if (log?.events.length) {
      lines.push("Dettagli completi:");
      for (const event of log.events) if (event.details && Object.keys(event.details).length) lines.push(`  - ${event.at ? time(event.at) : "--:--:--"} Â· ${Object.entries(event.details).map(([key, value]) => `${key}=${value ?? "N/D"}`).join(" Â· ")}`);
    }
    if (log?.events.length) {
      lines.push("Log:");
      for (const event of log.events) lines.push(`  - ${event.at ? time(event.at) : "--:--:--"} · ${(event.stage ?? "evento").toUpperCase()} · ${(event.status ?? "info").toUpperCase()} · ${event.message ?? "Evento"}${event.durationMs !== undefined ? ` · ${duration(event.durationMs)}` : ""}`);
    } else lines.push("Log: nessun log diagnostico collegato");
  }
  const linkedIds = new Set(operations.map(item => item.id).filter(Boolean));
  const unlinkedLogs = data.logs.filter(log => !linkedIds.has(log.requestId));
  if (unlinkedLogs.length) {
    lines.push("", "LOG NON COLLEGATI A UNA ATTIVITA MAINBOARD");
    for (const log of unlinkedLogs) {
      chatNumber += 1;
      const requestDetails = log.events.find(event => event.stage === "request")?.details;
      lines.push("", `================ CHAT ${chatNumber} ================`);
      lines.push(`Conversation ID: ${log.conversationId ?? "N/D"}`);
      for (const event of log.events) if (event.details && Object.keys(event.details).length) lines.push(`Dettagli: ${Object.entries(event.details).map(([key, value]) => `${key}=${value ?? "N/D"}`).join(" | ")}`);
      lines.push(`Modello: ${requestDetails?.model ?? "N/D"} Â· Provider: ${requestDetails?.provider ?? "N/D"}`);
      if (log.summary?.timings) for (const [key, value] of Object.entries(log.summary.timings)) lines.push(`  - ${timingLabel(key)}: ${timingDuration(key, value)}`);
      if (log.summary?.sources?.length) for (const source of log.summary.sources) lines.push(`  - FONTE ${source.type.toUpperCase()}: ${source.label}${source.url ? ` Â· ${source.url}` : ""}`);
      else lines.push("Fonti: nessuna");
      lines.push(`${time(log.at)} · ${log.outcome.toUpperCase()} · ${log.requestId}`);
      for (const event of log.events) lines.push(`  - ${(event.stage ?? "evento").toUpperCase()} · ${(event.status ?? "info").toUpperCase()} · ${event.message ?? "Evento"}`);
    }
  }
  return lines.join("\n");
}

function cleanReportText(value: string) {
  return value
    .replaceAll("Ã‚Â·", "|")
    .replaceAll("Â·", "|")
    .replaceAll("Ã¨", "è")
    .replaceAll("Ã©", "é")
    .replaceAll("Ã¹", "ù")
    .replaceAll("Ã¬", "ì")
    .replaceAll("Ã²", "ò")
    .replaceAll("Ã ", "à")
    .replaceAll("â€™", "'")
    .replaceAll("â€“", "-")
    .replaceAll("â€”", "-")
    .replaceAll("â€¦", "...");
}

function createStructuredReport(data: MainboardData, clientActivity?: Operation | null) {
  const signed = (value: number, suffix = "") => `${value >= 0 ? "+" : ""}${value.toFixed(1)}${suffix}`;
  const formatPoint = (point: ResourcePoint, previous?: ResourcePoint) => {
    const cpu = point.cpuSystemPercent === null ? "N/D" : `${point.cpuSystemPercent}%`;
    const gpu = point.gpuUtilizationPercent === undefined || point.gpuUtilizationPercent === null ? "N/D" : `${point.gpuUtilizationPercent}%`;
    const change = previous ? [
      previous.cpuSystemPercent !== null && point.cpuSystemPercent !== null ? `ΔCPU ${signed(point.cpuSystemPercent - previous.cpuSystemPercent, " pp")}` : "",
      `ΔRAM ${signed((point.ramUsed - previous.ramUsed) / 1024 ** 3, " GB")}`,
      previous.gpuUtilizationPercent != null && point.gpuUtilizationPercent != null ? `ΔGPU ${signed(point.gpuUtilizationPercent - previous.gpuUtilizationPercent, " pp")}` : "",
    ].filter(Boolean).join(" | ") : "";
    return `${time(point.at)} | CPU ${cpu} | Node ${point.cpuProcessPercent}% | RAM ${gib(point.ramUsed)}/${gib(point.ramTotal)} | GPU ${gpu} | app ${gib(point.processRss)}${change ? ` | ${change}` : ""}`;
  };
  const timeline = (item?: Operation) => {
    if (!item) return [] as ResourcePoint[];
    const points = item.resourcesTimeline?.length ? item.resourcesTimeline : [item.resourcesStart, item.resourcesEnd].filter((point): point is ResourcePoint => Boolean(point));
    const selected: ResourcePoint[] = [];
    for (const point of points) {
      const previous = selected.at(-1);
      if (!previous || Date.parse(point.at) - Date.parse(previous.at) >= 5000 || point === points.at(-1)) selected.push(point);
    }
    return selected;
  };
  const records = new Map<string, { operation?: Operation; log?: DiagnosticLog }>();
  const operations = [clientActivity, ...data.active, ...data.recent].filter((item): item is Operation => Boolean(item));
  for (const operation of operations) {
    const key = operation.id ? `request:${operation.id}` : `operation:${operation.startedAt}:${operation.label}`;
    const current = records.get(key) ?? {};
    records.set(key, { ...current, operation });
  }
  for (const log of data.logs) {
    const key = log.requestId ? `request:${log.requestId}` : `log:${log.at}`;
    const current = records.get(key) ?? {};
    records.set(key, { ...current, log });
  }
  const orderedRecords = [...records.values()].sort((a, b) => {
    const aAt = a.operation?.startedAt ?? a.log?.at ?? "";
    const bAt = b.operation?.startedAt ?? b.log?.at ?? "";
    return aAt.localeCompare(bAt);
  });
  const groups = new Map<string, typeof orderedRecords>();
  for (const record of orderedRecords) {
    const conversationId = record.log?.conversationId ?? record.operation?.id ?? "N/D";
    groups.set(conversationId, [...(groups.get(conversationId) ?? []), record]);
  }
  const lines = [
    "REPORT MAINBOARD ANDREAGPT",
    `Snapshot al momento della copia: ${new Date(data.at).toLocaleString("it-IT")}`,
    `CPU: ${data.cpu.percent === null ? "N/D" : `${data.cpu.percent}%`} sistema | ${data.cpu.processPercent}% Node | ${data.cpu.cores} thread | ${data.cpu.model}`,
    `RAM: ${gib(data.ram.used)} / ${gib(data.ram.total)} (${percent(data.ram.used, data.ram.total)}%) | app ${gib(data.ram.processRss)}`,
    `GPU: ${data.gpu.available ? data.gpu.name : "non rilevata"} | ${data.gpu.utilizationPercent === null ? "N/D" : `${data.gpu.utilizationPercent}%`}`,
    "",
    `CONVERSAZIONI: ${groups.size}`,
  ];
  let conversationNumber = 0;
  for (const [conversationId, group] of groups) {
    conversationNumber += 1;
    lines.push("", `================ CONVERSAZIONE ${conversationNumber} ================`, `Conversation ID: ${conversationId}`);
    group.forEach((record, index) => {
      const item = record.operation;
      const log = record.log;
      const details = log?.events.find(event => event.stage === "request")?.details;
      const status = item?.status ?? (log?.outcome || "info");
      const points = timeline(item);
      lines.push("", `RICHIESTA ${index + 1}`, `Request ID: ${item?.id ?? log?.requestId ?? "N/D"}`);
      lines.push(`Modello: ${cleanReportText(String(details?.model ?? "N/D"))} | Provider: ${cleanReportText(String(details?.provider ?? "N/D"))}`);
      lines.push(`Brain: ${details?.brainRequested === true ? "attivo" : "non richiesto"} | Web: ${details?.webRequested === true ? "attivo" : "non richiesto"}`);
      lines.push(`Stato: ${String(status).toUpperCase()} | ${cleanReportText(item?.label ?? "Richiesta registrata")}${item?.path ? ` | ${item.path}` : ""}`);
      if (item) lines.push(`Intervallo: ${new Date(item.startedAt).toLocaleString("it-IT")} -> ${item.finishedAt ? new Date(item.finishedAt).toLocaleString("it-IT") : "in corso"} | Durata: ${item.durationMs !== undefined ? duration(item.durationMs) : "in corso"}`);
      else if (log) lines.push(`Registrata: ${new Date(log.at).toLocaleString("it-IT")}`);
      if (points.length) {
        lines.push("Risorse nel tempo (campioni discreti):");
        points.forEach((point, pointIndex) => lines.push(`  ${formatPoint(point, points[pointIndex - 1])}`));
      }
      if (log?.summary?.timings && Object.keys(log.summary.timings).length) {
        lines.push("Tempi:");
        for (const [key, value] of Object.entries(log.summary.timings)) lines.push(`  ${timingLabel(key)}: ${timingDuration(key, value)}`);
      }
      if (log?.summary?.sources?.length) {
        lines.push("Fonti:");
        for (const source of log.summary.sources) lines.push(`  ${source.type.toUpperCase()} | ${cleanReportText(source.label)}${source.url ? ` | ${source.url}` : ""}`);
      } else lines.push("Fonti: nessuna");
      if (log?.events.length) {
        lines.push("Eventi:");
        for (const event of log.events) {
          const eventDetails = event.details && Object.keys(event.details).length ? ` | ${Object.entries(event.details).map(([key, value]) => `${key}=${cleanReportText(String(value ?? "N/D"))}`).join(" | ")}` : "";
          lines.push(`  ${event.at ? time(event.at) : "--:--:--"} | ${(event.status ?? "info").toUpperCase()} | ${(event.stage ?? "evento").toUpperCase()} | ${cleanReportText(event.message ?? "Evento")}${event.durationMs !== undefined ? ` | ${duration(event.durationMs)}` : ""}${eventDetails}`);
        }
      } else lines.push("Eventi: nessuno");
    });
  }
  if (!orderedRecords.length) lines.push("Nessuna attività registrata mentre Mainboard era aperta.");
  return lines.join("\n");
}

/** Disegna una metrica con barra di utilizzo. */
function Metric({ icon, label, value, detail, usage }: { icon: ReactNode; label: string; value: string; detail: string; usage: number | null }) {
  return <section className="mainboard-metric"><header>{icon}<span><strong>{label}</strong><small>{detail}</small></span><b>{value}</b></header>{usage !== null && <div className="mainboard-bar"><span style={{ width: `${Math.max(0, Math.min(100, usage))}%` }} /></div>}</section>;
}

/** Gestisce apertura F12, aggiornamento e copia del report. */
export function Mainboard({ currentActivity }: { currentActivity?: Operation | null }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<MainboardData | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let lastRightClick = 0;
    const toggle = (event: KeyboardEvent) => {
      if (event.key !== "F12") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(value => !value);
    };
    const rightClick = (event: MouseEvent) => {
      event.preventDefault();
      const now = Date.now();
      if (now - lastRightClick <= 500) {
        lastRightClick = 0;
        setOpen(value => !value);
      } else lastRightClick = now;
    };
    window.addEventListener("keydown", toggle, true);
    window.addEventListener("contextmenu", rightClick, true);
    return () => {
      window.removeEventListener("keydown", toggle, true);
      window.removeEventListener("contextmenu", rightClick, true);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const sessionRequest = (method: "POST" | "DELETE", keepalive = false) => fetch("/api/mainboard/session", {
      method,
      headers: { "Content-Type": "application/json" },
      body: "{}",
      keepalive,
    });
    const refresh = async () => {
      try {
        const session = await sessionRequest("POST");
        if (!session.ok) throw new Error("Sessione Mainboard non disponibile");
        const response = await fetch("/api/mainboard");
        const result = await response.json() as MainboardData & { error?: string };
        if (!response.ok) throw new Error(result.error || "Mainboard non disponibile");
        if (active) { setData(result); setError(""); }
      } catch (caught) { if (active) setError(caught instanceof Error ? caught.message : "Mainboard non disponibile"); }
    };
    void refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
      setData(null);
      setError("");
      void sessionRequest("DELETE", true).catch(() => undefined);
    };
  }, [open]);

  /** Svuota soltanto la cronologia mostrata da Mainboard. */
  async function clearHistory() {
    try {
      const response = await fetch("/api/mainboard/history", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!response.ok) throw new Error("Impossibile svuotare la cronologia");
      setData(current => current ? { ...current, recent: [], logs: [] } : current);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Impossibile svuotare la cronologia");
    }
  }

  const report = useMemo(() => data ? createStructuredReport(data, currentActivity) : "", [data, currentActivity]);
  async function copyReport() {
    try {
      const response = await fetch("/api/mainboard");
      const latest = response.ok ? await response.json() as MainboardData : data;
      if (latest) {
        setData(latest);
        await writeClipboard(createStructuredReport(latest, currentActivity));
      } else if (report) await writeClipboard(report);
      else throw new Error("Report non disponibile.");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Non sono riuscito a copiare il report Mainboard.");
    }
  }
  if (!open) return null;
  const activities = data ? [...(currentActivity ? [currentActivity] : []), ...data.active] : [];
  const timeline = data ? [
    ...data.recent.map(item => ({ at: item.startedAt, status: item.status, title: item.label, detail: operationDetail(item) })),
    ...data.logs.flatMap(item => {
      const event = item.events.at(-1);
      return event ? [{ at: item.at, status: event.status ?? item.outcome, title: event.message ?? "Richiesta completata", detail: `${event.stage ?? "log"} · ${item.requestId.slice(0, 8)}` }] : [];
    }),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30) : [];
  return <aside className="mainboard" aria-label="Mainboard risorse">
    <header className="mainboard-head"><div><strong>Mainboard</strong><small>Raccolta attiva solo ora · doppio clic destro</small></div><button onClick={() => setOpen(false)} aria-label="Chiudi Mainboard"><X size={18} /></button></header>
    <div className="mainboard-body">
      {error && <p className="mainboard-error">{error}</p>}
      {!data && !error && <p className="mainboard-loading"><RefreshCw size={15} /> Lettura risorse…</p>}
      {data && <>
        <Metric icon={<Cpu size={17} />} label="CPU" value={`${data.cpu.percent === null ? 'N/D' : `${data.cpu.percent}%`}`} detail={`${data.cpu.source ?? "Windows"} · solo Node ${data.cpu.processPercent}%`} usage={data.cpu.percent} />
        <Metric icon={<MemoryStick size={17} />} label="RAM" value={`${percent(data.ram.used, data.ram.total)}%`} detail={`${gib(data.ram.used)} / ${gib(data.ram.total)} · app ${gib(data.ram.processRss)}`} usage={percent(data.ram.used, data.ram.total)} />
        <Metric icon={<Activity size={17} />} label="GPU" value={data.gpu.utilizationPercent === null ? "—" : `${data.gpu.utilizationPercent}%`} detail={`Windows · motore più occupato (tutte le GPU) · ${data.gpu.utilizationPercent === null ? "dato non disponibile" : data.gpu.name}`} usage={data.gpu.utilizationPercent} />
        <section className="mainboard-card"><h3><Activity size={15} /> Adesso</h3>{activities.length ? activities.map((item, index) => <div className="mainboard-event running" key={`${item.id ?? item.label}-${index}`}><time>{time(item.startedAt)}</time><span><strong>{item.label}</strong><small>In corso</small></span></div>) : <p>Nessuna operazione pesante attiva.</p>}</section>
        <section className="mainboard-card"><h3 className="mainboard-section-head"><span>Ultima ora</span><button onClick={() => void clearHistory()} title="Svuota la cronologia visibile"><Trash2 size={12} /> Svuota</button></h3><div className="mainboard-log">{timeline.map((item, index) => <div className={`mainboard-event ${item.status}`} key={`${item.at}-${index}`}><time>{time(item.at)}</time><span><strong>{item.title}</strong><small>{item.detail}</small></span></div>)}</div></section>
      </>}
    </div>
    <footer><button disabled={!report} onClick={() => void copyReport()}><Copy size={15} /> {copied ? "Report copiato" : "Copia report"}</button></footer>
  </aside>;
}
