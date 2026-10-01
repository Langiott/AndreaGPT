import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, ExternalLink, Maximize2, Minimize2, Minus, Plus, X } from "lucide-react";

type Level = "collections" | "files" | "chunks";
type GraphFilter = "all" | "active" | "passive" | "central";
interface GraphNode { id: string; label: string; type: "collection" | "file" | "chunk"; path: string; chunks: number; files: number; score: number; vitality: number; active: boolean; central: boolean; degree: number; weightedDegree: number; betweenness: number; closeness: number; centrality: number; preview?: string }
interface GraphEdge { source: string; target: string; similarity: number; flow: number }
interface GraphData { level: Level; scope: string; query: string; nodes: GraphNode[]; edges: GraphEdge[]; truncated: boolean; totals: { nodes: number; edges: number; active: number; passive: number; central: number } }
interface Positioned extends GraphNode { x: number; y: number; radius: number }

const VITALITY_AREAS = [
  { id: "thriving", label: "Rigogliosa", range: "60–100%", min: 0.6, x: 20, width: 310, center: 175 },
  { id: "steady", label: "Stabile", range: "30–59%", min: 0.3, x: 345, width: 310, center: 500 },
  { id: "nurture", label: "Da nutrire", range: "0–29%", min: 0, x: 670, width: 310, center: 825 },
] as const;
function vitalityArea(vitality: number) { return VITALITY_AREAS.find(area => vitality >= area.min) ?? VITALITY_AREAS[VITALITY_AREAS.length - 1]; }
function hash(value: string) { let result = 2166136261; for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16777619); return result >>> 0; }
function layoutGraph(data: GraphData | null): Positioned[] {
  if (!data?.nodes.length) return [];
  const areaIndexes = new Map<string, number>();
  const nodes = data.nodes.map(node => { const area = vitalityArea(node.vitality); const index = areaIndexes.get(area.id) ?? 0; areaIndexes.set(area.id, index + 1); const angle = index * 2.399963 + (hash(node.id) % 100) / 100; const distance = 42 + Math.sqrt(index + 1) * 25; return { ...node, x: area.center + Math.cos(angle) * Math.min(115, distance), y: 350 + Math.sin(angle) * Math.min(275, distance * 2.1), radius: 7 + Math.min(15, Math.log2(node.chunks + 1) * 1.8 + node.centrality * 5) }; });
  const byId = new Map(nodes.map((node, index) => [node.id, index]));
  for (let step = 0; step < 150; step++) {
    const dx = nodes.map(() => 0), dy = nodes.map(() => 0);
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) { const x = nodes[j].x - nodes[i].x, y = nodes[j].y - nodes[i].y, squared = Math.max(100, x * x + y * y), force = 2200 / squared; dx[i] -= x * force; dy[i] -= y * force; dx[j] += x * force; dy[j] += y * force; }
    for (const edge of data.edges) { const a = byId.get(edge.source), b = byId.get(edge.target); if (a === undefined || b === undefined) continue; const x = nodes[b].x - nodes[a].x, y = nodes[b].y - nodes[a].y, distance = Math.max(1, Math.sqrt(x * x + y * y)), wanted = 125 + (1 - edge.similarity) * 170, force = (distance - wanted) * 0.012; dx[a] += x / distance * force; dy[a] += y / distance * force; dx[b] -= x / distance * force; dy[b] -= y / distance * force; }
    nodes.forEach((node, i) => { const area = vitalityArea(node.vitality); dx[i] += (area.center - node.x) * 0.035; dy[i] += (350 - node.y) * 0.002; node.x = Math.max(area.x + 30, Math.min(area.x + area.width - 30, node.x + Math.max(-8, Math.min(8, dx[i])))); node.y = Math.max(45, Math.min(655, node.y + Math.max(-8, Math.min(8, dy[i])))); });
  }
  return nodes;
}

