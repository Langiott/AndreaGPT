import { directOfficeIntent, notCollectible } from "./office_requests";

// Decide se un messaggio della chat principale è un'azione personale da eseguire
// nell'ufficio (Mainboard). Restituisce il testo da inoltrare, oppure "" per la chat normale.
const actionVerb = /\b(?:salv\w*|aggiung\w*|cataloga\w*|archivi\w*|registr\w*|inserisc\w*|segna\w*|rimuov\w*|elimin\w*|cancell\w*|modific\w*|aggiorn\w*|trova\w*|cerca\w*|mostra\w*|elenc\w*|quant[ieo]|quali)\b/iu;
const personalObject = /\b(?:collezion\w*|cart[ae]|abbonament\w*|appuntament\w*|not[ae]|film|scadenz\w*|acquist\w*|garanzi\w*|mainboard|ufficio|archivio|segretari[oa])\b/iu;
const documentInBoard = /\bdocument\w*\b.*\b(?:mainboard|ufficio|archivio|segretari[oa])\b|\b(?:mainboard|ufficio|archivio)\b.*\bdocument\w*\b/iu;
const url = /https?:\/\/[^\s<>"`]+/giu;

export function chatOfficeText(text: string, today: string): string {
  const value = text.trim();
  if (!value || value.length > 1200) return "";
  const links = [...value.matchAll(url)].map(match => match[0].replace(/[)\].,;!?]+$/u, ""));
  if (/^\/conferma [a-f0-9]{8}$/iu.test(value)) return value;
  if (links.length === 1 && /\b(?:riassun\w*|riassum\w*|sintes\w*|sintetizz\w*|riepilog\w*)\b/iu.test(value)) return value;
  if (links.length || notCollectible.test(value)) return "";
  // Richieste di scrittura/traduzione che citano carte o abbonamenti restano alla chat.
  if (/^(?:traduci|scrivi\w*|riscrivi|correggi|parafrasa|spiega\w*|racconta\w*|inventa\w*|come\s+(?:faccio|si)|cosa\s+significa)\b/iu.test(value)) return "";
  if (directOfficeIntent(value, false, today)) return value;
  if (documentInBoard.test(value) && actionVerb.test(value)) return value;
  if (actionVerb.test(value) && personalObject.test(value) && /\b(?:mi[aeo]?|miei|mie|ho|collezion\w*|mainboard|ufficio|archivio)\b|^(?:salv|aggiung|cataloga|registr|segna|inserisc|cerca|trova|mostra|elenc)/iu.test(value)) return value;
  return "";
}
