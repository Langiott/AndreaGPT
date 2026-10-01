// Rendering Markdown + formule KaTeX delle risposte. Sta in un file a parte
// così Chat_page lo carica in lazy: le librerie Markdown/KaTeX (circa 450 kB)
// non pesano sulla prima apertura dell'app.
import { memo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";

function normalizeMathMarkdown(markdown: string) {
  // remark-math gestisce già `$...$` e `$$...$$`. Convertiamo soltanto le
  // delimitazioni LaTeX esplicite che Ollama usa spesso, senza trasformare
  // intere righe di testo: una riga come "Dove: ... \\eta ..." non è una
  // formula e non deve inglobare tutto il Markdown successivo.
  return markdown.split(/(```[\s\S]*?```|`[^`\n]+`)/g).map((part, index) => {
    if (index % 2) return part;

    const normalized = part
      .replace(/\\\[([\s\S]*?)\\\]/g, (_match, body: string) => `\n$$\n${body.trim()}\n$$\n`)
      .replace(/\\\(([\s\S]*?)\\\)/g, (_match, body: string) => `$${body}$`);

    // Alcuni modelli emettono una formula display come [ ... ] senza backslash.
    // Riconosciamo solo il blocco su righe separate, così i link Markdown
    // [testo](url) restano intatti.
    const lines = normalized.split("\n");
    const output: string[] = [];
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      if (lines[lineIndex].trim() === "[" && lineIndex + 2 < lines.length) {
        const closingIndex = lines.findIndex((candidate, index) => index > lineIndex && candidate.trim() === "]");
        if (closingIndex > lineIndex + 1) {
          const body = lines.slice(lineIndex + 1, closingIndex).join("\n").trim();
          if (/\\[A-Za-z]+|[=^_{}]/.test(body)) {
            output.push("$$", body, "$$");
            lineIndex = closingIndex;
            continue;
          }
        }
      }
      output.push(lines[lineIndex]);
    }
    return output.join("\n");
  }).join("");
}

export const MarkdownMessage = memo(function MarkdownMessage({ content, privateMode }: { content: string; privateMode: boolean }) {
  const components = privateMode ? { img: ({ alt }: { alt?: string }) => <span>[Immagine esterna bloccata: {alt || "immagine"}]</span> } : undefined;
  return <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { errorColor: "inherit", throwOnError: false }]]} components={components}>{normalizeMathMarkdown(content)}</ReactMarkdown>;
});

// Versione semplice (solo tabelle/liste GFM) usata nella vista "giornale" della ricerca.
export function NewspaperMarkdown({ content }: { content: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>;
}
