import { useEffect, useMemo, useState } from "react";
import { ChevronRight, RefreshCw } from "lucide-react";
import { SearchField } from "./SearchField";
import type { CodeNode } from "../../backend/code/code_tree";
import { userErrorMessage } from "../utils/errors";

interface Albero { root: string; children: CodeNode[]; files: number }

// Tiene solo i rami che contengono un file (o una cartella) che corrisponde alla ricerca.
function filtra(nodes: CodeNode[], query: string): CodeNode[] {
  if (!query) return nodes;
  return nodes.flatMap(node => {
    const text = `${node.path} ${node.summary ?? ""}`.toLowerCase();
    const match = query.split(/\s+/).every(word => text.includes(word));
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

  const rami = (nodes: CodeNode[]) => nodes.map(node => {
    const open = Boolean(q) || aperti.has(node.path);
    return (
      <div key={node.path} className="code-branch">
        {node.children ? <>
          <button type="button" className="code-row code-dir" onClick={() => toggle(node.path)} aria-expanded={open}>
            <ChevronRight size={13} className={open ? "code-chevron open" : "code-chevron"} />
            <span className="code-name">{node.name}</span>
          </button>
          {open && <div className="code-children">{rami(node.children)}</div>}
        </> : <div className="code-row code-file" title={node.path}>
          <span className="code-name">{node.name}</span>
          {node.summary && <span className="code-summary">{node.summary}</span>}
          <span className="code-lines">{node.lines}</span>
        </div>}
      </div>
    );
  });

  return (
    <div className="code-panel">
      <div className="code-bar">
        <SearchField className="code-search" label="Cerca file o descrizione" value={query} onChange={setQuery} />
        <span className="code-count">{albero ? `${albero.files} file` : ""}</span>
        <button type="button" className="icon-button" onClick={() => void carica()} disabled={busy} aria-label="Aggiorna"><RefreshCw size={15} className={busy ? "spin" : undefined} /></button>
      </div>
      {error && <p className="code-error">{error}</p>}
      {albero && <div className="code-tree">
        <div className="code-row code-root"><span className="code-name">{albero.root}</span></div>
        <div className="code-children">{rami(nodi)}</div>
        {!nodi.length && <p className="code-empty">Nessun file.</p>}
      </div>}
    </div>
  );
}
