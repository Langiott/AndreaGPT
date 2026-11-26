import { Resolver } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { Agent, fetch } from "undici";
import { OfficeError } from "./office_error";

const blocked = new BlockList();
for (const [address, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 3],
] as const) blocked.addSubnet(address, bits);
for (const [address, bits] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const) {
  blocked.addSubnet(address, bits, "ipv6");
}
const globalIPv6 = new BlockList();
globalIPv6.addSubnet("2000::", 3, "ipv6");

function publicAddress(address: string, family: number) {
  return family === 4 ? !blocked.check(address)
    : globalIPv6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", egrave: "è", eacute: "é", agrave: "à", igrave: "ì", ograve: "ò", ugrave: "ù" };
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, value: string) => {
  if (!value.startsWith("#")) return entities[value] ?? entity;
  const code = /^#x/i.test(value) ? parseInt(value.slice(2), 16) : Number(value.slice(1));
  return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
}).replace(/\s+/g, " ").trim();

export async function readPageForNote(link: string) {
  let url = new URL(link);
  const signal = AbortSignal.timeout(18_000);
  const resolver = new Resolver({ timeout: 2000, tries: 2 });
  const maxBytes = 2_000_000;
  for (let hop = 0; hop < 5; hop++) {
    const host = url.hostname;
    if (!/^https?:$/.test(url.protocol) || url.port || url.username || url.password || !host.includes(".") || isIP(host) || host.endsWith(".ts.net")) {
      throw new OfficeError("Usa il link HTTP o HTTPS di una pagina pubblica.");
    }
    url.hash = "";
    const resolutions = await Promise.allSettled([resolver.resolve4(host), resolver.resolve6(host)]);
    const addresses = resolutions.flatMap((result, index) => result.status === "fulfilled"
      ? result.value.map(address => ({ address, family: index === 0 ? 4 : 6 })) : []);
    if (!addresses.length || addresses.some(({ address, family }) => !publicAddress(address, family))) {
      throw new OfficeError("Usa il link di una pagina pubblica.");
    }
    // Il socket usa solo indirizzi già controllati, anche dopo un redirect.
    const dispatcher = new Agent({ connect: { lookup: (_host, options, callback) => {
      const candidates = addresses.filter(record => !options.family || record.family === options.family);
      if (!candidates.length) { callback(Object.assign(new Error("Indirizzo non disponibile."), { code: "ENOTFOUND" }), "", 0); return; }
      if (options.all) callback(null, candidates);
      else callback(null, candidates[0].address, candidates[0].family);
    } } });
    try {
      const response = await fetch(url, { dispatcher, signal, redirect: "manual", headers: { Accept: "text/html, application/xhtml+xml, text/plain" } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) throw new OfficeError("Reindirizzamento della pagina incompleto.");
        url = new URL(location, url);
        continue;
      }
      const type = response.headers.get("content-type") ?? "";
      if (!response.ok || !response.body || !/^(?:text\/(?:html|plain)|application\/xhtml\+xml)(?:;|$)/i.test(type)) {
        await response.body?.cancel();
        throw new OfficeError(`Pagina non leggibile come testo (HTTP ${response.status}).`);
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (bytes < maxBytes) {
          const chunk = await reader.read();
          if (chunk.done) break;
          const admitted = chunk.value.subarray(0, maxBytes - bytes);
          chunks.push(admitted);
          bytes += admitted.length;
        }
      } finally { await reader.cancel().catch(() => undefined); }
      const payload = Buffer.concat(chunks, bytes);
      const charset = /charset\s*=\s*["']?([\w-]+)/i.exec(type)?.[1]
        ?? /<meta\b[^<>]*charset\s*=\s*["']?([\w-]+)/i.exec(payload.toString("latin1", 0, 8192))?.[1];
      let decoder = new TextDecoder();
      if (charset) {
        try { decoder = new TextDecoder(charset); }
        catch { /* UTF-8 per etichette di codifica sconosciute. */ }
      }
      const html = decoder.decode(payload);
      const title = text(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? host);
      const content = html.replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<(script|style|nav|header|footer|aside|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
      // Prima i paragrafi <p>: è il testo vero della pagina. Il resto (tabelle, infobox, attributi con JSON
      // come su Wikipedia) inquina il riassunto. Fallback: article/main o pagina intera.
      const cleaned = content.replace(/<(table|figure|sup|form|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/\s(?:data-[\w-]+|style|class|about|typeof)\s*=\s*(?:"[^"]*"|'[^']*')/gi, "");
      const paragraphs = [...cleaned.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(match => text(match[1])).filter(paragraph => paragraph.length > 40);
      const fromParagraphs = paragraphs.join("\n");
      const body = (fromParagraphs.length > 400 ? fromParagraphs : text(cleaned.match(/<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i)?.[2] ?? cleaned)).slice(0, 12_000);
      if (body.length < 60) throw new OfficeError("La pagina non contiene abbastanza testo per un riassunto.");
      return { title, body, url: url.href };
    } finally { await dispatcher.destroy(); }
  }
  throw new OfficeError("Troppi reindirizzamenti per leggere la pagina.");
}
