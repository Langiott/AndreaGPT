/**
 * Estrae la domanda utile dalla cronologia della chat.
 * Ignora risposte precedenti e testo allegato già trasformato in fonte.
 */
interface SearchMessage {
  role: string;
  content: string | Array<{ type: string; text?: string }>;
}

/** History is context only for explicit follow-ups, never evidence from the assistant. */
/** Restituisce l'ultima domanda dell'utente da usare nel retrieval. */
export function extractSearchQuery(messages: SearchMessage[]): string {
  const questions = messages.filter(message => message.role === "user").map(message => {
    const text = typeof message.content === "string" ? message.content
      : message.content.filter(part => part.type === "text").map(part => part.text ?? "").join(" ");
    return text.replace(/--- File:[\s\S]*$/g, "").replace(/\s+/g, " ").trim();
  }).filter(Boolean);
  const latest = questions.at(-1) ?? "";
  const followUp = /\b(?:quest[oaie]|quell[oaie]|precedent[ei]|sopra|approfondisci|continua|altro|invece)\b/iu.test(latest)
    || /^e\s+(?:il|la|i|le|gli|come|dove|quando|perch[eé])\b/iu.test(latest);
  return (followUp ? questions.slice(-2).join(" ") : latest).slice(-1200);
}
