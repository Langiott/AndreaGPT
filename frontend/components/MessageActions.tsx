import { Copy, Pencil } from "lucide-react";

export function MessageActions({ copied, onCopy, onEdit }: { copied: boolean; onCopy: () => void; onEdit: () => void }) {
  const copyLabel = copied ? "Testo copiato" : "Copia il testo";
  return <div className="message-actions">
    <button type="button" onClick={onCopy} title={copyLabel} aria-label={copyLabel}><Copy size={14} /></button>
    <button type="button" onClick={onEdit} title="Modifica e invia" aria-label="Modifica e invia"><Pencil size={14} /></button>
  </div>;
}
