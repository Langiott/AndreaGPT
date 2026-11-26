import { useEffect, useState } from "react";
import type { OfficeActivity } from "../../backend/office/office_schema";
import { officeAgents } from "../config/office_agents";

export function SidebarActivity({ visible }: { visible: boolean }) {
  const [activity, setActivity] = useState<OfficeActivity | null>(null);

  useEffect(() => {
    if (!visible) {
      setActivity(null);
      return;
    }
    const stream = new EventSource("/api/office/activity");
    stream.onmessage = event => setActivity(JSON.parse(event.data) as OfficeActivity | null);
    stream.onerror = () => setActivity(null);
    return () => stream.close();
  }, [visible]);

  if (!visible) return null;
  const activeRole = activity?.status === "queued" || activity?.status === "running" ? activity.stage : undefined;

  return <section className="sidebar-activity" aria-label="Squadra">
    <div className="sidebar-activity-row">
      <div className="sidebar-agent">
        <strong>Andrea</strong>
        <span className="sidebar-agent-frame">
          <img className="sidebar-mascot" src="/mascotte-sidebar.png" alt="" />
        </span>
      </div>
      {officeAgents.map(agent => <div key={agent.id} className={`sidebar-agent${activeRole === agent.id ? " active" : ""}`} title={agent.name}>
        <strong>{agent.character}</strong>
        <span className="sidebar-agent-frame"><span className="office-agent-portrait" style={agent.sidebarPortrait} /></span>
      </div>)}
    </div>
  </section>;
}
