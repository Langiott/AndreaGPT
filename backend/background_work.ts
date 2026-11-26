import { randomUUID } from "node:crypto";

const running = new Map<string, BackgroundWork>();
const completed: FinishedWork[] = [];
let sequence = 0;
const instance = randomUUID();

export type WorkSection = "Social" | "Foto" | "Brain" | "Code" | "Output";
type BackgroundWork = { id: string; section: WorkSection; label: string };
type FinishedWork = BackgroundWork & { sequence: number; outcome: "done" | "error" | "cancelled" };

export function beginWork(section: WorkSection, label: string) {
  const work = { id: randomUUID(), section, label };
  running.set(work.id, work);
  return (outcome: FinishedWork["outcome"]) => {
    if (!running.delete(work.id)) return;
    completed.push({ ...work, sequence: ++sequence, outcome });
    if (completed.length > 80) completed.shift();
  };
}

export function backgroundWork() {
  return { instance, running: [...running.values()], completed, sequence };
}
