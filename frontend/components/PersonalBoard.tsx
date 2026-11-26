import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Activity, CalendarDays, Camera, ChevronLeft, ChevronRight, Clapperboard, Download, FileText, FolderOpen, GitBranch, House, Images, Layers, Mail, Notebook, Paperclip, Pencil, Send, ShoppingBag, Trash2, Wallet, X } from "lucide-react";
import type { Entry, Job, RecordItem, Result, Role } from "../../backend/office/office_schema";
import { officeAttachmentCount, officeAttachmentLimit } from "../../backend/office/office_attachment_limits";
import { extraFields, isExtra, kinds, labels, sectionActions, type Operation } from "../../backend/office/office_sections";
import type { ModelInfo } from "../types/types";
import { writeClipboard } from "../utils/clipboard";
import { SearchField } from "./SearchField";
import { readFileBase64 } from "../utils/files";
import { MessageActions } from "./MessageActions";
import { officeAgents as roles } from "../config/office_agents";
import { OfficeCollections, type CollectionSelection } from "./OfficeCollections";
import { OfficeConfirmation, type OfficeConfirmationRequest } from "./OfficeConfirmation";
import "./personal-board.css";

const archives = [
  { kind: "appointment", title: "Calendario", icon: CalendarDays },
  { kind: "subscription", title: "Abbonamenti", icon: Wallet },
  { kind: "card", title: "Carte", icon: Layers },
  { kind: "film", title: "Film", icon: Clapperboard },
  { kind: "document", title: "Documenti", icon: FileText },
  { kind: "purchase", title: "Acquisti", icon: ShoppingBag },
  { kind: "email", title: "Email", icon: Mail },
  { kind: "github", title: "GitHub", icon: GitBranch },
  { kind: "home", title: "Domotica", icon: House },
  { kind: "note", title: "Note", icon: Notebook },
] as const;
const statuses = { queued: "In coda", running: "In corso", done: "Completata", error: "Da verificare" };
type Snapshot = { today: string; timeZone: string; entries: RecordItem[]; renewals?: { id: string; title: string; renewal: string; days: number; amount?: number | null; currency?: string | null }[]; jobs: Job[]; chat: Job[]; jobCount: number; latestFailure?: Job; model: string };
type Tab = "log" | "collections" | Entry["kind"];
const linkedTab = (params: URLSearchParams): Tab => {
  const section = params.get("office");
  if (section === "collections" || section === "log") return section;
  return kinds.find(kind => kind === section) ?? "appointment";
};
const collectionSelection = (params: URLSearchParams): CollectionSelection => ({
  collection: params.get("collection") ?? undefined, item: params.get("item") ?? undefined,
  query: params.get("q") ?? undefined, type: params.get("type") ?? undefined,
});
const roleName = (id: Role) => roles.find(role => role.id === id)?.name ?? id;
const shortRoles: Record<Role, string> = { secretary: "Segr.", executor: "Esec.", director: "Amm.", keeper: "Mag." };
const shortEvents: Record<string, string> = {
  "Richiesta in coda": "In coda",
  "Richiesta presa in carico": "Presa in carico",
  "Interpreto la richiesta": "Analisi",
  "Esito registrato": "Esito",
  "Operazione non riuscita": "Errore",
  "Interrotta dal riavvio": "Riavvio",
  "Registro la voce nell’archivio locale": "Registrazione",
  "Leggo l’archivio locale": "Lettura",
  "Aggiorno la voce": "Aggiornamento",
  "Ricerca nell’indice Foto": "Ricerca foto",
  "Ricerca fonti per il prezzo": "Ricerca prezzo",
  "Cerco fonti pubbliche per la carta": "Ricerca carta",
};
function shortEvent(value: string) {
  const words = value.trim().split(/\s+/);
  return shortEvents[value] ?? (words.length > 3 ? `${words.slice(0, 3).join(" ")}…` : value);
}
const jobSection = (job: Job) => job.section === "photos" ? "Foto" : job.section === "collections" ? "Collezioni" : job.section ? labels[job.section] : "Generale";
const fieldValue = (item: RecordItem | undefined, name: string): string | number => {
  const value = (item as unknown as Record<string, unknown> | undefined)?.[name];
  return typeof value === "string" || typeof value === "number" ? value : "";
};
const money = (amount: number, currency?: string | null) => currency ? `${amount.toLocaleString("it-IT", { maximumFractionDigits: 2 })} ${currency}` : `${amount.toLocaleString("it-IT")} (valuta non indicata)`;
const dateLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("it-IT", { timeZone: "UTC" });

async function getOffice(signal?: AbortSignal): Promise<Snapshot> {
  const response = await fetch("/api/office", { signal, cache: "no-store" });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "Mainboard non disponibile.");
  return response.json();
}

