import type { Intent } from "./office_schema";
import type { Kind } from "./office_sections";
import { collectionSearch } from "./collection_search";

export const catalogTypes = {
  book: { collection: "Libri", type: "Libro" },
  magazine: { collection: "Riviste", type: "Rivista" },
  game: { collection: "Giochi", type: "Gioco" },
  object: { collection: "Oggetti", type: "Oggetto" },
  card: { collection: "Carte", type: "Carta" },
} as const;
export const catalogCategories = ["book", "magazine", "game", "object", "card"] as const;

const cardGames: [RegExp, string][] = [
  [/\bone\s*piece\b/iu, "One Piece"], [/\bpok[eé]mon\b/iu, "Pokémon"], [/\bmagic\b|\bmtg\b/iu, "Magic"],
  [/\byu-?gi-?oh\b/iu, "Yu-Gi-Oh!"], [/\bdragon\s*ball\b/iu, "Dragon Ball"], [/\blorcana\b/iu, "Lorcana"],
];
export function cardGame(text: string) {
  return cardGames.find(([pattern]) => pattern.test(text))?.[1];
}
const cardWord = /\b(?:cart[ae]|card)\b/iu;
export const notCollectible = /\b(?:cart[ae]|card)\s+(?:di\s+credito|di\s+debito|bancomat|prepagat\w*|d[’']identit\w*|igienic\w*|costituzional\w*|sim)\b/iu;

export type DirectPlan = Intent | { actions: Intent[] };

function cardIntent(text: string, hasImage: boolean): DirectPlan | undefined {
  // "salva una nota: … artbook di One Piece" è una nota, non una carta.
  if (/^\s*\S+\s+(?:una\s+|la\s+|come\s+)?(?:not[ae]|promemoria|appuntament\w*|abbonament\w*|film|documento)\b/iu.test(text)) return;
  const word = cardWord.exec(text) ?? addVerb.exec(text);
  if (!word) return;
  const game = cardGame(text);
  let rest = text.slice(word.index + word[0].length);
  for (const [pattern] of cardGames) rest = rest.replace(pattern, " ");
  rest = rest.replace(/\b(?:nella|alla|in)\s+(?:mia\s+)?collezione(?:\s+\S+)?/iu, " ")
    .replace(/\b(?:alle|nelle|tra\s+le)\s+(?:mie\s+)?cart[ae]\b/iu, " ")
    .replace(/^\s*(?:anche|pure|poi|ancora)\b/iu, " ")
    .replace(/^\s*(?:le|la|i|il|queste|questa|sta|ste)\b/iu, " ")
    .replace(/^\s*(?:cart[ae]|card)\b/iu, " ")
    .replace(/^\s*(?:di|del|della|dei|da)\b/iu, " ")
    .replace(/\s+(?:di|del|della|da)\s*$/iu, " ")
    .replace(/\b(?:si chiama|di nome|titolo(?: è)?|chiamata)\s*[:=]?/iu, " ")
    .replace(/\b(?:in|della|nella)\s+foto\b|\b(?:allegata|fotografata)\b/iu, " ")
    .replace(/\s+/gu, " ");
  const title = cleanTitle(rest.replace(/^[\s:,;.?!-]+/u, "").replace(/^(?:è|e['’]|ed è|si chiama|chiamata)\s+/iu, "").replace(/,?\s*\b(?:salval[ao]|salvamel[ao]|registral[ao]|aggiungil[ao])\b.*$/iu, ""));
  const collection = game ?? undefined;
  // Più carte nella stessa frase: "Luffy e Zoro", "Luffy OP01-024, Nami OP01-016".
  const parts = title.split(/\s*,\s*|\s+e\s+|\s+ed\s+/iu).map(part => cleanTitle(part)).filter(Boolean);
  if (parts.length > 1 && parts.length <= 12 && parts.every(part => part.length <= 160)) {
    return { actions: parts.map(part => ({ action: "catalogItem", category: "card", title: part, collection }) as Intent) };
  }
  if (title && title.length <= 160) return { action: "catalogItem", category: "card", title, collection };
  if (hasImage || game) return { action: "catalogItem", category: "card", collection };
  return { action: "clarify", message: "Come si chiama la carta? Indica nome ed eventuale codice (es. OP01-001)." };
}

export function directQuery(text: string): Intent | undefined {
  const filler = /^(?:(?:no|aspetta|scusa|ops|oops|ho sbagliato|errore|niente)[,!.]*\s+)*/iu;
  if (/^(?:annulla(?:\s+(?:l[’']ultim[ao](?:\s+(?:azione|operazione|cosa|salvataggio|carta))?|quello|quella|tutto))?|toglil[ao]|cancellal[ao]|rimuovil[ao]|eliminal[ao])[.!]*$/iu.test(text.trim().replace(filler, ""))) {
    return { action: "undo" };
  }
  if (/\b(?:sposta\w*|trasferisc\w*|migra\w*|porta)\b.*\bcart[ae]\b.*\bcollezion\w*/iu.test(text) && !/\bcollezion\w*\b.*\b(?:in|nella)\s+(?:archivio|office)\b/iu.test(text)) {
    return { action: "migrateCards" };
  }
  const setCode = /\b([A-Za-z]{2,3}\d{2})(?![\d-])/u.exec(text);
  if (setCode && /\b(?:manc\w*|buchi|complet\w*)\b/iu.test(text)) {
    return { action: "cardSet", set: setCode[1].toUpperCase(), collection: cardGame(text) };
  }
  if (/\babbonament\w*\b/iu.test(text) && (/\b(?:quant[io]|elenc\w*|mostra\w*|lista|quali)\b/iu.test(text) || /^(?:che\s+abbonament\w*\s+ho|dimmi\s+(?:i\s+)?(?:miei\s+)?abbonament\w*)\b/iu.test(text)) &&!/\b(?:spend\w*|cost\w*|total\w*|al mese|all[’']anno)\b/iu.test(text)) {
    return { action: "list", kind: "subscription" };
  }
  const inCollections = /^\s*(?:cerca\w*|trova\w*)\s+(?:(.+?)\s+)?(?:nelle|tra\s+le|in)\s+(?:mie\s+)?collezioni\b\s*(.*)$/iu.exec(text);
  if (inCollections && !addVerb.test(text)) {
    const query = cleanTitle([inCollections[1], inCollections[2]].filter(Boolean).join(" ").replace(/^\s*(?:mi|me)\b/iu, " ").trim());
    return { action: "searchCollections", query: query || undefined } as Intent;
  }
  const list = /^\s*(?:mostra\w*|elenc\w*|fammi\s+vedere|vedi|(?:quali|che)(?=\s+cart[ae]\s+(?:ho|possiedo)\b))\s+(?:tutte\s+)?(?:le\s+)?(?:mie\s+)?cart[ae]\b(.*)$/iu.exec(text);
  if (list && !notCollectible.test(text)) {
    let rest = list[1];
    for (const [pattern] of cardGames) rest = rest.replace(pattern, " ");
    const query = cleanTitle(rest.replace(/\b(?:di|del|della|che\s+ho|ho|in|nella|collezione)\b/giu, " ").replace(/\s+/gu, " "));
    return { action: "searchCollections", collection: cardGame(text) ?? undefined, query: query || undefined, type: cardGame(text) ? undefined : "Carta" } as Intent;
  }
  const owned = /^\s*c[’']?è\s+(.+?)\s+(?:tra|nelle|fra)\s+(?:le\s+)?(?:mie\s+)?(?:cart[ae]|collezion\w*)\b/iu.exec(text);
  if (owned) return { action: "searchCollections", query: cleanTitle(owned[1].replace(/^(?:la\s+carta|il|la|lo)\s+/iu, "")) } as Intent;
  // "ho la carta di Sabo?", "ce l'ho Ace?": domanda breve sul possesso.
  const have = /^\s*(?:ce\s*l[’']?ho|ho)\s+(?:(?:la|una)\s+(?:cart[ae]|card)\s+(?:di\s+)?|già\s+)?(.{1,60}?)\s*\?\s*$/iu.exec(text);
  if (have && (/^\s*ce\s*l/iu.test(text) || cardWord.test(text)) && !notCollectible.test(text)) {
    let query = have[1];
    for (const [pattern] of cardGames) query = query.replace(pattern, " ");
    query = cleanTitle(query.replace(/^(?:la|il|lo|di)\s+/iu, "").replace(/\s+/gu, " "));
    if (query && query.split(" ").length <= 5) return { action: "searchCollections", collection: cardGame(text) ?? undefined, query } as Intent;
  }
  const find = /\b(?:trova\w*|cerca\w*|dov[’']?è|ce\s*l[’']?ho|ho\s+già)(?![\p{L}])/iu.exec(text);
  if (find && cardWord.test(text) && !addVerb.test(text) && !notCollectible.test(text)) {
    const game = cardGame(text);
    let query = text.slice(find.index + find[0].length).replace(cardWord, " ");
    for (const [pattern] of cardGames) query = query.replace(pattern, " ");
    query = cleanTitle(query.replace(/^\s*(?:mi|me)\b/iu, " ").replace(/\b(?:quella|questa|la|le|una|di|su|in|nella|collezione)\b/giu, " ").replace(/\s+/gu, " "));
    return { action: "searchCollections", collection: game, query: query || undefined } as Intent;
  }
}

const addVerb = /\b(?:aggiung\w*|catalog\w*|archivi\w*|salv\w*|registr\w*|inserisc\w*|metti)\b/iu;
export const explicitCollectionCreation = (text: string) => /\b(?:crea|creare|apri|istituisci)\s+(?:(?:una|la|una nuova)\s+)?collezione\b|\bnuova collezione\b/iu.test(text);
export const mentionsPhoto = (text: string) => /\b(?:foto|immagin[ei]|allegat[oa]|quest[oa]|quell[oa])\b/iu.test(text);

function cleanTitle(value: string) {
  return value.trim().replace(/[,\s]*\b(?:per\s+favore|per\s+piacere|grazie(?:\s+mille)?|pls|please)\b[.!?]*$/iu, "")
    .replace(/^["“«]+|["”»]+[.!?]*$/gu, "").trim().replace(/[.!?]+$/u, "").trim();
}

const months = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const datePattern = `(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/.]\\d{1,2}(?:[/.]\\d{2,4})?|\\d{1,2}\\s+(?:${months.join("|")})(?:\\s+\\d{4})?|oggi|domani|dopodomani|\\d{1,2})`;
const clockPattern = /\b(?:alle\s+(?:ore\s+)?|ore\s+)(\d{1,2})(?:(?:\s*[:.]\s*|\s+e\s+)(\d{2}))?\b/iu;

function officeDate(value: string, today: string) {
  const normalized = collectionSearch(value);
  const day = new Date(`${today}T12:00:00Z`);
  if (["oggi", "domani", "dopodomani"].includes(normalized)) {
    day.setUTCDate(day.getUTCDate() + ["oggi", "domani", "dopodomani"].indexOf(normalized));
    return day.toISOString().slice(0, 10);
  }
  let [year, month, date] = today.split("-").map(Number);
  const numeric = /^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2}|\d{4}))?$/u.exec(normalized);
  const named = /^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/u.exec(normalized);
  if (/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) [year, month, date] = normalized.split("-").map(Number);
  else if (numeric) {
    date = Number(numeric[1]); month = Number(numeric[2]);
    if (numeric[3]) year = Number(numeric[3]) + (numeric[3].length === 2 ? 2000 : 0);
  } else if (named) {
    date = Number(named[1]); month = months.indexOf(named[2]) + 1;
    if (named[3]) year = Number(named[3]);
  } else if (/^\d{1,2}$/u.test(normalized)) {
    if (Number(normalized) < date) {
      month++;
      if (month > 12) { month = 1; year++; }
    }
    date = Number(normalized);
  } else return;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
  const parsed = new Date(`${iso}T12:00:00Z`);
  if (Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso) return iso;
}

function explicitEntry(text: string, today: string): Intent | undefined {
  const subscription = new RegExp(`^.*?\\babbonamento\\s+(?:(mensile|annuale)\\s+)?(.+?)\\s+(?:la\\s+)?(?:data\\s+di\\s+)?rinnovo\\s+(?:è|e|al)\\s+(?:il\\s+)?(${datePattern})[.!?]?$`, "iu").exec(text);
  if (subscription) {
    const renewal = officeDate(subscription[3], today);
    if (!renewal) return { action: "clarify", message: "Qual è la data di rinnovo?" };
    return { action: "edit", kind: "subscription", title: cleanTitle(subscription[2]), changes: {
      renewal, cadence: subscription[1]?.toLowerCase() === "mensile" ? "monthly" : subscription[1] ? "yearly" : undefined,
    } };
  }
  const appended = /^(?:accoda|aggiungi|inserisci)\b.*?\b(?:nella|alla|in)\s+nota\s+([^:]+):\s*(.+)$/isu.exec(text);
  if (appended) return { action: "edit", kind: "note", title: cleanTitle(appended[1]), changes: {}, appendNotes: appended[2].trim() };
  const note = /^aggiungi\w*\s+(?:una\s+)?nota\s+con\s+scritto\s*[:,]?\s*(.+)$/isu.exec(text);
  if (note) return { action: "add", entry: { kind: "note", title: note[1].trim().split(/\s+/).slice(0, 6).join(" ").slice(0, 100), notes: note[1].trim() } };
  const appointment = /^(?:fissa\w*|segna\w*|aggiung\w*|registra\w*)\s+(?:un\s+)?appuntamento\s+(.+)$/isu.exec(text);
  if (appointment) {
    const clock = clockPattern.exec(appointment[1]);
    const withoutClock = appointment[1].replace(clockPattern, "").trim().replace(/[.!?]+$/u, "");
    const titleFirst = new RegExp(`^(.+?)\\s+(?:il|per)\\s+(${datePattern})$`, "iu").exec(withoutClock);
    const dateFirst = new RegExp(`^(?:per\\s+|il\\s+)?(${datePattern})\\s+(.+)$`, "iu").exec(withoutClock);
    const date = titleFirst?.[2] ?? dateFirst?.[1];
    const title = cleanTitle((titleFirst?.[1] ?? dateFirst?.[2] ?? "").replace(/^(?:con|per)\s+(?:(?:il|lo|la|un|una)\s+)?/iu, ""));
    if (date && title) {
      const day = officeDate(date, today);
      if (!day) return { action: "clarify", message: "Qual è la data dell’appuntamento?" };
      const time = clock ? `${clock[1].padStart(2, "0")}:${clock[2] ?? "00"}` : undefined;
      if (time && !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(time)) return { action: "clarify", message: "Qual è l’orario dell’appuntamento?" };
      return { action: "add", entry: { kind: "appointment", title, day, time } };
    }
  }
}

export function catalogTitleReply(text: string) {
  const reply = /^(?:(?:il\s+|la\s+)?(?:libro|rivista|gioco|oggetto|carta)\s+)?(?:si chiama|titolo(?: è)?)\s*[:=]?\s+(.+)$/iu.exec(text);
  const title = reply && cleanTitle(reply[1]);
  return title && title.length <= 160 ? title : undefined;
}

export function directOfficeIntent(text: string, hasImage: boolean, today: string): DirectPlan | undefined {
  const price = /\b(?:quanto\s+vale|quanto\s+costa|prezzo\s+(?:di|del|della)|valore\s+(?:di|del|della))\b/iu.exec(text);
  if (price && (cardWord.test(text) || cardGame(text) || /\b[a-z]{1,4}\d{2}-\d{3}\b/iu.test(text)) && !notCollectible.test(text) && !/\babbonament/iu.test(text)) {
    let title = text.slice(price.index + price[0].length).replace(cardWord, " ");
    for (const [pattern] of cardGames) title = title.replace(pattern, " ");
    title = cleanTitle(title.replace(/\b(?:la|il|mia|di|su|oggi|adesso|ora)\b/giu, " ").replace(/\s+/gu, " "));
    // Senza una carta precisa ("la carta più rara quanto vale?") è una domanda generale: resta alla chat.
    if (title) return { action: "price", title };
  }
  if (/\b(?:poi|inoltre|dopodiché|e\s+(?:(?:il|un|la|una)\s+)?(?:libro|rivista|altro)|con\s+(?:una\s+)?nota)\b/iu.test(text) || explicitCollectionCreation(text)) return;
  if (/\babbonament\w*\b/iu.test(text) && /\b(?:quanto|total\w*|spes\w*|cost\w*)\b/iu.test(text)) {
    if (/\b(?:al mese|mensil\w*)\b/iu.test(text)) return { action: "subscriptionTotal", period: "month" };
    if (/\b(?:all[’']anno|annua\w*|annuo|annui)\b/iu.test(text)) return { action: "subscriptionTotal", period: "year" };
  }
  const entry = explicitEntry(text, today);
  if (entry) return entry;
  const query = directQuery(text);
  if (query) return query;
  if (!addVerb.test(text)) return;
  if ((cardWord.test(text) || cardGame(text)) && !notCollectible.test(text) && !/\blibr[oi]\b|\brivist[ae]\b/iu.test(text)) return cardIntent(text, hasImage);
  const book = /\blibro\b/iu.exec(text);
  const category = book ? "book" : /\brivista\b/iu.test(text) ? "magazine" : undefined;
  const marker = /\b(?:si chiama|di nome|titolo(?: è)?|intitolat[oa])\s*[:=]?\s+(.+)$/iu.exec(text);
  const tail = book ? text.slice(book.index + book[0].length).trim() : "";
  const destination = /\b(?:nella|alla|in)\s+(?:mia\s+)?collezione\s+(.+)$/iu;
  const tailTitle = tail.replace(destination, "").trim();
  const titleAndDestination = marker?.[1] ?? (/^(?:(?:in|nella|alla)\s+(?:(?:mia|tua|la)\s+)?collezione\b|(?:in|della|nella)\s+foto\b|(?:allegato|fotografato)\b|di$)/iu.test(tailTitle) ? "" : tailTitle);
  const title = cleanTitle(titleAndDestination.replace(destination, ""));
  const collection = destination.exec(marker?.[1] ?? tail)?.[1];
  const target = collection && !/^(?:si chiama|titolo|chiamat[oa]?)$/iu.test(collection.trim()) && !/^(?:si chiama|titolo)\s/iu.test(collection) ? cleanTitle(collection) : undefined;
  if (category && title && title.length <= 160 && (!target || target.length <= 160)) {
    return { action: "catalogItem", category, title, collection: target || undefined };
  }
  if (hasImage && (/\bcatalog\w*\b/iu.test(text) || category)) {
    return { action: "catalogItem", category, collection: target || undefined };
  }
  return undefined;
}

const titles: Partial<Record<Kind, RegExp>> = {
  subscription: /^abbonament[oi](?:\s+(?:mensile|annuale))?(?:\s+(?:a|di))?\s+/u,
  appointment: /^appuntament[oi](?:\s+(?:con|per))?\s+/u,
  note: /^not[ae](?:\s+intitolat[ae])?\s+/u,
};
export function officeTitle(kind: Kind, value: string) {
  const text = collectionSearch(value).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return titles[kind] ? text.replace(titles[kind]!, "") : text;
}

export function editDistance(left: string, right: string) {
  let row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 0; i < left.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < right.length; j++) next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + Number(left[i] !== right[j])));
    row = next;
  }
  return row[right.length];
}

export function mentionsClock(text: string) {
  return /\b(?:ore|alle)\s*(?:\d{1,2}\b|una\b|due\b|tre\b|quattro\b|cinque\b|sei\b|sette\b|otto\b|nove\b|dieci\b|undici\b|dodici\b)|\b(?:\d{1,2}:\d{2}|mezzogiorno|mezzanotte)\b/iu.test(text);
}