function Ranking({ title, nodes, value, tone, onSelect }: { title: string; nodes: GraphNode[]; value: (node: GraphNode) => number; tone: "active" | "passive"; onSelect: (node: GraphNode) => void }) {
  return <details className={`micelio-ranking ${tone}`}><summary><span>{title}</span><ChevronDown size={15} /></summary><ol>{nodes.slice(0, 3).map(node => <li key={node.id}><button title={node.path} onClick={() => onSelect(node)}><span>{node.label}</span><strong>{Math.round(value(node) * 100)}%</strong></button></li>)}</ol></details>;
}

function ToolbarDropdown({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string; disabled?: boolean }>; onChange: (value: string) => void }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const selected = options.find(option => option.value === value)?.label ?? value;
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => { if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false; };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  return <details className="micelio-menu" ref={menu} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.open = false; }}>
    <summary aria-label={label}><span>{label}</span><strong>{selected}</strong><ChevronDown size={14} /></summary>
    <div className="micelio-menu-options" role="listbox" aria-label={label}>{options.map(option => <button key={option.value} type="button" role="option" aria-selected={option.value === value} disabled={option.disabled} onClick={() => { onChange(option.value); if (menu.current) menu.current.open = false; }}>{option.label}</button>)}</div>
  </details>;
}

