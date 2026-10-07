// Diagrammi ```mermaid nei documenti Markdown. La libreria è pesante: si carica
// solo quando un documento contiene almeno un diagramma.
import { useEffect, useId, useState, type ReactNode } from "react";
import type { Element } from "hast";

type Mermaid = typeof import("mermaid").default;
let mermaidLoader: Promise<Mermaid> | null = null;
// SVG già disegnati: rientrando nel documento i diagrammi compaiono subito e la pagina non cambia altezza.
const rendered = new Map<string, string>();

function loadMermaid() {
  mermaidLoader ??= import("mermaid").then(module => {
    module.default.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral", fontFamily: "Arial, Helvetica, sans-serif", fontSize: 14, flowchart: { useMaxWidth: true, htmlLabels: true } });
    return module.default;
  });
  return mermaidLoader;
}

function MermaidDiagram({ code }: { code: string }) {
  const id = "mermaid-" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [svg, setSvg] = useState(() => rendered.get(code) ?? "");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (rendered.has(code)) { setSvg(rendered.get(code)!); return; }
    let cancelled = false;
    loadMermaid()
      .then(mermaid => mermaid.render(id, code))
      .then(result => { rendered.set(code, result.svg); if (!cancelled) setSvg(result.svg); })
      .catch(() => { if (!cancelled) setFailed(true); document.getElementById("d" + id)?.remove(); });
    return () => { cancelled = true; };
  }, [id, code]);

  if (failed) return <pre><code>{code}</code></pre>;
  if (!svg) return <div className="mermaid-diagram is-loading" role="status">Disegno il diagramma…</div>;
  return <div className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function textOf(node: Element | undefined): string {
  return (node?.children ?? []).map(child => child.type === "text" ? child.value : child.type === "element" ? textOf(child) : "").join("");
}

/** Sostituisce `pre` di react-markdown: i blocchi mermaid diventano diagrammi, il resto resta codice. */
export function MarkdownPre({ node, children, ...props }: { node?: Element; children?: ReactNode }) {
  const code = node?.children.find((child): child is Element => child.type === "element" && child.tagName === "code");
  const classes = code?.properties?.className;
  if (Array.isArray(classes) && classes.includes("language-mermaid")) return <MermaidDiagram code={textOf(code).trim()} />;
  return <pre {...props}>{children}</pre>;
}
