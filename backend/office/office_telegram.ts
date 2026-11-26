import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { cloudTransport } from "../config/config";
import { fetch } from "undici";
import { OfficeError, type createOffice } from "./office";
import { requestSchema } from "./office_schema";

const updateSchema = z.object({ update_id: z.number().int(), message: z.object({
  message_id: z.number().int(), text: z.string().optional(),
  chat: z.object({ id: z.number().int(), type: z.string() }),
  from: z.object({ id: z.number().int() }).optional(),
}).optional() });

export function telegramOffice(office: ReturnType<typeof createOffice>, token = "", owner = "", viewBase = "") {
  const configured = /^\d+:[\w-]+$/.test(token) && /^[1-9]\d*$/.test(owner);
  let status: "off" | "starting" | "online" | "error" = configured ? "starting" : "off";
  const stop = new AbortController();
  let started = false;

  async function api(method: "getUpdates" | "sendMessage", body: object) {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      dispatcher: cloudTransport, signal: AbortSignal.any([stop.signal, AbortSignal.timeout(35_000)]),
    });
    if (!response.ok) throw new Error("Telegram non raggiungibile");
    const envelope = z.object({ ok: z.literal(true), result: z.unknown() }).parse(await response.json());
    return envelope.result;
  }

  async function poll() {
    let offset: number | undefined;
    while (!stop.signal.aborted) {
      try {
        const updates = z.array(updateSchema).parse(await api("getUpdates", { offset, timeout: 20, limit: 10, allowed_updates: ["message"] }));
        status = "online";
        for (const update of updates) {
          if (stop.signal.aborted) return;
          const message = update.message;
          if (message && message.chat.type === "private" && String(message.chat.id) === owner && String(message.from?.id) === owner) {
            let reply: string | undefined;
            const request = requestSchema.safeParse({ text: message.text });
            if (!request.success || /^\/(start|help)(\s|$)/.test(request.data.text)) {
              reply = "Scrivimi una richiesta di testo (fino a 1200 caratteri): appuntamenti, abbonamenti, film, carte da collezione o ricerca nell’indice Foto. Non inviare credenziali, documenti o dati bancari.";
            } else {
              try {
                const job = await office.request(request.data.text, "telegram", `${token.split(":")[0]}:${owner}:${update.update_id}:${message.message_id}`).done;
                reply = job?.result?.message;
                if (reply && job?.result?.view && viewBase) {
                  const url = URL.parse(job.result.view, viewBase);
                  if (url && ["http:", "https:"].includes(url.protocol) && !url.username && !url.password) reply += `\nApri AndreaGPT sul PC: ${url.href}`;
                }
              } catch (error) {
                if (!(error instanceof OfficeError)) throw error;
                reply = error.message;
              }
            }
            if (reply && !stop.signal.aborted) await api("sendMessage", { chat_id: owner, text: reply.slice(0, 3900), link_preview_options: { is_disabled: true } });
          }
          offset = update.update_id + 1;
        }
      } catch {
        if (stop.signal.aborted) return;
        status = "error";
        await delay(5_000, undefined, { signal: stop.signal }).catch(() => undefined);
      }
    }
  }

  return { status: () => status, start: () => { if (configured && !started) { started = true; void poll(); } }, close: () => stop.abort() };
}
