import { useEffect, useEffectEvent, useState } from "react";
import type { WorkSection, backgroundWork } from "../../backend/background_work";

type Snapshot = ReturnType<typeof backgroundWork>;
export type WorkCompletion = Snapshot["completed"][number];

export function useBackgroundWork(onCompletion: (work: WorkCompletion) => void) {
  const [sections, setSections] = useState<WorkSection[]>([]);
  const notify = useEffectEvent(onCompletion);

  useEffect(() => {
    const controller = new AbortController();
    let cursor: { instance: string; sequence: number } | undefined;
    let polling = false;
    async function poll() {
      if (polling || controller.signal.aborted) return;
      polling = true;
      try {
        const response = await fetch("/api/background-work", { signal: controller.signal });
        if (!response.ok) return;
        const data: Snapshot = await response.json();
        if (controller.signal.aborted || !Array.isArray(data.running) || !Array.isArray(data.completed)) return;
        const active = [...new Set(data.running.map(work => work.section))];
        setSections(current => current.length === active.length && current.every((section, index) => section === active[index]) ? current : active);
        const previous = cursor;
        cursor = { instance: data.instance, sequence: data.sequence };
        if (previous) {
          const sequence = previous.instance === data.instance ? previous.sequence : 0;
          for (const work of data.completed) if (work.sequence > sequence) notify(work);
        }
      } catch { /* Riprova al prossimo intervallo o al ritorno in primo piano. */ }
      finally { polling = false; }
    }
    const update = () => void poll();
    update();
    const interval = window.setInterval(update, 2500);
    document.addEventListener("visibilitychange", update);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return sections;
}
