import { useEffect, useState, type ReactNode } from "react";
import { CircuitBoard, Cpu, HardDrive, MemoryStick, Thermometer } from "lucide-react";
import type { SystemHistoryPoint, SystemHost, SystemSnapshot } from "../../backend/diagnostics/system";
import "./system-panel.css";

const gb = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });
const clock = new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const chartClock = new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit" });
const formatGb = (bytes: number) => `${gb.format(bytes / 1024 ** 3)} GB`;
const percentage = (total: number, free: number) => Math.max(0, Math.min(100, 100 * (total - free) / total));
const percentLabel = (value: number | null) => value === null ? "—" : `${Math.round(value)}%`;

type ChartMetric = "cpu" | "gpu" | "ram" | "disk" | "temperature";

function Metric({ label, icon, value, detail, metric, history, at, sensorId }: {
  label: string;
  icon: ReactNode;
  value: string;
  detail: string;
  metric: ChartMetric;
  history: SystemHistoryPoint[];
  at: string;
  sensorId?: string;
}) {
  const end = Date.parse(at);
  const first = Date.parse(history[0]?.at ?? at);
  const span = Math.max(60_000, end - first);
  const start = end - span;
  const max = metric === "temperature" ? 130 : 100;
  const unit = metric === "temperature" ? "°C" : "%";
  const width = Math.min(7, 850_000 / span);
  const points = history.flatMap(point => {
    const reading = point[metric];
    if (reading === null || (metric === "temperature" && point.sensorId !== sensorId)) return [];
    const position = Math.max(width / 2, Math.min(100 - width / 2, (Date.parse(point.at) - start) * 100 / span));
    return [{ at: point.at, reading, position }];
  });

  return <section className={`system-card system-${metric}`}>
    <header><h3>{icon}{label}</h3><strong className="system-reading">{value}</strong></header>
    <p>{detail}</p>
    {points.length ? <figure className="system-chart" aria-label={`Grafico ${label}, da ${chartClock.format(start)} a ${chartClock.format(end)}, ${points.length} rilevazioni`}>
      <div className="system-chart-plot" aria-hidden="true">
        <span className="system-chart-scale">{max}{unit}</span>
        {points.map(point => <span key={point.at} className="system-chart-bar" style={{ left: `${point.position}%`, width: `${width}%`, height: `${Math.max(.8, point.reading * 100 / max)}%` }} title={`${clock.format(Date.parse(point.at))} · ${gb.format(point.reading)}${unit}`} />)}
      </div>
      <figcaption><time>{chartClock.format(start)}</time><time>{chartClock.format(end)}</time></figcaption>
    </figure> : <div className="system-chart-empty">In attesa di rilevazioni</div>}
  </section>;
}

