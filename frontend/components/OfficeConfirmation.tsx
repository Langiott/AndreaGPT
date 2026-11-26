import { useEffect, useRef } from "react";

export type OfficeConfirmationRequest = { title: string; description: string; label: string; action: () => void };

export function OfficeConfirmation({ request, onCancel }: { request: OfficeConfirmationRequest; onCancel: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog className="office-confirmation" ref={dialog} aria-labelledby="office-confirm-title" aria-describedby="office-confirm-description" onCancel={event => { event.preventDefault(); onCancel(); }}>
    <h3 id="office-confirm-title">{request.title}</h3>
    <p id="office-confirm-description">{request.description}</p>
    <div className="office-actions">
      <button type="button" autoFocus onClick={onCancel}>Annulla</button>
      <button type="button" className="office-confirm-action" onClick={() => { onCancel(); request.action(); }}>{request.label}</button>
    </div>
  </dialog>;
}