export function PersonalBoard({ models, startInChat }: { models: ModelInfo[]; startInChat: boolean }) {
  const [headerActions, setHeaderActions] = useState<HTMLElement | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [tab, setTab] = useState<Tab>(() => linkedTab(new URLSearchParams(location.search)));
  const [focusId, setFocusId] = useState(() => new URLSearchParams(location.search).get("entry") ?? "");
  const [query, setQuery] = useState(() => new URLSearchParams(location.search).get("q") ?? "");
  const [selection, setSelection] = useState(() => collectionSelection(new URLSearchParams(location.search)));
  const [collectionKey, setCollectionKey] = useState(0);
  const [confirmation, setConfirmation] = useState<OfficeConfirmationRequest>();
  const nav = useRef<HTMLDivElement>(null);
  const [logSection, setLogSection] = useState<Entry["kind"] | "">("");
  const [selectedEvent, setSelectedEvent] = useState("");
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [offset, setOffset] = useState(0);
  const [historyPage, setHistoryPage] = useState<{ jobs: Job[]; total: number }>();
  const [historyError, setHistoryError] = useState("");
  const [text, setText] = useState("");
  const [draftFiles, setDraftFiles] = useState<File[]>([]);
  const [attachmentPicker, setAttachmentPicker] = useState(false);
  const galleryInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const [chatOpen, setChatOpen] = useState(startInChat);
  const [copiedMessage, setCopiedMessage] = useState("");
  const chatHistory = useRef<HTMLDivElement>(null);
  const chatInput = useRef<HTMLTextAreaElement>(null);
  const requestInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<RecordItem>();
  const [price, setPrice] = useState<{ id: string; url: string; amount?: number; currency?: string }>();
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [settings, setSettings] = useState(false);
  const [model, setModel] = useState("");
  const useHistory = tab === "log" && (offset > 0 || !!query.trim() || !!logSection || onlyErrors);
  useEffect(() => { setHeaderActions(document.getElementById("personal-board-actions")); }, []);

  useEffect(() => {
    setHistoryPage(undefined);
    setHistoryError("");
    if (!useHistory) return;
    const controller = new AbortController();
    const parameters = new URLSearchParams({ offset: String(offset), section: logSection, errors: onlyErrors ? "1" : "0", query: query.trim() });
    const timeout = setTimeout(async () => {
      try {
        const result = await fetch(`/api/office/history?${parameters}`, { signal: controller.signal, cache: "no-store" });
        if (!result.ok) throw new Error();
        const page = await result.json();
        if (!controller.signal.aborted) setHistoryPage(page);
      } catch { if (!controller.signal.aborted) setHistoryError("Impossibile caricare il registro."); }
    }, 200);
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [useHistory, offset, logSection, onlyErrors, query, snapshot?.jobs[0]?.id, snapshot?.jobs[0]?.status, snapshot?.jobs[0]?.events.length]);

  useEffect(() => {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout>;
    async function poll() {
      try { const next = await getOffice(controller.signal); if (!controller.signal.aborted) { setSnapshot(next); setLoadError(""); } }
      catch (error) { if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Mainboard non disponibile."); }
      if (!controller.signal.aborted) timeout = setTimeout(poll, 2500);
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timeout); };
  }, []);

  async function mutate(path: string, method: string, payload?: object | (() => Promise<object>)) {
    setBusy(true);
    setError("");
    try {
      const body = typeof payload === "function" ? await payload() : payload;
      const response = await fetch(`/api/office${path}`, { method, ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "Operazione non riuscita.");
      const updated = await getOffice().catch(() => undefined);
      if (updated) setSnapshot(updated);
      return true;
    } catch (error) { setError(error instanceof Error ? error.message : "Operazione non riuscita."); return false; }
    finally { setBusy(false); }
  }

  async function send() {
    const files = chatOpen ? draftFiles : [];
    if (busy || !snapshot || (!text.trim() && !files.length)) return;
    if (await mutate("/requests", "POST", files.length ? async () => {
      const attachments = [];
      for (const file of files) attachments.push({ name: file.name.slice(0, 240), data: await readFileBase64(file) });
      return { text, attachments };
    } : { text })) {
      setText(current => current === text ? "" : current);
      if (files.length) setDraftFiles([]);
      setAttachmentPicker(false);
      setChatOpen(true);
    }
  }

  function pickAttachments(input: HTMLInputElement) {
    const selected = Array.from(input.files ?? []);
    input.value = "";
    if (busy || !selected.length) return;
    const next = [...draftFiles, ...selected];
    if (next.length > officeAttachmentCount || next.some(file => !file.size) || next.reduce((size, file) => size + file.size, 0) > officeAttachmentLimit) {
      setError("Puoi allegare fino a 8 file non vuoti per un totale di 32 MB.");
      return;
    }
    setError("");
    setDraftFiles(next);
    setAttachmentPicker(false);
  }

  function messageActions(id: string, content: string) {
    return <MessageActions copied={copiedMessage === id} onCopy={async () => {
      try {
        await writeClipboard(content);
        setCopiedMessage(id);
      } catch { setError("Non sono riuscito a copiare il testo negli appunti."); }
    }} onEdit={() => {
      setText(content.slice(0, 1200));
      chatInput.current?.focus();
    }} />;
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    if (await mutate("/settings/model", "PUT", { provider: "ollama", model })) setSettings(false);
  }

  async function add(event: FormEvent<HTMLFormElement>, kind: Entry["kind"]) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const field = (name: string) => String(data.get(name) ?? "").trim() || undefined;
    const title = field("title") ?? "";
    const amount = field("amount");
    const entry = kind === "appointment" ? { kind, title, day: field("day"), time: field("time") }
      : kind === "subscription" ? { kind, title, renewal: field("renewal"), cadence: field("cadence"), amount: amount == null ? undefined : Number(amount), currency: amount == null ? undefined : field("currency") }
      : kind === "card" ? { kind, title, edition: field("edition"), number: field("number"), condition: field("condition") }
      : kind === "film" ? { kind, title, watched: editing?.kind === "film" ? editing.watched : false }
      : { kind, title, ...Object.fromEntries(Object.keys(extraFields[kind]).map(name => {
        const value = field(name);
        return [name, value && (name === "amount" || name === "photoId") ? Number(value) : value];
      })) };
    if (await mutate(editing ? `/entries/${editing.id}` : "/entries", editing ? "PUT" : "POST", entry)) {
      setAdding(false);
      setEditing(undefined);
    }
  }

  function selectTab(next: Tab, entry = "", section: Entry["kind"] | "" = "") {
    setChatOpen(false);
    setLogSection(section);
    setTab(next);
    setFocusId(entry);
    setQuery("");
    setOffset(0);
    setSelectedEvent("");
    setAdding(false);
    setEditing(undefined);
  }

  async function runAction(item: RecordItem, operation: Operation, label: string) {
    const run = async () => { if (await mutate(`/entries/${item.id}/action`, "POST", { operation })) selectTab("log"); };
    if (operation === "on" || operation === "off" || item.kind === "github") {
      setConfirmation({ title: label, description: `Eseguire l’azione su «${item.title}»?`, label: "Conferma", action: () => void run() });
    } else await run();
  }

  async function storePrice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!price) return;
    const data = new FormData(event.currentTarget);
    if (await mutate(`/entries/${price.id}/price`, "PUT", { amount: Number(data.get("amount")), currency: data.get("currency"), url: data.get("url") })) {
      setPrice(undefined);
      setTab("card");
    }
  }

  const entries = snapshot?.entries ?? [];
  const jobs = snapshot?.jobs ?? [];
  const chat = snapshot?.chat ?? [];
  const latestChat = chat.at(-1);
  useEffect(() => {
    const textarea = chatInput.current;
    if (!textarea) return;
    textarea.style.height = "";
    if (textarea.scrollHeight > textarea.clientHeight) textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [chatOpen, text]);
  useEffect(() => {
    if (!copiedMessage) return;
    const timer = window.setTimeout(() => setCopiedMessage(""), 1800);
    return () => window.clearTimeout(timer);
  }, [copiedMessage]);
  useEffect(() => {
    const history = chatHistory.current;
    if (!chatOpen || !history) return;
    const follow = () => { history.scrollTop = history.scrollHeight; };
    follow();
    let height = history.clientHeight;
    const observer = new ResizeObserver(() => {
      if (height !== history.clientHeight) follow();
      height = history.clientHeight;
    });
    observer.observe(history);
    return () => observer.disconnect();
  }, [chatOpen, latestChat?.id, latestChat?.status]);
  const logJobs = useHistory ? historyPage?.jobs ?? [] : jobs;
  const logCount = useHistory ? historyPage?.total ?? 0 : snapshot?.jobCount ?? jobs.length;
  const active = jobs.find(job => job.status === "running");
  const failure = snapshot?.latestFailure;
  const eventRows = logJobs.flatMap(job => job.events.map((event, index) => ({ job, event, index })))
    .sort((left, right) => right.event.at.localeCompare(left.event.at) || right.index - left.index);
  const formatTime = (value: string) => new Date(value).toLocaleString("it-IT", { timeZone: snapshot?.timeZone, dateStyle: "short", timeStyle: "short" });
  const eventDate = new Intl.DateTimeFormat("it-IT", { timeZone: snapshot?.timeZone, day: "2-digit", month: "2-digit", year: "2-digit" });
  const eventTime = new Intl.DateTimeFormat("it-IT", { timeZone: snapshot?.timeZone, hour: "2-digit", minute: "2-digit" });
  const linkedEvent = entries.find(item => item.id === focusId && item.kind === "appointment");
  const selectedMonth = month || (linkedEvent?.kind === "appointment" ? linkedEvent.day.slice(0, 7) : snapshot?.today.slice(0, 7)) || "";
  const dated = entries.filter((entry): entry is RecordItem & { kind: "appointment" } => entry.kind === "appointment");
  const matches = (value: unknown) => !query.trim() || JSON.stringify(value).toLocaleLowerCase("it-IT").includes(query.trim().toLocaleLowerCase("it-IT"));
  const visible = (tab === "appointment" ? dated.filter(entry => query.trim() || (day ? entry.day === day : entry.day.startsWith(selectedMonth))).sort((left, right) => `${left.day}${left.time ?? ""}`.localeCompare(`${right.day}${right.time ?? ""}`)) : entries.filter(entry => entry.kind === tab))
    .filter(entry => (!focusId || entry.id === focusId) && matches(entry));
  const priceCard = entries.find(item => item.id === price?.id);
  const command = <form className="office-command" onSubmit={event => { event.preventDefault(); void send(); }}>
    <label className="office-sr-only" htmlFor="office-request">Chiedi al Segretario</label>
    <input ref={requestInput} id="office-request" value={text} onChange={event => setText(event.target.value)} maxLength={1200} placeholder="Chiedi al Segretario…" autoComplete="off" />
    <button type="submit" disabled={busy || !snapshot || !text.trim()} className="office-primary"><Send size={15} /> Testa</button>
  </form>;

  function exportCards() {
    const link = document.createElement("a");
    const url = URL.createObjectURL(new Blob([JSON.stringify(entries.filter(entry => entry.kind === "card"), null, 2)], { type: "application/json" }));
    link.href = url;
    link.download = "andrea-carte.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function openResult(view: string) {
    const params = new URL(view, location.href).searchParams;
    selectTab(linkedTab(params), params.get("entry") ?? "");
    setQuery(params.get("q") ?? "");
    setSelection(collectionSelection(params));
    setCollectionKey(current => current + 1);
  }

  function resultDetails(result: Result, job: Job) {
    return (result.steps ?? [result]).map((step, index) => <div className="office-result-detail" key={index}>
      {step.view && <a className="office-chat-link" href={step.view} onClick={event => { event.preventDefault(); openResult(event.currentTarget.href); }}>{result.steps ? `Apri vista ${index + 1}` : "Apri vista"}</a>}
      {step.confirmation && job.channel === "board" && !chat.some(next => next.confirmedCode === step.confirmation?.code && next.status !== "error") && <button type="button" disabled={busy} onClick={() => {
        const confirmation = step.confirmation!;
        setConfirmation({ title: "Conferma operazione", description: `${confirmation.description}?`, label: "Conferma", action: () => void mutate("/requests", "POST", { text: `/conferma ${confirmation.code}` }) });
      }}>{step.confirmation.description}</button>}
      {step.sources?.map(source => <div className="office-source" key={source.url}><div><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a><small>{source.snippet}</small>{source.candidate && <small>Importo rilevato, da verificare: {money(source.candidate.amount, source.candidate.currency)}</small>}</div>{step.cardId && entries.some(entry => entry.id === step.cardId) && <button onClick={() => { setChatOpen(false); setTab("card"); setPrice({ id: step.cardId!, url: source.url, ...source.candidate }); }}>Associa prezzo</button>}</div>)}
      {!!step.photos?.length && <div className="office-photos">{step.photos.map(id => <a key={id} href={`/api/foto/${id}/originale`} target="_blank" rel="noreferrer"><img src={`/media/foto/thumbs/${id}.jpg`} alt={`Foto candidata ${id}`} loading="lazy" /></a>)}</div>}
    </div>);
  }

  function renderJob(job: Job, eventIndex: number) {
    const event = job.events[eventIndex];
    return <article key={job.id} className="office-job">
      <header><div><strong>{job.label}</strong><small>{jobSection(job)}{job.target ? ` · ${job.target}` : ""} · {job.channel === "telegram" ? "Telegram" : "Mainboard"} · {formatTime(job.createdAt)}{job.failedRole ? ` · Errore: ${roleName(job.failedRole)}` : ""}</small></div><span className={`office-status ${job.status}`}>{statuses[job.status]}</span></header>
      <p><strong>{roleName(event.role)}</strong> · {event.text}</p><small>ID <code>{job.id}:{eventIndex + 1}</code></small>
      {job.result && <><p className="office-chat-text">{job.result.message}</p>{resultDetails(job.result, job)}</>}
      <details><summary>Passaggi della squadra</summary><ol>{job.events.map((event, index) => <li key={index}><strong>{roleName(event.role)}</strong> · {event.text}</li>)}</ol></details>
    </article>;
  }

  const toolbar = <nav className="office-toolbar" aria-label="Viste della Mainboard">
    <button type="button" aria-pressed={chatOpen} onClick={() => { setChatOpen(!chatOpen); setSettings(false); }}>Chatbot</button>
    <button type="button" aria-pressed={!chatOpen && tab === "collections"} onClick={() => { setSelection({}); selectTab("collections"); setCollectionKey(value => value + 1); }}>Collezioni</button>
    <button type="button" aria-pressed={!chatOpen && tab === "log"} onClick={() => selectTab("log")}><Activity size={14} /> Vedi Report</button>
    <button className="office-model" type="button" disabled={!snapshot} aria-expanded={settings} title={snapshot?.model}
      onClick={() => { if (snapshot) { setError(""); setModel(snapshot.model); setSettings(!settings); } }}>Modello</button>
    {chatOpen && <button type="button" className="office-chat-clear" disabled={busy || !chat.length || !!active} title="Cancella conversazione" aria-label="Cancella conversazione"
      onClick={() => setConfirmation({ title: "Cancella conversazione", description: "Cancellare tutti i messaggi del Chatbot? Le voci salvate e il Report restano.", label: "Cancella", action: () => void mutate("/chat", "DELETE") })}><Trash2 size={15} /></button>}
  </nav>;

  const crew = <div className={`office-crew${tab === "appointment" ? "" : " compact-crew"}`} aria-label="Squadra">
    {roles.map(role => {
      const status = active?.stage === role.id ? "Al lavoro" : !snapshot || !!loadError ? "Non disponibile" : failure?.failedRole === role.id && !jobs.some(job => job.status === "done" && job.createdAt > failure.createdAt && job.events.some(event => event.role === role.id)) ? "Ultimo esito: errore" : "Disponibile";
      return <article key={role.id} className={active?.stage === role.id ? "working" : undefined} data-agent={role.id} aria-label={`${role.character}, ${role.name}. ${role.description}`} title={`${role.character} · ${role.name} · ${status}`}>
        <div className="office-agent-caption"><strong>{role.character}</strong><small>{role.name}</small></div>
        <div className="office-agent-portrait" style={tab === "appointment" ? role.portrait : role.avatar}>
          <span role="img" className={`office-role-dot ${status === "Non disponibile" || status.includes("errore") ? "problem" : ""}`} aria-label={status} title={status} />
        </div>
      </article>;
    })}
  </div>;

  return <div className={`personal-board${chatOpen ? " chat-open" : ""}`}>
    {headerActions ? createPortal(toolbar, headerActions) : toolbar}
    {snapshot?.renewals?.length ? <p className="office-renewals" role="status">{snapshot.renewals.map(item => <span key={item.id}>{item.title} · {item.days === 0 ? "oggi" : item.days === 1 ? "domani" : `tra ${item.days} giorni`}{item.amount != null ? ` · ${money(item.amount, item.currency)}` : ""}</span>)}</p> : null}
    {confirmation && <OfficeConfirmation request={confirmation} onCancel={() => setConfirmation(undefined)} />}
    {!chatOpen && tab !== "collections" && <SearchField label={tab === "log" ? "Cerca nel report" : `Cerca in ${labels[tab]}`} maxLength={160} value={query} onChange={value => { setQuery(value); setOffset(0); }} />}
    {!chatOpen && tab !== "collections" && command}
    {settings && snapshot && <form className="office-form" onSubmit={saveSettings}>
      <label>Modello locale<input list="office-models" value={model} onChange={event => setModel(event.target.value)} required maxLength={180} /></label>
      <datalist id="office-models">{models.filter(item => item.providerId === "ollama" && !/(?:^|[/:._-])cloud(?:$|[/:._-])/i.test(item.id)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</datalist>
      <div className="office-actions"><button className="office-primary" disabled={busy}>Salva</button><button type="button" onClick={() => setSettings(false)}>Annulla</button></div>
    </form>}
    {chatOpen && <section className="office-chat chat-surface" aria-label="Conversazione con il Segretario">
      <div ref={chatHistory} className="office-chat-history" role="log" aria-label="Messaggi">
        <div className="message-list">
          {!chat.length && <p className="office-empty">Prova «Crea la collezione Fotografia, aggiungi Nikon con tipologie Reflex e Analogica, poi mostrami le statistiche».</p>}
          {chat.map(job => <div key={job.id}>
            <article className="message user">
              <div className="message-avatar"><img src="/cetriolo.png" alt="" /></div>
              <div className="message-content">
                <header className="message-heading">
                  <div className="message-meta">Tu</div>
                  {job.chatText && messageActions(`${job.id}:user`, job.chatText)}
                </header>
                <div className="office-chat-text">{job.chatText}</div>
                {!!job.attachments?.length && <ul className="office-chat-attachments" aria-label="Allegati del messaggio">
                  {job.attachments.map(file => {
                    const url = `/api/office/attachments/${file.id}`;
                    return <li key={file.id}>{file.image ? <a href={url} target="_blank" rel="noreferrer">
                      <img src={url} alt={file.name} loading="lazy" decoding="async" /><span>{file.name}</span>
                    </a> : <a href={`${url}?download=1`} download><FileText size={16} /><span>{file.name}</span><Download size={15} /></a>}</li>;
                  })}
                </ul>}
              </div>
            </article>
            <article className="message assistant">
              <div className="message-avatar"><img src="/andreagpt-logo-128.png" alt="" /></div>
              <div className="message-content">
                <header className="message-heading">
                  <div className="message-meta">Segretario · {formatTime(job.createdAt)}</div>
                  {job.result?.message && messageActions(`${job.id}:assistant`, job.result.message)}
                </header>
                <div className={`office-chat-text${job.status === "error" ? " office-event-error" : ""}`}>{job.result?.message ?? statuses[job.status]}</div>
                {job.result && resultDetails(job.result, job)}
              </div>
            </article>
          </div>)}
        </div>
      </div>
      <div className="office-chat-compose">
        {(error || loadError) && <p className="office-alert" role="alert">{error || loadError}</p>}
        <input ref={galleryInput} type="file" accept="image/*" multiple hidden aria-label="Scegli dalla galleria" onChange={event => pickAttachments(event.currentTarget)} />
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden aria-label="Scatta una foto" onChange={event => pickAttachments(event.currentTarget)} />
        <input ref={filesInput} type="file" multiple hidden aria-label="Sfoglia file del dispositivo" onChange={event => pickAttachments(event.currentTarget)} />
        {attachmentPicker && <div id="office-attachment-options" className="office-attachment-options" aria-label="Origine allegati">
          <button type="button" disabled={busy} onClick={() => galleryInput.current?.click()}><Images size={17} /> Galleria</button>
          <button type="button" disabled={busy} onClick={() => cameraInput.current?.click()}><Camera size={17} /> Fotocamera</button>
          <button type="button" disabled={busy} onClick={() => filesInput.current?.click()}><FolderOpen size={17} /> File</button>
        </div>}
        {!!draftFiles.length && <ul className="office-attachment-drafts" aria-label="Allegati da inviare">
          {draftFiles.map((file, index) => <li key={`${file.name}-${index}`}><Paperclip size={13} /><span>{file.name}</span><button type="button" disabled={busy} aria-label={`Rimuovi ${file.name}`} onClick={() => setDraftFiles(current => current.filter((_, position) => position !== index))}><X size={16} /></button></li>)}
        </ul>}
        {busy && !!draftFiles.length && <small className="office-upload-status" role="status">Invio allegati…</small>}
        <div className="composer">
          <div className="composer-row">
            <button type="button" className="attach-button" aria-label="Aggiungi allegati" aria-expanded={attachmentPicker} aria-controls={attachmentPicker ? "office-attachment-options" : undefined} disabled={busy} onClick={() => setAttachmentPicker(!attachmentPicker)}><Paperclip size={19} /></button>
            <textarea
              ref={chatInput}
              value={text}
              onChange={event => setText(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send();
                }
              }}
              maxLength={1200}
              rows={1}
              placeholder="Scrivi un messaggio…"
              aria-label="Scrivi un messaggio al Segretario"
              autoComplete="off"
            />
            <button type="button" className="send-button" aria-label="Invia" disabled={busy || !snapshot || (!text.trim() && !draftFiles.length)} onClick={() => void send()}><Send size={18} /></button>
          </div>
        </div>
      </div>
    </section>}
    {!chatOpen && (tab === "collections" ? <>{crew}<OfficeCollections key={collectionKey} selection={selection} confirm={setConfirmation} /></> : <>
    <nav className="office-navigation" aria-label="Sezioni della Mainboard">
      <button aria-label="Scorri sezioni a sinistra" onClick={() => nav.current?.scrollBy({ left: -220, behavior: "smooth" })}><ChevronLeft size={15} /></button>
      <div className="office-tabs" ref={nav}>{archives.map(({ kind, title, icon: Icon }) => <button key={kind} aria-pressed={tab === kind} onClick={() => selectTab(kind)}><Icon size={14} /> {title} <b title="Totale voci">{entries.filter(entry => entry.kind === kind).length}</b></button>)}</div>
      <button aria-label="Scorri sezioni a destra" onClick={() => nav.current?.scrollBy({ left: 220, behavior: "smooth" })}><ChevronRight size={15} /></button>
    </nav>
    {snapshot && tab === "log" && <div className="office-actions office-log-tools">
      {logSection && <button type="button" onClick={() => { setLogSection(""); setOffset(0); setSelectedEvent(""); }} aria-label={`Rimuovi filtro ${labels[logSection]}`}>{labels[logSection]} <X size={14} /></button>}
      <button aria-pressed={onlyErrors} onClick={() => { setOnlyErrors(!onlyErrors); setOffset(0); }}>Solo errori</button>
      <small>{logCount} operazioni</small>
    </div>}
    {crew}
    {(error || loadError) && <p className="office-alert" role="alert">{error || loadError}</p>}
    {price && priceCard && <form key={`${price.id}:${price.url}`} className="office-form" onSubmit={storePrice}>
      <strong>Registra il prezzo verificato · {priceCard.title}</strong><div className="office-fields"><label>Importo<input name="amount" type="number" min="0" max="10000000" step="0.01" defaultValue={price.amount} required /></label><label>Valuta<input name="currency" defaultValue={price.currency ?? "EUR"} pattern="[A-Za-z]{3}" required /></label><label>Link della fonte<input name="url" type="url" defaultValue={price.url} required /></label></div>
      <div className="office-actions"><button className="office-primary" disabled={busy}>Salva prezzo</button><button type="button" onClick={() => setPrice(undefined)}>Annulla</button></div>
    </form>}
    {!snapshot ? <p className="office-empty">{loadError ? "In attesa del servizio…" : "Caricamento dell’ufficio…"}</p> : tab === "log" ? <section aria-label="Registro attività" className="office-log">
      {historyError ? <p className="office-alert" role="alert">{historyError}</p> : useHistory && !historyPage ? <p className="office-empty">Caricamento…</p> : !logJobs.length && <p className="office-empty">Nessuna attività.</p>}
      {!!eventRows.length && <div className="office-table-wrap">
        <table className="office-table office-event-table">
          <colgroup><col className="office-event-date" /><col className="office-event-role" /><col /><col className="office-event-id" /></colgroup>
          <thead><tr><th scope="col">Data</th><th scope="col">Ruolo</th><th scope="col">Evento</th><th scope="col">ID</th></tr></thead>
          <tbody>{eventRows.map(({ job, event, index }) => {
            const id = `${job.id}:${index + 1}`;
            const open = selectedEvent === id;
            const at = new Date(event.at);
            const failed = job.status === "error" && index === job.events.length - 1;
            return <Fragment key={id}>
              <tr>
                <td><time dateTime={event.at}>{eventDate.format(at)}<small>{eventTime.format(at)}</small></time></td>
                <td><abbr title={roleName(event.role)}>{shortRoles[event.role]}</abbr></td>
                <td className={failed ? "office-event-error" : undefined}><span className="office-event-label" title={event.text}>{shortEvent(event.text)}</span></td>
                <td><button type="button" className="office-event-toggle" aria-expanded={open} aria-label={`Dettagli evento ${id}`} title={id} onClick={() => setSelectedEvent(open ? "" : id)}>{job.id.slice(0, 8)}:{index + 1}</button></td>
              </tr>
              {open && <tr><td colSpan={4}>{renderJob(job, index)}</td></tr>}
            </Fragment>;
          })}</tbody>
        </table>
      </div>}
      {(offset > 0 || logCount > 40) && <div className="office-actions"><button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 40))}>Più recenti</button><button disabled={offset + 40 >= logCount} onClick={() => setOffset(offset + 40)}>Più vecchie</button></div>}
    </section> : <section className="office-archive" aria-label="Archivio personale">
      <div className="office-archive-head"><small>{visible.length} di {entries.filter(entry => entry.kind === tab).length} voci</small><div className="office-actions">
        <button onClick={() => selectTab("log", "", tab)}>Log sezione</button>
        {focusId && <button onClick={() => setFocusId("")}>Mostra tutto</button>}
        <button onClick={() => {
          setText(tab === "document" ? "Quali documenti scadono entro 90 giorni?" : `Mostra le voci nella sezione ${labels[tab]}`);
          if (window.matchMedia("(max-width: 600px)").matches) setChatOpen(true);
          else requestInput.current?.focus();
        }}>Prepara test</button>
        {tab === "card" && <button disabled={!visible.length} onClick={exportCards}><Download size={14} /> Esporta JSON</button>}
        <button className="office-primary" onClick={() => { setEditing(undefined); setAdding(!adding); }}>{adding ? "Annulla" : "+ Aggiungi"}</button>
      </div></div>
      {adding && <form key={editing?.id ?? tab} className="office-form" onSubmit={event => void add(event, tab)}><div className="office-fields"><label>Titolo<input name="title" defaultValue={editing?.title} maxLength={160} required /></label>
        {tab === "appointment" && <><label>Data<input name="day" type="date" defaultValue={fieldValue(editing, "day") || day || snapshot.today} required /></label><label>Ora<input name="time" type="time" defaultValue={fieldValue(editing, "time")} /></label></>}
        {tab === "subscription" && <><label>Rinnovo<input name="renewal" type="date" defaultValue={fieldValue(editing, "renewal")} /></label><label>Frequenza<select name="cadence" defaultValue={fieldValue(editing, "cadence")}><option value="">—</option><option value="monthly">Mensile</option><option value="yearly">Annuale</option><option value="other">Altro</option></select></label><label>Importo<input name="amount" type="number" min="0" max="10000000" step="0.01" defaultValue={fieldValue(editing, "amount")} /></label><label>Valuta<input name="currency" defaultValue={fieldValue(editing, "currency") || "EUR"} pattern="[A-Za-z]{3}" /></label></>}
        {tab === "card" && <>{[["edition", "Edizione"], ["number", "Numero"], ["condition", "Condizione"]].map(([name, label]) => <label key={name}>{label}<input name={name} defaultValue={fieldValue(editing, name)} maxLength={100} /></label>)}</>}
        {isExtra(tab) && Object.entries(extraFields[tab]).map(([name, label]) => <label key={name} className={name === "notes" ? "office-wide-field" : undefined}>{label}
          {name === "notes" ? <textarea name={name} rows={3} maxLength={4000} defaultValue={fieldValue(editing, name)} /> : <input name={name} defaultValue={fieldValue(editing, name)} type={name === "day" || name === "deadline" ? "date" : name === "url" ? "url" : name === "amount" || name === "photoId" ? "number" : "text"} min={name === "photoId" ? 1 : undefined} step={name === "amount" ? "0.01" : undefined} maxLength={name === "url" ? 2000 : name === "currency" ? 3 : 100} />}
        </label>)}
      </div><button className="office-primary" disabled={busy}>Salva nell’archivio</button></form>}
      {tab === "appointment" && <Calendar month={selectedMonth} today={snapshot.today} selected={day} appointments={dated} onDay={setDay} onMonth={value => { setMonth(value); setDay(""); }} />}
      {!visible.length && <p className="office-empty">{tab === "appointment" ? "Nessun appuntamento per il periodo selezionato." : "Nessuna voce in questo archivio."}</p>}
      {visible.length > 0 && <div className="office-table-wrap"><table className="office-table office-entry-table"><thead><tr><th scope="col">Titolo</th><th scope="col">Dettagli</th><th scope="col">Azioni</th></tr></thead><tbody>{visible.map(item => <tr key={item.id}><th scope="row">{item.title}</th><td><small>
        {item.kind === "appointment" && `${dateLabel(item.day)} · ${item.time ?? "Tutto il giorno"} (${snapshot.timeZone})`}
        {item.kind === "subscription" && [item.amount != null && money(item.amount, item.currency), item.cadence === "monthly" ? "mensile" : item.cadence === "yearly" ? "annuale" : null, item.renewal ? `rinnovo: ${dateLabel(item.renewal)}` : "rinnovo non indicato"].filter(Boolean).join(" · ")}
        {item.kind === "card" && [item.edition, item.number, item.condition].filter(Boolean).join(" · ")}
        {item.kind === "film" && (item.watched ? "Visto" : "Da vedere")}
        {isExtra(item.kind) && Object.entries(extraFields[item.kind]).map(([name, label]) => {
          const value = fieldValue(item, name);
          if (value === "") return null;
          if (name === "photoId") return <a key={name} href={`/api/foto/${value}/originale`} target="_blank" rel="noreferrer">Foto #{value}</a>;
          if (name === "url") return <a key={name} href={String(value)} target="_blank" rel="noreferrer">{label}</a>;
          if (name === "notes") return <span key={name} className="office-note">{String(value)}</span>;
          return <span key={name}>{label}: {name === "day" || name === "deadline" ? dateLabel(String(value)) : value}</span>;
        })}
      </small>{item.kind === "card" && item.price && <a href={item.price.url} target="_blank" rel="noreferrer">{money(item.price.amount, item.price.currency)} · Fonte</a>}</td><td><div className="office-actions">
        {item.kind === "card" && <button onClick={() => setPrice({ id: item.id, url: item.price?.url ?? "", amount: item.price?.amount, currency: item.price?.currency })}>Registra prezzo</button>}
        {item.kind === "film" && <button disabled={busy} onClick={() => void mutate(`/entries/${item.id}/watched`, "PUT", { watched: !item.watched })}>{item.watched ? "Rimetti in lista" : "Segna come visto"}</button>}
        {isExtra(item.kind) && Object.entries(sectionActions[item.kind]).filter(([operation]) => operation === "check" || operation === "findPhoto").map(([operation, label]) => <button key={operation} disabled={busy} onClick={() => void runAction(item, operation as Operation, label)}>{label}</button>)}
        <button type="button" aria-label={`Modifica ${item.title}`} onClick={() => { setEditing(item); setAdding(true); }}><Pencil size={14} /></button>
        <button type="button" aria-label={`Elimina ${item.title}`} disabled={busy} onClick={() => setConfirmation({ title: "Elimina voce", description: `Eliminare «${item.title}» dall’archivio?`, label: "Elimina", action: () => void mutate(`/entries/${item.id}`, "DELETE") })}><Trash2 size={15} /></button>
      </div></td></tr>)}</tbody></table></div>}
    </section>}</>)}
  </div>;
}