export function BrainGraph({ standalone = false, onClose, onBack, onUse }: { standalone?: boolean; onClose?: () => void; onBack?: () => void; onUse?: (source: string) => void }) {
  const [level, setLevel] = useState<Level>("collections");
  const [scope, setScope] = useState("");
  const [history, setHistory] = useState<Array<{ level: Level; scope: string }>>([]);
  const [threshold, setThreshold] = useState(0.6);
  const [data, setData] = useState<GraphData | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [filter, setFilter] = useState<GraphFilter>("all");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(standalone);
  const [view, setView] = useState({ x: 0, y: 0, width: 1000, height: 700 });
  const drag = useRef<{ x: number; y: number; viewX: number; viewY: number } | null>(null);
  const positioned = useMemo(() => layoutGraph(data), [data]);
  const positions = useMemo(() => new Map(positioned.map(node => [node.id, node])), [positioned]);
  const selected = positioned.find(node => node.id === selectedId);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setSelectedId(""); setFilter("all"); setView({ x: 0, y: 0, width: 1000, height: 700 });
    const params = new URLSearchParams({ level, scope, threshold: String(threshold), limit: level === "collections" ? "60" : "100" });
    fetch(`/api/brain/graph?${params}`, { signal: controller.signal }).then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || "Micelio non disponibile."); if (!controller.signal.aborted) setData(result); }).catch(caught => { if (!controller.signal.aborted && (caught as Error).name !== "AbortError") setError(caught instanceof Error ? caught.message : "Micelio non disponibile."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [level, scope, threshold]);

  function drill(node: GraphNode) { if (node.type === "chunk") return; setHistory(current => [...current, { level, scope }]); setLevel(node.type === "collection" ? "files" : "chunks"); setScope(node.path); }
  function changeLevel(next: Level) {
    setHistory([]);
    if (next === "collections") setScope("");
    else if (next === "files" && level === "chunks") setScope(/^progetti\/[^/]+/.exec(scope)?.[0] ?? "Documenti personali");
    else if (next === "chunks" && level === "files" && selected?.type === "file") setScope(selected.path);
    setLevel(next);
  }
  function goBack() { const previous = history[history.length - 1]; if (!previous) { if (onBack) onBack(); else if (standalone) window.close(); else { window.dispatchEvent(new Event("andreagpt-brain-back")); onClose?.(); } return; } setHistory(current => current.slice(0, -1)); setLevel(previous.level); setScope(previous.scope); }
  function useNode(node: GraphNode) { const source = node.type === "collection" && node.path === "Documenti personali" ? "" : node.path; if (onUse) onUse(source); else window.opener?.postMessage({ type: "andreagpt-brain-source", source }, window.location.origin); }
  function zoom(factor: number) { setView(current => { const width = Math.max(280, Math.min(1800, current.width * factor)), height = width * 0.7; return { x: current.x + (current.width - width) / 2, y: current.y + (current.height - height) / 2, width, height }; }); }

  const activeNodes = useMemo(() => [...(data?.nodes ?? [])].filter(node => node.active).sort((a, b) => b.weightedDegree - a.weightedDegree || b.centrality - a.centrality), [data]);
  const passiveNodes = useMemo(() => [...(data?.nodes ?? [])].filter(node => !node.active).sort((a, b) => a.weightedDegree - b.weightedDegree || a.centrality - b.centrality), [data]);
  const matchesFilter = (node: GraphNode) => filter === "all" || (filter === "active" && node.active) || (filter === "passive" && !node.active) || (filter === "central" && node.central);
  const selectRankedNode = (node: GraphNode, tone: "active" | "passive") => { setFilter(tone); setSelectedId(node.id); };
  const close = () => standalone ? window.close() : onClose?.();

  return <div className={standalone ? "micelio-standalone" : "micelio-backdrop"}><section className={`micelio-window ${expanded ? "expanded" : ""}`}>
    <header><button className="micelio-back" onClick={goBack} title="Torna all’archivio Brain" aria-label="Torna all’archivio Brain"><ArrowLeft size={17} /></button><div><strong>Micelio Brain</strong></div><div className="micelio-header-actions"><ToolbarDropdown label="Vista" value={level} options={[{ value: "collections", label: "Raccolte" }, { value: "files", label: "File", disabled: !scope }, { value: "chunks", label: "Estratti", disabled: !(level === "chunks" || (level === "files" && selected?.type === "file")) }]} onChange={value => changeLevel(value as Level)} /><ToolbarDropdown label="Legami" value={threshold.toFixed(2)} options={["0.45", "0.55", "0.60", "0.70", "0.80", "0.85"].map(value => ({ value, label: `${Math.round(Number(value) * 100)}%` }))} onChange={value => setThreshold(Number(value))} /><button onClick={() => zoom(0.8)} title="Ingrandisci mappa"><Plus size={16} /></button><button onClick={() => zoom(1.25)} title="Riduci mappa"><Minus size={16} /></button><button className="micelio-expand" onClick={() => setExpanded(value => !value)} title={expanded ? "Riduci finestra" : "Ingrandisci finestra"}>{expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>{!standalone && <button className="micelio-external" onClick={() => window.open("/?brainGraph=1", "andreagpt-micelio", "popup=yes,width=760,height=1000,resizable=yes")} title="Apri in un’altra finestra"><ExternalLink size={17} /></button>}<button className="micelio-close" onClick={close} title="Chiudi"><X size={18} /></button></div></header>
    <div className="micelio-body"><div className="micelio-canvas">{loading && <div className="micelio-empty">Il Micelio sta organizzando la rete…</div>}{error && <div className="micelio-empty error-banner">{error}</div>}{!loading && !error && <svg className={`micelio-graph filter-${filter}`} viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} onWheel={event => { event.preventDefault(); zoom(event.deltaY > 0 ? 1.12 : 0.89); }} onPointerDown={event => { drag.current = { x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { if (!drag.current) return; const scale = view.width / Math.max(1, event.currentTarget.clientWidth); setView(current => ({ ...current, x: drag.current!.viewX - (event.clientX - drag.current!.x) * scale, y: drag.current!.viewY - (event.clientY - drag.current!.y) * scale })); }} onPointerUp={() => { drag.current = null; }}>
      <g className="vitality-areas">{VITALITY_AREAS.map(area => <g key={area.id} className={`vitality-area ${area.id}`}><rect x={area.x} y="18" width={area.width} height="664" rx="18" /><text x={area.x + 18} y="45">{area.label}</text><text className="range" x={area.x + area.width - 18} y="45" textAnchor="end">{area.range}</text></g>)}</g>
      {data?.edges.map(edge => { const a = positions.get(edge.source), b = positions.get(edge.target); if (!a || !b) return null; const focused = matchesFilter(a) && matchesFilter(b), active = a.active && b.active; return <line key={`${edge.source}-${edge.target}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`${active ? "active" : ""} ${filter !== "all" && focused ? `focus-${filter}` : ""}`} style={{ strokeWidth: 0.7 + edge.flow * 3, opacity: filter === "all" ? (active ? 0.72 : 0.18 + edge.similarity * 0.28) : focused ? 0.68 : 0.035 }} />; })}
      {positioned.map(node => <g key={node.id} className={`micelio-node ${node.type} vitality-${vitalityArea(node.vitality).id} ${node.active ? "active" : "passive"} ${node.central ? "central" : ""} ${filter !== "all" ? (matchesFilter(node) ? "highlighted" : "dimmed") : ""} ${selectedId === node.id ? "selected" : ""}`} transform={`translate(${node.x} ${node.y})`} onPointerDown={event => event.stopPropagation()} onClick={() => setSelectedId(node.id)} onDoubleClick={() => drill(node)}><circle r={node.radius} /><text y={node.radius + 13} textAnchor="middle">{node.label.length > 28 ? `${node.label.slice(0, 26)}…` : node.label}</text>{node.active && <circle className="activity-ring" r={node.radius + 5} />}</g>)}
    </svg>}</div>
      <aside className={`micelio-details ${selected ? "has-selection" : ""}`}><div className="micelio-analytics"><div className="micelio-analytics-head"><h3>Statistiche</h3><span>{data?.totals.edges ?? 0} legami</span></div><div className="micelio-metric-grid"><button className={`micelio-stat all ${filter === "all" ? "selected" : ""}`} aria-pressed={filter === "all"} onClick={() => setFilter("all")}><strong>{data?.totals.nodes ?? 0}</strong><span>Nodi</span></button><button className={`micelio-stat active ${filter === "active" ? "selected" : ""}`} aria-pressed={filter === "active"} onClick={() => setFilter("active")}><strong>{data?.totals.active ?? 0}</strong><span>Attivi</span></button><button className={`micelio-stat passive ${filter === "passive" ? "selected" : ""}`} aria-pressed={filter === "passive"} onClick={() => setFilter("passive")}><strong>{data?.totals.passive ?? 0}</strong><span>Passivi</span></button><button className={`micelio-stat central ${filter === "central" ? "selected" : ""}`} aria-pressed={filter === "central"} onClick={() => setFilter("central")}><strong>{data?.totals.central ?? 0}</strong><span>Centrali</span></button></div><div className="micelio-rankings"><Ranking title="Più attivi" nodes={activeNodes} value={node => node.weightedDegree} tone="active" onSelect={node => selectRankedNode(node, "active")} /><Ranking title="Più passivi" nodes={passiveNodes} value={node => node.weightedDegree} tone="passive" onSelect={node => selectRankedNode(node, "passive")} /></div></div>{selected && <div className="micelio-selected"><span className={`node-kind ${selected.type}`}>{selected.type === "collection" ? "Raccolta" : selected.type === "file" ? "File" : "Estratto"}</span><h3>{selected.label}</h3><code>{selected.path}</code><dl><dt>Centralità</dt><dd>{Math.round(selected.centrality * 100)}%</dd><dt>Grado</dt><dd>{selected.degree} legami</dd><dt>Betweenness</dt><dd>{Math.round(selected.betweenness * 100)}%</dd><dt>Closeness</dt><dd>{Math.round(selected.closeness * 100)}%</dd><dt>Vitalità</dt><dd>{Math.round(selected.vitality * 100)}%</dd><dt>Stato</dt><dd>{selected.active ? "Attivo" : "Passivo"}</dd></dl><div><button onClick={() => useNode(selected)}>Usa</button>{selected.type !== "chunk" && <button onClick={() => drill(selected)}>Esplora</button>}</div></div>}</aside>
    </div>
  </section></div>;
}
