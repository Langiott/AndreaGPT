/** Copia testo negli appunti con fallback per browser locali. */
export async function writeClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return; }
    catch { /* Su HTTP locale gli appunti possono non essere disponibili. */ }
  }
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.inset = "0 auto auto -9999px";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("Appunti non disponibili");
}