function Calendar({ month, today, selected, appointments, onDay, onMonth }: { month: string; today: string; selected: string; appointments: (RecordItem & { kind: "appointment" })[]; onDay: (day: string) => void; onMonth: (month: string) => void }) {
  const start = new Date(`${month}-01T00:00:00Z`);
  const year = start.getUTCFullYear();
  const index = start.getUTCMonth();
  const total = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
  const move = (delta: number) => onMonth(new Date(Date.UTC(year, index + delta, 1)).toISOString().slice(0, 7));
  return <div className="office-calendar"><header><button aria-label="Mese precedente" onClick={() => move(-1)}><ChevronLeft size={16} /></button><strong>{start.toLocaleDateString("it-IT", { month: "long", year: "numeric", timeZone: "UTC" })}</strong><button aria-label="Mese successivo" onClick={() => move(1)}><ChevronRight size={16} /></button></header><div className="office-days">
    {["LUN", "MAR", "MER", "GIO", "VEN", "SAB", "DOM"].map(label => <small key={label}>{label}</small>)}
    {Array.from({ length: (start.getUTCDay() + 6) % 7 }, (_, offset) => <span key={`pad-${offset}`} />)}
    {Array.from({ length: total }, (_, offset) => {
      const value = `${month}-${String(offset + 1).padStart(2, "0")}`;
      const count = appointments.filter(item => item.day === value).length;
      return <button key={value} className={value === today ? "office-today" : ""} aria-pressed={value === selected} aria-label={`${dateLabel(value)}${count ? ` · ${count} appuntamenti` : ""}`} onClick={() => onDay(value === selected ? "" : value)}>{offset + 1}{count > 0 && <b>{count}</b>}</button>;
    })}
  </div>{selected && <button onClick={() => onDay("")}>Mostra tutto il mese</button>}</div>;
}
