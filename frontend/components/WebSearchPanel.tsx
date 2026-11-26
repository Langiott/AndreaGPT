import { FormEvent, useRef, useState } from "react";
import { Search, ExternalLink } from "lucide-react";

type Risultato = { title: string; url: string; content: string; date: string | null; engine: string | null; image: string | null };

const CATEGORIE = [
  { id: "general", label: "Web" },
  { id: "news", label: "News" },
  { id: "images", label: "Immagini" },
  { id: "videos", label: "Video" },
  { id: "it", label: "Tech" },
  { id: "science", label: "Scienza" },
];

export function WebSearchPanel() {
  const [query, setQuery] = useState("");
  const [categoria, setCategoria] = useState("general");
  const [risultati, setRisultati] = useState<Risultato[]>([]);
  const [suggerimenti, setSuggerimenti] = useState<string[]>([]);
  const [stato, setStato] = useState<"idle" | "loading" | "error" | "done">("idle");
  const [errore, setErrore] = useState("");
  const [rotte, setRotte] = useState<Set<string>>(new Set());

  const ultima = useRef(0);

  async function cerca(q = query, cat = categoria) {
    const testo = q.trim();
    if (!testo) return;
    const id = ++ultima.current;
    setStato("loading");
    try {
      const res = await fetch(`/api/websearch?q=${encodeURIComponent(testo)}&cat=${cat}`);
      const data = await res.json();
      if (id !== ultima.current) return;
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setRotte(new Set());
      setRisultati(data.results);
      setSuggerimenti(data.suggestions);
      setStato("done");
    } catch (e) {
      if (id !== ultima.current) return;
      setErrore(e instanceof Error ? e.message : "Errore");
      setStato("error");
    }
  }

  function invia(event: FormEvent) { event.preventDefault(); void cerca(); }

  const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

  return (
    <div className="websearch">
      <form className="websearch-bar" onSubmit={invia}>
        <Search size={18} />
        <input type="search" enterKeyHint="search" autoFocus value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); e.stopPropagation(); void cerca(); } }} placeholder="Cerca sul web…" />
        <button type="submit" disabled={stato === "loading"}>{stato === "loading" ? "…" : "Cerca"}</button>
      </form>
      <div className="websearch-cats">
        {CATEGORIE.map(c => (
          <button key={c.id} type="button" className={c.id === categoria ? "active" : ""} onClick={() => { setCategoria(c.id); if (query.trim()) void cerca(query, c.id); }}>{c.label}</button>
        ))}
      </div>
      {stato === "error" && <p className="websearch-msg">Errore: {errore}</p>}
      {stato === "done" && !risultati.length && <p className="websearch-msg">Nessun risultato.</p>}
      {suggerimenti.length > 0 && (
        <div className="websearch-sugg">
          {suggerimenti.map(s => <button key={s} type="button" onClick={() => { setQuery(s); void cerca(s); }}>{s}</button>)}
        </div>
      )}
      <div className={categoria === "images" ? "websearch-grid" : "websearch-list"}>
        {risultati.filter(r => categoria !== "images" || (r.image && !rotte.has(r.url))).map(r => categoria === "images" ? (
          <a key={r.url} href={r.url} target="_blank" rel="noreferrer" className="websearch-img"><img src={r.image!} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setRotte(prev => new Set(prev).add(r.url))} /></a>
        ) : (
          <a key={r.url} href={r.url} target="_blank" rel="noreferrer" className="websearch-item">
            <small>{host(r.url)}{r.date ? ` · ${r.date.slice(0, 10)}` : ""}<ExternalLink size={12} /></small>
            <strong>{r.title}</strong>
            {r.content && <span>{r.content}</span>}
          </a>
        ))}
      </div>
    </div>
  );
}
