/** Copia testo negli appunti con fallback per browser locali. */
export async function writeClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return; }
    catch { /* Su HTTP locale gli appunti possono non essere disponibili. */ }
  }
  const field = document.createElement("textarea");
  const previousFocus = document.activeElement;
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.inset = "0 auto auto -9999px";
  document.body.appendChild(field);
  let copied = false;
  try {
    field.focus({ preventScroll: true });
    field.select();
    field.setSelectionRange(0, text.length);
    copied = document.execCommand("copy");
  } finally {
    field.remove();
    if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true });
  }
  if (!copied) throw new Error("Appunti non disponibili");
}
