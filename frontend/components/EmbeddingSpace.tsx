import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { ArrowLeft, Maximize2, Minimize2, Pause, Play, RotateCcw, Search, X } from "lucide-react";
import { ellipsoid, ellipsoidRings, spreadStats, type FileSum } from "../utils/embedding_selection";

interface MapPoint { path: string; section: string; lines: string; preview: string; position: number[] }
interface Groups { method: string; kind: "label" | "cluster" | "classifier"; title: string; note: string; names: string[]; labels: number[]; wrong?: boolean[]; truth?: number[]; strength?: number[]; second?: number[]; secondStrength?: number[]; metrics: Array<{ label: string; value: string; hint: string }> }
interface EmbeddingMap { total: number; shown: number; dimension: number; explained: number[]; points: MapPoint[]; groups?: Groups; query?: { text: string; position: number[]; nearest: Array<{ index: number; similarity: number }>; group?: string }; files?: FileSum[] }
interface Screen { x: number; y: number; depth: number; index: number }

/** Metodi del menu "Raggruppa per", nell'ordine del file di teoria. */
const METHODS: Array<{ group: string; items: Array<[string, string]> }> = [
  { group: "Etichette vere", items: [["chapter", "Capitolo"], ["file", "File"]] },
  { group: "Raggruppamento automatico", items: [["kmeans", "K-Means"], ["dbscan", "DBSCAN"], ["hierarchical", "Gerarchico"], ["micelio", "Micelio (similarità coseno)"], ["fuzzy", "Fuzzy (temi sfumati)"]] },
  { group: "Classificatori del capitolo", items: [["knn", "k-NN"], ["naivebayes", "Naive Bayes"], ["svm", "SVM lineare"], ["randomforest", "Random Forest"]] },
];
const PALETTE = ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#42d4f4", "#f032e6", "#9a6324", "#469990", "#808000", "#000075", "#bfef45"];
const NO_GROUP = "#9ca3af";
/** Colore di un gruppo: i primi 12 hanno colori distinti, poi la tavolozza si ripete più chiara. */
function groupColor(label: number) { return label < 0 ? NO_GROUP : label < PALETTE.length ? PALETTE[label] : `hsl(${(label * 47) % 360} 55% 65%)`; }
const percent = (value: number) => `${Math.round(value * 100)}%`;
const decimal = (value: number) => value.toLocaleString("it-IT", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const fileName = (path: string) => path.split("/").at(-1) ?? path;

/** Una statistica della selezione. */
function Stat({ label, hint, value }: { label: string; hint: string; value: string }) {
  return <div title={hint}><dt>{label}</dt><dd>{value}</dd></div>;
}

/** Ruota un punto (yaw attorno all'asse verticale, pitch attorno all'orizzontale). */
function rotate([x, y, z]: number[], yaw: number, pitch: number) {
  const x1 = x * Math.cos(yaw) + z * Math.sin(yaw), z1 = -x * Math.sin(yaw) + z * Math.cos(yaw);
  return [x1, y * Math.cos(pitch) - z1 * Math.sin(pitch), y * Math.sin(pitch) + z1 * Math.cos(pitch)];
}

/** Vista 3D degli embedding reali del Brain (PCA), diversa dal grafo Micelio. */
export function EmbeddingSpace({ standalone = false, onClose }: { standalone?: boolean; onClose?: () => void }) {
  const [data, setData] = useState<EmbeddingMap | null>(null);
  const [query, setQuery] = useState("");
  // La pagina aperta da sola può partire da un metodo: ?embeddingSpace=1&method=fuzzy
  const [method, setMethod] = useState(() => (standalone && new URLSearchParams(window.location.search).get("method")) || "chapter");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hover, setHover] = useState<number | null>(null);
  const [spinning, setSpinning] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const windowRef = useRef<HTMLElement>(null);
  const view = useRef({ yaw: 0.6, pitch: -0.35, zoom: 1 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const screen = useRef<Screen[]>([]);
  const [pinned, setPinned] = useState<number | null>(null);
  const hoverRef = useRef<number | null>(null);
  const pinnedRef = useRef<number | null>(null);
  const dragMoved = useRef(false);
  hoverRef.current = hover;
  pinnedRef.current = pinned;
  // Documenti esclusi dalla selezione (vuoto = tutti).
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const [showSpread, setShowSpread] = useState(false);
  // Anelli sugli estratti classificati male (errori dei classificatori, ponti del Fuzzy).
  const [showRings, setShowRings] = useState(true);

  async function load(text = "", groupBy = method) {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/brain/embedding-map?query=${encodeURIComponent(text)}&method=${groupBy}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Mappa non disponibile.");
      setData(body); setHover(null); setPinned(null);
    } catch (problem) { setError(problem instanceof Error ? problem.message : "Mappa non disponibile."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  // Schermo intero del browser: Esc lo chiude e lo stato resta allineato.
  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === windowRef.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const toggleFullscreen = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void windowRef.current?.requestFullscreen(); };

  // Legenda: gruppi con il numero di estratti, i più numerosi in alto.
  const legend = useMemo(() => {
    const groups = data?.groups; if (!groups) return [];
    const counts = new Map<number, number>();
    for (const label of groups.labels) counts.set(label, (counts.get(label) ?? 0) + 1);
    return [...counts.entries()].map(([label, count]) => ({ label, count, name: label < 0 ? (groups.kind === "label" ? "Senza capitolo" : "Senza gruppo") : groups.names[label] }))
      .sort((a, b) => (a.label < 0 ? 1 : 0) - (b.label < 0 ? 1 : 0) || (groups.kind === "cluster" ? b.count - a.count : a.label - b.label));
  }, [data]);
  // Capitoli noti: dai gruppi con etichette di capitolo (vista Capitolo o classificatori).
  const chapters = data?.groups && (data.groups.method === "chapter" || data.groups.kind === "classifier") ? data.groups.names.length : 0;
  const nearest = useMemo(() => new Set(data?.query?.nearest.map(item => item.index) ?? []), [data]);
  // Statistiche esatte sulle 768 dimensioni; ellissoide sui punti 3D (assi PCA fissi su tutto l'archivio).
  const selection = useMemo(() => {
    if (!data) return null;
    return { stats: spreadStats((data.files ?? []).filter(file => !excluded.has(file.path))), shape: ellipsoid(data.points.filter(point => !excluded.has(point.path)).map(point => point.position)) };
  }, [data, excluded]);
  const files = useMemo(() => [...(data?.files ?? [])].sort((a, b) => fileName(a.path).localeCompare(fileName(b.path))), [data]);
  function toggleFile(path: string) { setExcluded(current => { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next; }); }

  // Disegno continuo: ruota da solo finché non lo fermi o lo trascini.
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas || !data) return;
    const context = canvas.getContext("2d"); if (!context) return;
    let frame = 0;
    const colors = data.points.map((_, index) => groupColor(data.groups?.labels[index] ?? -1));
    const wrong = showRings ? data.groups?.wrong : undefined, truth = data.groups?.truth, strength = data.groups?.strength, second = showRings ? data.groups?.second : undefined;
    const outside = data.points.map(point => excluded.has(point.path));
    const current = showSpread && selection?.shape ? { shape: selection.shape, rings: ellipsoidRings(selection.shape) } : null;
    const draw = () => {
      const ratio = window.devicePixelRatio || 1, width = canvas.clientWidth, height = canvas.clientHeight;
      if (canvas.width !== width * ratio || canvas.height !== height * ratio) { canvas.width = width * ratio; canvas.height = height * ratio; }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      if (spinning && !drag.current) view.current.yaw += 0.0025;
      const { yaw, pitch, zoom } = view.current, radius = Math.min(width, height) * 0.38 * zoom;
      const toScreen = (position: number[]) => { const [x, y, z] = rotate(position, yaw, pitch), perspective = 3 / (3 + z); return { x: width / 2 + x * radius * perspective, y: height / 2 - y * radius * perspective, depth: z }; };
      const ink = getComputedStyle(canvas).color;
      // Assi principali: la lunghezza è la stessa, la varianza spiegata è nell'etichetta.
      context.font = "12px system-ui, sans-serif";
      [[1, 0, 0], [0, 1, 0], [0, 0, 1]].forEach((axis, i) => {
        const from = toScreen(axis.map(v => -v)), to = toScreen(axis);
        context.strokeStyle = ink; context.globalAlpha = 0.18; context.beginPath(); context.moveTo(from.x, from.y); context.lineTo(to.x, to.y); context.stroke();
        context.globalAlpha = 0.6; context.fillStyle = ink; context.fillText(`PC${i + 1} · ${percent(data.explained[i] ?? 0)}`, to.x + 4, to.y);
      });
      const points = data.points.map((point, index) => ({ ...toScreen(point.position), index })).sort((a, b) => b.depth - a.depth);
      screen.current = points;
      const queryScreen = data.query ? toScreen(data.query.position) : null;
      if (queryScreen && data.query) {
        context.strokeStyle = ink; context.globalAlpha = 0.35;
        for (const item of data.query.nearest) { const target = toScreen(data.points[item.index].position); context.beginPath(); context.moveTo(queryScreen.x, queryScreen.y); context.lineTo(target.x, target.y); context.stroke(); }
      }
      for (const point of points) {
        // Documenti esclusi: restano al loro posto, grigi e tenui.
        if (outside[point.index] && pinnedRef.current !== point.index && hoverRef.current !== point.index) { context.globalAlpha = 0.12; context.fillStyle = NO_GROUP; context.beginPath(); context.arc(point.x, point.y, 2.2 * (3 / (3 + point.depth)), 0, Math.PI * 2); context.fill(); continue; }
        const highlighted = nearest.has(point.index) || hoverRef.current === point.index || pinnedRef.current === point.index, size = (highlighted ? 5.5 : 3) * (3 / (3 + point.depth));
        // Fuzzy: più il tema principale è sicuro, più il punto è pieno.
        const certainty = strength ? 0.3 + 0.7 * strength[point.index] : 1;
        context.globalAlpha = (data.query && !highlighted ? 0.35 : 0.85) * certainty;
        context.fillStyle = colors[point.index]; context.beginPath(); context.arc(point.x, point.y, size, 0, Math.PI * 2); context.fill();
        if (highlighted) { context.globalAlpha = 1; context.strokeStyle = ink; context.lineWidth = 1.5; context.stroke(); context.lineWidth = 1; }
        // Punto selezionato: doppio anello ben visibile.
        if (pinnedRef.current === point.index) { context.globalAlpha = 1; context.strokeStyle = ink; context.lineWidth = 2.5; context.beginPath(); context.arc(point.x, point.y, size + 6, 0, Math.PI * 2); context.stroke(); context.lineWidth = 1; }
        // Classificatori: anello sugli errori, colorato con il capitolo vero (il punto ha il colore previsto).
        if (wrong?.[point.index]) { context.globalAlpha = 1; context.strokeStyle = groupColor(truth?.[point.index] ?? -1); context.lineWidth = 2.5; context.beginPath(); context.arc(point.x, point.y, size + 3, 0, Math.PI * 2); context.stroke(); context.lineWidth = 1; }
        // Fuzzy: estratto ponte, anello tratteggiato con il colore del secondo tema.
        if ((second?.[point.index] ?? -1) >= 0) { context.globalAlpha = 0.9; context.strokeStyle = groupColor(second![point.index]); context.lineWidth = 2; context.setLineDash([2, 2]); context.beginPath(); context.arc(point.x, point.y, size + 3, 0, Math.PI * 2); context.stroke(); context.setLineDash([]); context.lineWidth = 1; }
      }
      // Ellissoide e centro della selezione.
      if (current) {
        context.strokeStyle = ink; context.globalAlpha = 0.55; context.lineWidth = 1.2;
        for (const ring of current.rings) { context.beginPath(); ring.forEach((position, i) => { const at = toScreen(position); if (i) context.lineTo(at.x, at.y); else context.moveTo(at.x, at.y); }); context.stroke(); }
        const center = toScreen(current.shape.center);
        context.globalAlpha = 1; context.fillStyle = ink; context.beginPath(); context.arc(center.x, center.y, 6.5, 0, Math.PI * 2); context.fill();
        context.lineWidth = 1; context.font = "bold 13px system-ui, sans-serif"; context.fillText("centro", center.x + 10, center.y - 8); context.font = "12px system-ui, sans-serif";
      }
      if (queryScreen) { context.globalAlpha = 1; context.fillStyle = ink; context.beginPath(); context.arc(queryScreen.x, queryScreen.y, 7, 0, Math.PI * 2); context.fill(); context.fillText("domanda", queryScreen.x + 10, queryScreen.y + 4); }
      context.globalAlpha = 1;
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [data, nearest, spinning, excluded, selection, showSpread, showRings]);

  function pointerMove(event: PointerEvent<HTMLCanvasElement>) {
    if (drag.current) {
      view.current.yaw += (event.clientX - drag.current.x) * 0.008;
      view.current.pitch = Math.max(-1.5, Math.min(1.5, view.current.pitch + (event.clientY - drag.current.y) * 0.008));
      if (event.clientX !== drag.current.x || event.clientY !== drag.current.y) dragMoved.current = true;
      drag.current = { x: event.clientX, y: event.clientY }; return;
    }
    const box = event.currentTarget.getBoundingClientRect(), x = event.clientX - box.left, y = event.clientY - box.top;
    let best: number | null = null, bestDistance = 64;
    for (const point of screen.current) { const distance = (point.x - x) ** 2 + (point.y - y) ** 2; if (distance < bestDistance) { best = point.index; bestDistance = distance; } }
    setHover(best);
  }

  /** Clic su un punto: lo fissa; clic sullo stesso punto o sul vuoto: lo libera. Un trascinamento non conta come clic. */
  function pointerUp() {
    drag.current = null;
    if (dragMoved.current) { dragMoved.current = false; return; }
    setPinned(current => hover === null || hover === current ? null : hover);
  }

  const shown = pinned ?? hover;
  const point = shown !== null ? data?.points[shown] : undefined;
  const back = () => { if (standalone) window.close(); else { window.dispatchEvent(new Event("andreagpt-brain-back")); onClose?.(); } };
  const close = () => standalone ? window.close() : onClose?.();
  return <div className={standalone ? "micelio-standalone" : "micelio-backdrop"}><section ref={windowRef} className="micelio-window">
    <header>
      <button className="micelio-back" onClick={back} title="Torna all’archivio Brain" aria-label="Torna all’archivio Brain"><ArrowLeft size={17} /></button>
      <div><strong>EmbeddingSpace</strong></div>
      <div className="micelio-header-actions">
        <select className="espace-method" value={method} onChange={event => { setMethod(event.target.value); void load(data?.query?.text ?? "", event.target.value); }} title="Raggruppa per" aria-label="Raggruppa per">
          {METHODS.map(section => <optgroup key={section.group} label={section.group}>{section.items.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</optgroup>)}
        </select>
        <form className="espace-search" onSubmit={event => { event.preventDefault(); void load(query); }}><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Domanda da proiettare…" maxLength={600} /><button type="submit" title="Proietta la domanda"><Search size={16} /></button></form>
        <button onClick={() => setSpinning(value => !value)} title={spinning ? "Ferma rotazione" : "Avvia rotazione"}>{spinning ? <Pause size={16} /> : <Play size={16} />}</button>
        <button onClick={() => { view.current = { yaw: 0.6, pitch: -0.35, zoom: 1 }; }} title="Vista iniziale"><RotateCcw size={16} /></button>
        <button onClick={toggleFullscreen} title={fullscreen ? "Esci da schermo intero" : "Schermo intero"} aria-label={fullscreen ? "Esci da schermo intero" : "Schermo intero"}>{fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
        <button className="micelio-close" onClick={close} title="Chiudi" aria-label="Chiudi"><X size={17} /></button>
      </div>
    </header>
    <div className="micelio-body">
      <div className="micelio-canvas espace-canvas">
        {loading && <div className="micelio-empty">Calcolo della proiezione…</div>}
        {error && <div className="micelio-empty error-banner">{error}</div>}
        <canvas ref={canvasRef} onPointerDown={event => { drag.current = { x: event.clientX, y: event.clientY }; dragMoved.current = false; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerUp={pointerUp} onPointerMove={pointerMove} onPointerLeave={() => setHover(null)} onWheel={event => { view.current.zoom = Math.max(0.4, Math.min(6, view.current.zoom * (event.deltaY > 0 ? 0.9 : 1.1))); }} />
        {point && shown !== null && <div className={`espace-tooltip${pinned !== null ? " is-pinned" : ""}`}>
          {pinned !== null && <button type="button" className="espace-tooltip-close" onClick={() => setPinned(null)} aria-label="Deseleziona il punto" title="Deseleziona"><X size={14} /></button>}
          <b>{point.path}:{point.lines}</b>{point.section && <span>{point.section}</span>}
          {data?.groups && data.groups.kind !== "label" && <span>{data.groups.kind === "classifier" ? "Previsto" : data.groups.strength ? "Tema" : "Gruppo"}: {data.groups.names[data.groups.labels[shown]] ?? "—"}{data.groups.strength && ` ${percent(data.groups.strength[shown])}`}</span>}
          {(data?.groups?.second?.[shown] ?? -1) >= 0 && <span>Anche: {data!.groups!.names[data!.groups!.second![shown]]} {percent(data!.groups!.secondStrength![shown])} (ponte)</span>}
          {data?.groups?.wrong?.[shown] && <span>Vero: {data.groups.names[data.groups.truth?.[shown] ?? -1]} (errore)</span>}
          <p>{point.preview}</p></div>}
      </div>
      <aside className="espace-side">
        {data && <>
          <details className="espace-panel" open>
            <summary>Riepilogo</summary>
            <dl className="espace-stats espace-stats-row">
              <div title="Lunghezza di ogni vettore di embedding"><dt>Dimensioni</dt><dd>{data.dimension}</dd></div>
              <div title={data.shown < data.total ? "Estratti mostrati sul totale indicizzato" : "Estratti (chunk) indicizzati"}><dt>Chunk</dt><dd>{data.shown < data.total ? `${data.shown} / ${data.total}` : data.total}</dd></div>
              <div title="Assi principali usati per la vista 3D"><dt>Componenti PCA</dt><dd>{data.explained.length}</dd></div>
              {chapters > 0 && <div title="Capitoli riconosciuti negli estratti"><dt>Capitoli</dt><dd>{chapters}</dd></div>}
            </dl>
            <ul className="espace-variance" title={`Varianza delle ${data.dimension} dimensioni conservata da ogni componente`}>
              {data.explained.map((value, i) => <li key={i}><span>PC{i + 1}</span><i><b style={{ width: percent(value) }} /></i><span>{percent(value)}</span></li>)}
              <li className="espace-variance-total"><span>3D</span><i><b style={{ width: percent(data.explained.reduce((sum, value) => sum + value, 0)) }} /></i><span>{percent(data.explained.reduce((sum, value) => sum + value, 0))}</span></li>
            </ul>
          </details>
          {data.query && <details className="espace-panel" open>
            <summary>Vicini della domanda{data.query.group && <span className="muted"> · {data.query.group}</span>}</summary>
            <ul className="espace-nearest">{data.query.nearest.map(item => { const near = data.points[item.index]; return <li key={item.index}><button type="button" className={pinned === item.index ? "active" : ""} title={`${near.path}:${near.lines}${near.section ? ` · ${near.section}` : ""}`} onPointerEnter={() => setHover(item.index)} onPointerLeave={() => setHover(null)} onClick={() => setPinned(current => current === item.index ? null : item.index)}><b>{percent(item.similarity)}</b><span>{fileName(near.path)}</span><span className="muted">{near.lines}</span></button></li>; })}</ul>
          </details>}
          {data.groups && <details className="espace-panel">
            <summary title={data.groups.note || undefined}>{data.groups.title}</summary>
            {data.groups.metrics.length > 0 && <dl className="espace-stats">{data.groups.metrics.map(metric => <div key={metric.label} title={metric.hint}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>)}</dl>}
            {(data.groups.wrong?.some(Boolean) || data.groups.second?.some(label => label >= 0)) && <div className="espace-spread-actions">
              <label title="Anelli sugli estratti classificati male"><input type="checkbox" checked={showRings} onChange={event => setShowRings(event.target.checked)} /> Bad classification</label>
            </div>}
            <ul className="espace-legend">{legend.map(item => <li key={item.label} title={item.name}><i style={{ background: groupColor(item.label) }} /><span>{item.name}</span><span className="muted">{item.count}</span></li>)}</ul>
          </details>}
          {files.length > 0 && <details className="espace-panel">
            <summary>Documenti e dispersione</summary>
            <div className="espace-spread-actions">
              <button type="button" onClick={() => setExcluded(new Set())}>Tutti</button>
              <button type="button" onClick={() => setExcluded(new Set(files.map(file => file.path)))}>Nessuno</button>
              <label title="Mostra centro ed ellissoide della selezione nella vista 3D"><input type="checkbox" checked={showSpread} onChange={event => setShowSpread(event.target.checked)} /> Ellissoide</label>
            </div>
            <details className="espace-subpanel">
              <summary>Documenti <span className="muted">{files.length - files.filter(file => excluded.has(file.path)).length}/{files.length}</span></summary>
              <ul className="espace-files">{files.map(file => <li key={file.path}><label title={file.path}><input type="checkbox" checked={!excluded.has(file.path)} onChange={() => toggleFile(file.path)} /><span>{fileName(file.path)}</span><span className="muted">{file.count}</span></label></li>)}</ul>
            </details>
            {selection?.stats && <>
              <dl className="espace-stats">
                <Stat label="Chunk" hint={`${selection.stats.files} documenti su ${files.length}`} value={String(selection.stats.count)} />
                <Stat label="Varianza" hint={`Distanza quadratica media dei chunk dal centro, su ${data.dimension} dimensioni (0 = tutti uguali)`} value={decimal(selection.stats.total)} />
                {selection.stats.files > 1 && <>
                  <Stat label="Dentro i doc." hint="Quota della varianza dovuta ai chunk di uno stesso documento" value={percent(selection.stats.within / (selection.stats.total || 1))} />
                  <Stat label="Tra i doc." hint="Quota della varianza dovuta alla distanza tra i centri dei documenti" value={percent(selection.stats.between / (selection.stats.total || 1))} />
                </>}
              </dl>
            </>}
          </details>}
        </>}
      </aside>
    </div>
  </section></div>;
}
