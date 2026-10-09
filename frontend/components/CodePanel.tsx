import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ChevronRight, RefreshCw, Search } from "lucide-react";
import { userErrorMessage } from "../utils/errors";

interface CodeNode { name: string; path: string; summary?: string; lines?: number; children?: CodeNode[] }
interface Albero { root: string; children: CodeNode[]; files: number }

// Tiene solo i rami che contengono un file (o una cartella) che corrisponde alla ricerca.
function filtra(nodes: CodeNode[], query: string): CodeNode[] {
  if (!query) return nodes;
  return nodes.flatMap(node => {
    const match = `${node.path} ${node.summary ?? ""}`.toLowerCase().includes(query);
    if (!node.children) return match ? [node] : [];
    const children = match ? node.children : filtra(node.children, query);
    return children.length ? [{ ...node, children }] : [];
  });
}

export function CodePanel() {
  const [albero, setAlbero] = useState<Albero>();
  const [aperti, setAperti] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function carica() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/code/albero");
      const data = await response.json().catch(() => ({})) as Albero & { error?: string };
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setAlbero(data);
    } catch (caught) { setError(userErrorMessage(caught, "Albero non disponibile.")); }
    finally { setBusy(false); }
  }
  useEffect(() => { void carica(); }, []);

  const q = query.trim().toLowerCase();
  const nodi = useMemo(() => filtra(albero?.children ?? [], q), [albero, q]);
  const toggle = (key: string) => setAperti(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });

  const rami = (nodes: CodeNode[], prefix: string) => nodes.map((node, index) => {
    const last = index === nodes.length - 1;
    const guida = `${prefix}${last ? "└── " : "├── "}`;
    if (!node.children) return (
      <div key={node.path} className="code-row code-file" title={node.path} style={{ "--code-indent": `${guida.length}ch` } as CSSProperties}>
        <span className="code-guide">{guida}</span>
        <span className="code-name">{node.name}</span>
        {node.summary && <span className="code-summary">{node.summary}</span>}
        <span className="code-lines">{node.lines}</span>
      </div>
    );
    const open = Boolean(q) || aperti.has(node.path);
    return (
      <div key={node.path}>
        <button type="button" className="code-row code-dir" onClick={() => toggle(node.path)} aria-expanded={open}>
          <span className="code-guide">{guida}</span>
          <ChevronRight size={13} className={open ? "code-chevron open" : "code-chevron"} />
          <span className="code-name">{node.name}</span>
        </button>
        {open && rami(node.children, `${prefix}${last ? "    " : "│   "}`)}
      </div>
    );
  });

  return (
    <div className="code-panel">
      <div className="code-bar">
        <label className="code-search"><Search size={14} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Cerca file o descrizione" /></label>
        <span className="code-count">{albero ? `${albero.files} file` : ""}</span>
        <button type="button" className="icon-button" onClick={() => void carica()} disabled={busy} aria-label="Aggiorna"><RefreshCw size={15} className={busy ? "spin" : undefined} /></button>
      </div>
      {error && <p className="code-error">{error}</p>}
      {albero && <div className="code-tree">
        <div className="code-row code-root"><span className="code-name">{albero.root}</span></div>
        {rami(nodi, "")}
        {!nodi.length && <p className="code-empty">Nessun file.</p>}
      </div>}
    </div>
  );
}
