import { z } from "zod";
import { extraKinds, kinds, operations } from "./office_sections";
import { collectionIntents } from "./office_collections";
import { officeAttachmentCount, officeAttachmentLimit, type OfficeAttachment } from "./office_attachment_limits";
import { catalogCategories } from "./office_requests";
export { labels } from "./office_sections";

const name = z.string().trim().min(1).max(160);
const detail = z.string().trim().max(100).nullish();
const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/);
const amount = z.number().nonnegative().max(10_000_000);
const day = z.iso.date();
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullish();
export const webUrl = z.url({ protocol: /^https?$/ }).max(2000);

const appointment = z.object({ kind: z.literal("appointment"), title: name, day, time: clock });
const subscription = z.object({ kind: z.literal("subscription"), title: name, renewal: day.nullish(), cadence: z.enum(["monthly", "yearly", "other"]).nullish(), amount: amount.nullish(), currency: currency.nullish() });
const card = z.object({ kind: z.literal("card"), title: name, edition: detail, number: detail, condition: detail });
const film = z.object({ kind: z.literal("film"), title: name, watched: z.boolean().optional() });
const extraDetails = z.object({
  day: day.nullish(), deadline: day.nullish(), amount: amount.nullish(), currency: currency.nullish(),
  photoId: z.number().int().positive().nullish(), url: webUrl.nullish(), ref: detail,
  notes: z.string().trim().max(4000).nullish(),
});
const extraEntry = extraDetails.extend({ kind: z.enum(extraKinds), title: name });
export const entrySchema = z.discriminatedUnion("kind", [appointment, subscription, card, film, extraEntry]);
const changes = extraDetails.extend({
  title: name.optional(), time: clock, renewal: day.nullish(), cadence: subscription.shape.cadence,
  edition: detail, number: detail, condition: detail, watched: z.boolean().optional(),
});
export const operationSchema = z.enum(operations);

export const intentSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), entry: entrySchema }),
  z.object({ action: z.literal("list"), kind: z.enum(kinds).nullish(), query: name.nullish(), days: z.number().int().min(0).max(3650).nullish() }),
  z.object({ action: z.literal("edit"), kind: z.enum(kinds), title: name, changes, appendNotes: z.string().trim().min(1).max(4000).optional() }),
  z.object({ action: z.literal("remove"), kind: z.enum(kinds), title: name }),
  z.object({ action: z.literal("operate"), kind: z.enum(extraKinds), title: name, operation: operationSchema }),
  z.object({ action: z.literal("price"), title: name }),
  z.object({ action: z.literal("subscriptionTotal"), period: z.enum(["month", "year"]) }),
  z.object({ action: z.literal("catalogItem"), category: z.enum(catalogCategories).nullish(), title: name.nullish(), collection: name.nullish() }),
  z.object({ action: z.literal("photos"), query: name, documents: z.boolean().optional() }),
  z.object({ action: z.literal("clarify"), message: z.string().trim().min(1).max(300) }),
  z.object({ action: z.literal("migrateCards") }),
  z.object({ action: z.literal("cardSet"), set: z.string().trim().regex(/^[A-Za-z]{1,4}\d{1,3}$/), collection: name.nullish() }),
  z.object({ action: z.literal("undo") }),
  ...collectionIntents,
]);
export const planSchema = z.object({ actions: z.array(intentSchema).min(1).max(12) });
export const catalogPhotoSchema = z.object({ category: z.enum(catalogCategories).nullish(), title: name.nullish() });

export const priceSchema = z.object({ amount, currency, url: webUrl });
const attachmentInput = z.object({
  name: z.string().trim().min(1).max(240),
  data: z.base64().min(4).max(4 * Math.ceil(officeAttachmentLimit / 3)),
});
export type AttachmentInput = z.infer<typeof attachmentInput>;
export const requestSchema = z.object({
  text: z.string().trim().max(1200).default(""),
  attachments: z.array(attachmentInput).max(officeAttachmentCount).default([]),
}).refine(input => input.text || input.attachments.length, "Aggiungi un messaggio o un allegato.");
export type Intent = z.infer<typeof intentSchema>;
export type Entry = z.infer<typeof entrySchema>;
export type Price = z.infer<typeof priceSchema> & { checkedAt: string };
export type RecordItem = Entry & { id: string; price?: Price };
export type Match = { title: string; url: string; snippet: string; candidate?: { amount: number; currency: string } };
export type Undo = { type: "entry"; id: string } | { type: "item"; id: string } | { type: "collection"; id: string };
export type Result = { message: string; undo?: Undo[]; undone?: boolean; cardId?: string; sources?: Match[]; photos?: number[]; view?: string; confirmation?: { code: string; description: string }; steps?: Result[];
  catalogDraft?: { category: typeof catalogCategories[number]; imageIds: string[]; collection?: string };
};
export type Role = "secretary" | "executor" | "keeper" | "director";
export type Job = { id: string; channel: "board" | "telegram"; chatText?: string; attachments?: OfficeAttachment[]; confirmedCode?: string; status: "queued" | "running" | "done" | "error"; stage: Role; label: string; section?: Entry["kind"] | "photos" | "collections"; target?: string; failedRole?: Role; createdAt: string; result?: Result; events: { role: Role; text: string; at: string }[] };
export type OfficeActivity = Pick<Job, "id" | "stage" | "status">;

export function sensitive(text: string) {
  return /\b(?:\d[ -]?){12,19}\b|\b(?:cvv|cvc|iban|numero di carta)\s*[:=]?\s*[a-z0-9]{3,}/i.test(text);
}

export function localDay(timeZone: string, date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function priceCandidate(text: string): Match["candidate"] {
  const amounts = new Map<string, NonNullable<Match["candidate"]>>();
  for (const match of text.matchAll(/(?:\b(EUR|USD|GBP)\b|([€£]))\s*(\d{1,6}(?:[.,]\d{2})?)(?![\d.,]|\s+\d)|(?<!\d\s)(?<![\d.,])(\d{1,6}(?:[.,]\d{2})?)\s*(?:\b(EUR|USD|GBP)\b|([€£]))/gi)) {
    const rawCurrency = match[1] || match[2] || match[5] || match[6];
    const currency = rawCurrency === "€" ? "EUR" : rawCurrency === "£" ? "GBP" : rawCurrency.toUpperCase();
    const amount = Number((match[3] || match[4]).replace(",", "."));
    amounts.set(`${currency}:${amount}`, { amount, currency });
  }
  return amounts.size === 1 ? amounts.values().next().value : undefined;
}
