import { directOfficeIntent, notCollectible } from "./office_requests";

// Decide se un messaggio della chat principale è un'azione personale da eseguire
// nell'ufficio (Mainboard). Restituisce il testo da inoltrare, oppure "" per la chat normale.
const actionVerb = /\b(?:salv\w*|aggiung\w*|cataloga\w*|archivi\w*|registr\w*|inserisc\w*|segna\w*|rimuov\w*|elimin\w*|cancell\w*|modific\w*|aggiorn\w*|trova\w*|cerca\w*|mostra\w*|elenc\w*|quant[ieo]|quali)\b/iu;
const personalObject = /\b(?:collezion\w*|cart[ae]|abbonament\w*|appuntament\w*|not[ae]|film|scadenz\w*|acquist\w*|garanzi\w*|document\w*|passaport\w*|patente|bollett\w*|mainboard|ufficio|archivio|segretari[oa])\b/iu;
const documentInBoard = /\bdocument\w*\b.*\b(?:mainboard|ufficio|archivio|segretari[oa])\b|\b(?:mainboard|ufficio|archivio)\b.*\bdocument\w*\b/iu;
const url = /https?:\/\/[^\s<>"`]+/giu;

/** Richiesta esplicita di cercare in rete: va alla chat con la ricerca web attiva. */
export const explicitWebSearch = /\b(?:cerca|trova|controlla|guarda)\w*\b.*\b(?:sul\s+web|su\s+internet|in\s+rete|online|su\s+google)\b|\b(?:sul\s+web|su\s+internet|in\s+rete)\b.*\b(?:cerca|trova)\w*\b/iu;
/** Domande sul proprio archivio senza verbo d'azione: "che note ho?", "quali documenti scadono…", "le mie collezioni". */
const myArchive = /^(?:che|quali|quant[ieo])\s+(?:note|abbonamenti|appuntamenti|film|documenti|scadenze|acquisti|collezioni|carte)\b.*\b(?:ho|ci\s+sono|devo|salvat\w*|scad\w*)\b|^(?:le\s+)?mie\s+(?:note|collezioni|carte|scadenze)\b/iu;
/** Promemoria da salvare ("segna che…", "ricordami di…"), ma non codice o file da scrivere. */
const memo = /^(?:segna(?:mi)?|annota(?:mi)?|ricordami|memorizza|appunta(?:mi)?|prendi\s+nota)\b/iu;
const codeRequest = /\b(?:codice|file|script|funzione|python|javascript)\b/iu;

export function chatOfficeText(text: string, today: string): string {
  const value = text.trim();
  if (!value || value.length > 1200) return "";
  const links = [...value.matchAll(url)].map(match => match[0].replace(/[)\].,;!?]+$/u, ""));
  if (/^\/conferma [a-f0-9]{8}$/iu.test(value)) return value;
  if (links.length === 1 && /\b(?:riassun\w*|riassum\w*|sintes\w*|sintetizz\w*|riepilog\w*)\b/iu.test(value)) return value;
  if (explicitWebSearch.test(value)) return "";
  if (myArchive.test(value)) return value;
  if (links.length || notCollectible.test(value)) return "";
  // Richieste di scrittura/traduzione che citano carte o abbonamenti restano alla chat.
  if (/^(?:traduci|scrivi\w*|riscrivi|correggi|parafrasa|spiega\w*|racconta\w*|inventa\w*|come\s+(?:faccio|si)|cosa\s+significa)\b/iu.test(value)) return "";
  if (directOfficeIntent(value, false, today)) return value;
  if (documentInBoard.test(value) && actionVerb.test(value)) return value;
  if (actionVerb.test(value) && personalObject.test(value) && /\b(?:mi[aeo]?|miei|mie|ho|collezion\w*|mainboard|ufficio|archivio)\b|^(?:salv|aggiung|cataloga|registr|segna|inserisc|cerca|trova|mostra|elenc|elimin|rimuov|cancell|modific|aggiorn|sposta|rinomin|togli)/iu.test(value)) return value;
  if (memo.test(value) && !codeRequest.test(value)) return value;
  // "crea la collezione Vinili", "rinomina la collezione…"
  if (/^(?:crea|rinomina|elimina|svuota)\w*\s+(?:la\s+|una\s+)?(?:nuova\s+)?collezione\b/iu.test(value)) return value;
  // Frase senza verbo che descrive una voce: "abbonamento annuale Amazon Prime 49,90 rinnovo 15 marzo".
  if (/^(?:nuovo\s+|nuova\s+)?(?:abbonamento|appuntamento|nota|promemoria)\b/iu.test(value) && value.split(/\s+/).length >= 3) return value;
  return "";
}

/** Riconosce una risposta prodotta dall'ufficio (azione eseguita), non dal modello di chat. */
export function isOfficeReply(content: string) {
  return content.includes("](/?office=")
    || /^(?:Aggiunt[oa]|Annullato|Creat[oa]|Nota salvata|Totale (?:mensile|annuale|annuo)|Prezzo (?:non affidabile|indicativo|salvato)|Set [A-Z]{1,4}\d|\d+ element[oi] trovat|Non c’è nessuna azione|«[^»]+» (?:catalogato|già presente)|1\. «|Il modello non ha prodotto un piano)/u.test(content.trim());
}
