import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { localOllamaUrl } from "../utils/local";

const bytes = z.number().nonnegative();
const percentage = z.number().min(0).max(100).nullable();
const celsius = z.number().min(0).max(130);
const historyPoint = z.object({
  at: z.string(), cpu: percentage, gpu: percentage, ram: percentage, disk: percentage,
  temperature: celsius.nullable(), sensorId: z.string().nullable(),
});
const hostSample = z.object({
  at: z.string(), source: z.string(), manufacturer: z.string(), model: z.string(), os: z.string(), boot: z.string().nullable(),
  processor: z.string(), threads: z.number().int().nonnegative(), graphics: z.array(z.string()),
  cpu: percentage, gpu: percentage, systemDrive: z.string(),
  memory: z.object({ total: bytes.positive(), free: bytes }).nullable(),
  disks: z.array(z.object({ drive: z.string(), label: z.string(), total: bytes.positive(), free: bytes })),
  temperatures: z.array(z.object({ id: z.string(), label: z.string(), source: z.string(), celsius })),
  history: z.array(historyPoint).max(180),
});

export type SystemHistoryPoint = z.infer<typeof historyPoint>;
export type SystemHost = Omit<z.infer<typeof hostSample>, "history">;
export type SystemSnapshot = {
  host: SystemHost | null;
  history: SystemHistoryPoint[];
  stale: boolean;
  loadedModels: string[] | null;
};

async function readHostSample(outputRoot: string) {
  const file = path.join(process.env.DIAGNOSTICS_DIR || path.join(outputRoot, "Log"), "host-system.json");
  try {
    return hostSample.parse(JSON.parse(await readFile(file, "utf8")));
  } catch {
    return null;
  }
}

async function readLoadedModels(ollamaBase: string) {
  try {
    const response = await fetch(`${localOllamaUrl(ollamaBase)}/api/ps`, {
      signal: AbortSignal.timeout(1500), redirect: "error",
    });
    if (!response.ok) return null;
    const payload = z.object({ models: z.array(z.object({ name: z.string().optional(), model: z.string().optional() })) }).parse(await response.json());
    const names = payload.models.flatMap(item => item.name || item.model || []);
    return [...new Set(names)];
  } catch {
    return null;
  }
}

export async function getSystemSnapshot(outputRoot: string, ollamaBase: string): Promise<SystemSnapshot> {
  const [sample, loadedModels] = await Promise.all([readHostSample(outputRoot), readLoadedModels(ollamaBase)]);
  if (!sample) return { host: null, history: [], stale: true, loadedModels };

  const { history, ...host } = sample;
  const now = Date.now();
  const latest = Date.parse(host.at);
  if (!Number.isFinite(latest) || latest > now + 5000) return { host: null, history: [], stale: true, loadedModels };

  return {
    host, loadedModels,
    stale: now - latest > 30_000,
    history: history.filter(point => {
      const at = Date.parse(point.at);
      return at >= now - 30 * 60_000 && at <= latest;
    }),
  };
}