export function SystemPanel({ selectedModel }: { selectedModel?: string }) {
  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let timer: number | undefined;
    let active: AbortController | null = null;

    async function refresh() {
      if (document.hidden || active) return;
      const request = new AbortController();
      active = request;
      try {
        const response = await fetch("/api/system", { cache: "no-store", signal: request.signal });
        if (response.status === 401 || response.status === 403) throw new Error("Accedi di nuovo ad AndreaGPT per vedere i dati del PC.");
        if (!response.ok) throw new Error("Lettura del PC non riuscita.");
        const data = await response.json() as SystemSnapshot;
        if (!request.signal.aborted) {
          setSnapshot(data);
          setError("");
        }
      } catch (failure) {
        if (!request.signal.aborted) setError(failure instanceof Error ? failure.message : "Lettura del PC non riuscita.");
      } finally {
        if (active === request) {
          active = null;
          if (!document.hidden) timer = window.setTimeout(refresh, 5000);
        }
      }
    }

    function stop() {
      window.clearTimeout(timer);
      active?.abort();
      active = null;
    }
    function onVisibility() {
      if (document.hidden) stop();
      else void refresh();
    }
    document.addEventListener("visibilitychange", onVisibility);
    void refresh();
    return () => { stop(); document.removeEventListener("visibilitychange", onVisibility); };
  }, []);

  const host = snapshot?.host;
  const history = snapshot?.history ?? [];
  const disk = host?.disks.find(item => item.drive === host.systemDrive);
  const heat = host?.temperatures.reduce<SystemHost["temperatures"][number] | null>(
    (highest, item) => !highest || item.celsius > highest.celsius ? item : highest, null,
  );
  const model = host && [host.manufacturer, host.model].filter(Boolean).join(" ");
  const uptimeHours = host?.boot ? Math.floor((Date.parse(host.at) - Date.parse(host.boot)) / 3_600_000) : -1;
  const offline = Boolean(error || snapshot?.stale);

  return <div className="system-panel">
    <section className="system-overview system-card">
      <div><h3>{model || "PC Windows"}</h3>{host?.os && <p>{host.os}{uptimeHours >= 0 ? ` · acceso da ${uptimeHours < 1 ? "meno di un’ora" : `${uptimeHours} h`}` : ""}</p>}</div>
      <span className={`system-status ${offline ? "stale" : ""}`} title={host?.source}>
        <i aria-hidden="true" />{host ? `${offline ? "Ultimo dato" : "Aggiornato"} ${clock.format(Date.parse(host.at))}` : snapshot || error ? "Telemetria assente" : "Lettura in corso"}
      </span>
    </section>
    {error && <p className="system-message" role="alert">{error}</p>}
    {!host && snapshot && <p className="system-message">Nessun campione Windows disponibile.</p>}
    {host && <>
      <div className="system-metrics">
        <Metric label="CPU" icon={<Cpu size={17} />} value={percentLabel(host.cpu)} detail={[host.processor, host.threads ? `${host.threads} thread` : ""].filter(Boolean).join(" · ") || "Processore non rilevato"} metric="cpu" history={history} at={host.at} />
        <Metric label="RAM" icon={<MemoryStick size={17} />} value={percentLabel(host.memory ? percentage(host.memory.total, host.memory.free) : null)} detail={host.memory ? `${formatGb(host.memory.total - host.memory.free)} usati su ${formatGb(host.memory.total)}` : "Memoria non rilevata"} metric="ram" history={history} at={host.at} />
        <Metric label="GPU" icon={<CircuitBoard size={17} />} value={percentLabel(host.gpu)} detail={host.graphics.join(" · ") || "Grafica non rilevata"} metric="gpu" history={history} at={host.at} />
        <Metric label={host.systemDrive ? `Disco ${host.systemDrive}` : "Disco"} icon={<HardDrive size={17} />} value={percentLabel(disk ? percentage(disk.total, disk.free) : null)} detail={disk ? `${formatGb(disk.free)} liberi su ${formatGb(disk.total)}` : "Disco di sistema non rilevato"} metric="disk" history={history} at={host.at} />
        <Metric label="Temperatura" icon={<Thermometer size={17} />} value={heat ? `${gb.format(heat.celsius)} °C` : "—"} detail={heat ? `${heat.label} · ${heat.source}` : "Nessuna lettura dai sensori"} metric="temperature" history={history} at={host.at} sensorId={heat?.id} />
      </div>
      {host.disks.length > 0 && <section className="system-card system-details">
        <h3>Unità disco</h3>
        {host.disks.map(item => <div key={item.drive} className="system-disk"><div><strong>{item.drive} {item.label}</strong><small>{formatGb(item.free)} liberi su {formatGb(item.total)}</small></div><progress value={percentage(item.total, item.free)} max={100} aria-label={`Spazio occupato ${item.drive}`} /></div>)}
      </section>}
      {host.temperatures.length > 1 && <section className="system-card system-details"><h3>Sensori</h3><ul>{host.temperatures.map(item => <li key={item.id}><span>{item.label}</span><strong>{gb.format(item.celsius)} °C</strong></li>)}</ul></section>}
    </>}
    <section className="system-card system-details">
      <h3>Modelli AI</h3>
      <dl><dt>Selezionato nella chat</dt><dd>{selectedModel || "—"}</dd>
        <dt>Caricati in Ollama</dt><dd>{snapshot?.loadedModels === null ? "Ollama non raggiungibile" : snapshot?.loadedModels.length ? snapshot.loadedModels.join(" · ") : snapshot ? "Nessun modello caricato" : "—"}</dd>
      </dl>
    </section>
  </div>;
}
