import { fetch } from "undici";
import { z } from "zod";
import { OfficeError } from "./office";
import type { ExtraKind, Operation } from "./office_sections";

export async function runOfficeConnection(kind: ExtraKind, operation: Operation, target: string) {
  const variable = kind === "email" ? "OFFICE_EMAIL_WEBHOOK" : kind === "github" ? "OFFICE_GITHUB_WEBHOOK" : kind === "home" ? "OFFICE_HOME_WEBHOOK" : "";
  const endpoint = variable && process.env[variable]?.trim();
  const secret = process.env.OFFICE_WEBHOOK_TOKEN?.trim();
  if (!endpoint || !secret) throw new OfficeError(`Configura ${variable || "il workflow"} e OFFICE_WEBHOOK_TOKEN.`);
  if (!/^\/webhook\/[a-zA-Z0-9_-]+$/.test(endpoint)) throw new OfficeError("Percorso webhook non valido.");
  if (kind === "github" && !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/.test(target)) throw new OfficeError("Indica il repository come owner/repo.");
  if (kind === "home" && (!/^[a-z][a-z0-9_]*\.[a-z0-9_]+$/.test(target) || (operation !== "sync" && !target.startsWith("light.")))) {
    throw new OfficeError("Indica un ID Home Assistant; accensione e spegnimento sono limitati alle luci.");
  }
  const url = new URL(endpoint, process.env.N8N_URL || "http://127.0.0.1:5678");
  const response = await fetch(url, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ section: kind, action: operation, target }),
  });
  if (!response.ok) throw new OfficeError(`Workflow non riuscito (HTTP ${response.status}).`);
  const result = z.object({ message: z.string().trim().min(1).max(1500) }).safeParse(await response.json());
  if (!result.success) throw new OfficeError("Il workflow deve rispondere con un campo JSON message.");
  return result.data.message;
}
