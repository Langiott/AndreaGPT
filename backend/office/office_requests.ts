import type { Intent } from "./office_schema";
import type { Kind } from "./office_sections";
import { collectionSearch } from "./collection_search";

export const catalogTypes = {
  book: { collection: "Libri", type: "Libro" },
  magazine: { collection: "Riviste", type: "Rivista" },
  game: { collection: "Giochi", type: "Gioco" },
  object: { collection: "Oggetti", type: "Oggetto" },
} as const;
export const catalogCategories = ["book", "magazine", "game", "object"] as const;

const addVerb = /\b(?:aggiung\w*|catalog\w*|archivi\w*|salv\w*|registr\w*|inserisc\w*|metti)\b/iu;
export const explicitCollectionCreation = (text: string) => /\b(?:crea|creare|apri|istituisci)\s+(?:(?:una|la|una nuova)\s+)?collezione\b|\bnuova collezione\b/iu.test(text);
export const mentionsPhoto = (text: string) => /\b(?:foto|immagin[ei]|allegat[oa]|quest[oa]|quell[oa])\b/iu.test(text);

function cleanTitle(value: string) {
  return value.trim().replace(/^["“«]+|["”»]+[.!?]*$/gu, "").trim().replace(/[.!?]+$/u, "").trim();
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
  const reply = /^(?:(?:il\s+)?(?:libro|rivista|gioco|oggetto)\s+)?(?:si chiama|titolo(?: è)?)\s*[:=]?\s+(.+)$/iu.exec(text);
  const title = reply && cleanTitle(reply[1]);
  return title && title.length <= 160 ? title : undefined;
}

export function directOfficeIntent(text: string, hasImage: boolean, today: string): Intent | undefined {
  if (/\b(?:poi|inoltre|dopodiché|e\s+(?:(?:il|un|la|una)\s+)?(?:libro|rivista|altro)|con\s+(?:una\s+)?nota)\b/iu.test(text) || explicitCollectionCreation(text)) return;
  if (/\babbonament\w*\b/iu.test(text) && /\b(?:quanto|total\w*|spes\w*|cost\w*)\b/iu.test(text)) {
    if (/\b(?:al mese|mensil\w*)\b/iu.test(text)) return { action: "subscriptionTotal", period: "month" };
    if (/\b(?:all[’']anno|annua\w*|annuo|annui)\b/iu.test(text)) return { action: "subscriptionTotal", period: "year" };
  }
  const entry = explicitEntry(text, today);
  if (entry) return entry;
  if (!addVerb.test(text)) return;
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
