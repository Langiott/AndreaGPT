import { useEffect, useRef, useState } from "react";
import {
  BrainCircuit,
  Check,
  ChevronDown,
  Code2,
  Database,
  Eye,
  Info,
  Menu,
  MessageSquarePlus,
  PanelLeftClose,
  PenTool,
  Search,
  Send,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import mascotUrl from "../img/mascotte-no-sfondo.png";
import { QUICK_PROMPTS, TASKS } from "./data";
import type { ChatMessage, ChatSettings, Conversation, ModelInfo } from "./types";

const iconByName = {
  sparkles: Sparkles,
  code: Code2,
  brain: BrainCircuit,
  chart: Database,
  pen: PenTool,
  eye: Eye,
};

const initialSettings: ChatSettings = { temperature: 0.6, maxTokens: 2048 };
type Theme = "cosmic" | "normal";

export default function App() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [taskId, setTaskId] = useState("general");
  const [conversations, setConversations] = useState<Conversation[]>(() => loadConversations());
  const [activeConversationId, setActiveConversationId] = useState(() => loadActiveConversationId());
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadActiveMessages());
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [taskMenuOpen, setTaskMenuOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<ChatSettings>(initialSettings);
  const [theme, setTheme] = useState<Theme>(() => localStorage.getItem("andreagpt-theme") === "normal" ? "normal" : "cosmic");
  const [historyCollapsed, setHistoryCollapsed] = useState(() => localStorage.getItem("andreagpt-history-collapsed") === "true");
  const [modelsCollapsed, setModelsCollapsed] = useState(() => localStorage.getItem("andreagpt-models-collapsed") === "true");
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const selectedModel = models.find((model) => model.id === selectedModelId) ?? models[0];
  const selectedTask = TASKS.find((task) => task.id === taskId) ?? TASKS[0];
  const filteredModels = models.filter((model) => {
    const term = search.toLowerCase();
    return `${model.name} ${model.id} ${model.provider} ${model.tags.join(" ")}`.toLowerCase().includes(term);
  });
  const estimatedTokens = Math.ceil(messages.reduce((total, message) => total + message.content.length, 0) / 4);

  useEffect(() => {
    fetch("/api/models")
      .then(async (response) => {
        if (!response.ok) throw new Error("Catalogo non disponibile");
        return response.json() as Promise<{ models: ModelInfo[]; configured: boolean }>;
      })
      .then((data) => {
        setModels(data.models);
        setConfigured(data.configured);
        const saved = localStorage.getItem("andreagpt-model");
        setSelectedModelId(data.models.some((model) => model.id === saved) ? saved! : data.models[0]?.id ?? "");
      })
      .catch(() => setError("Impossibile caricare il catalogo dei modelli."))
      .finally(() => setModelsLoading(false));
  }, []);

  useEffect(() => {
    localStorage.setItem("andreagpt-messages", JSON.stringify(messages));
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!activeConversationId || !messages.length) return;
    setConversations((current) => {
      const existing = current.find((item) => item.id === activeConversationId);
      const title = existing?.customTitle
        ? existing.title
        : createConversationTitle(messages.find((message) => message.role === "user")?.content ?? "");
      const conversation: Conversation = { id: activeConversationId, title, customTitle: existing?.customTitle, messages, modelId: selectedModelId, updatedAt: Date.now() };
      const exists = Boolean(existing);
      return exists
        ? current.map((item) => item.id === activeConversationId ? conversation : item)
        : [conversation, ...current];
    });
  }, [activeConversationId, messages, selectedModelId]);

  useEffect(() => {
    localStorage.setItem("andreagpt-conversations", JSON.stringify(conversations));
  }, [conversations]);

  useEffect(() => {
    if (activeConversationId) localStorage.setItem("andreagpt-active-conversation", activeConversationId);
    else localStorage.removeItem("andreagpt-active-conversation");
  }, [activeConversationId]);

  useEffect(() => {
    if (selectedModelId) localStorage.setItem("andreagpt-model", selectedModelId);
  }, [selectedModelId]);

  useEffect(() => {
    localStorage.setItem("andreagpt-theme", theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "cosmic" ? "#FFF8E7" : "#080A08");
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("andreagpt-history-collapsed", String(historyCollapsed));
    localStorage.setItem("andreagpt-models-collapsed", String(modelsCollapsed));
  }, [historyCollapsed, modelsCollapsed]);

  useEffect(() => {
    const disableContextMenu = (event: MouseEvent) => event.preventDefault();
    document.addEventListener("contextmenu", disableContextMenu);
    return () => document.removeEventListener("contextmenu", disableContextMenu);
  }, []);

  function chooseTask(nextTaskId: string) {
    setTaskId(nextTaskId);
    setTaskMenuOpen(false);
    const task = TASKS.find((item) => item.id === nextTaskId);
    if (task?.suggestedModel && models.some((model) => model.id === task.suggestedModel)) {
      setSelectedModelId(task.suggestedModel);
    }
  }

  function chooseModel(id: string) {
    setSelectedModelId(id);
    setSidebarOpen(false);
  }

  function newChat() {
    abortRef.current?.abort();
    setLoading(false);
    setMessages([]);
    setActiveConversationId("");
    setInput("");
    setError("");
    textareaRef.current?.focus();
  }

  function openConversation(conversation: Conversation) {
    abortRef.current?.abort();
    setLoading(false);
    setActiveConversationId(conversation.id);
    setMessages(conversation.messages);
    setError("");
    if (models.some((model) => model.id === conversation.modelId)) setSelectedModelId(conversation.modelId);
    setSidebarOpen(false);
  }

  function deleteConversation(id: string) {
    const remaining = conversations.filter((conversation) => conversation.id !== id);
    setConversations(remaining);
    if (id === activeConversationId) {
      const next = remaining[0];
      setActiveConversationId(next?.id ?? "");
      setMessages(next?.messages ?? []);
      if (next && models.some((model) => model.id === next.modelId)) setSelectedModelId(next.modelId);
    }
  }

  function renameConversation(id: string) {
    const conversation = conversations.find((item) => item.id === id);
    if (!conversation) return;
    const title = window.prompt("Nuovo titolo della conversazione", conversation.title)?.trim();
    if (!title) return;
    setConversations((current) => current.map((item) => item.id === id ? { ...item, title: title.slice(0, 60), customTitle: true } : item));
  }

  async function sendMessage(text = input) {
    const content = text.trim();
    if (!content || loading || !selectedModel) return;

    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content };
    if (!activeConversationId) setActiveConversationId(crypto.randomUUID());
    const assistantId = crypto.randomUUID();
    const history = [...messages, userMessage];
    setMessages([...history, { id: assistantId, role: "assistant", content: "" }]);
    setInput("");
    setError("");
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: selectedModel.id,
          messages: [
            { role: "system", content: selectedTask.prompt },
            ...history.map(({ role, content: messageContent }) => ({ role, content: messageContent })),
          ],
          ...settings,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        if (response.status === 404) {
          setModels((current) => current.filter((model) => model.id !== selectedModel.id));
          setSelectedModelId((current) => current === selectedModel.id ? "" : current);
        }
        throw new Error(body.error || `Errore HTTP ${response.status}`);
      }
      if (!response.body) throw new Error("Risposta streaming non disponibile.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const data = line.trim().replace(/^data:\s*/, "");
          if (!data || data === "[DONE]") continue;
          try {
            const event = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
            const token = event.choices?.[0]?.delta?.content ?? "";
            if (token) {
              fullText += token;
              setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: fullText } : message));
            }
          } catch {
            // Some providers include keep-alive lines that are not JSON.
          }
        }
        if (done) break;
      }
      if (!fullText) throw new Error("Il modello non ha restituito contenuto.");
    } catch (caught) {
      if ((caught as Error).name === "AbortError") {
        setMessages((current) => current.filter((message) => message.id !== assistantId || message.content));
      } else {
        setMessages((current) => current.filter((message) => message.id !== assistantId));
        setError(caught instanceof Error ? caught.message : "Si è verificato un errore.");
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }

  function stopGeneration() {
    abortRef.current?.abort();
  }

  function resizeInput(value: string) {
    setInput(value);
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
    }
  }

  return (
    <div className="app-shell" data-theme={theme}>
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand-row">
          <div className="brand-mark"><img src="/andreagpt-logo.png" alt="" /></div>
          <div><strong>AndreaGPT</strong></div>
          <button className="icon-button close-mobile" onClick={() => setSidebarOpen(false)} aria-label="Chiudi menu"><X size={19} /></button>
        </div>

        <button className="new-chat" onClick={newChat}><MessageSquarePlus size={18} /> Nuova conversazione</button>

        <div className={`sidebar-section history-section ${historyCollapsed ? "collapsed" : ""}`}>
          <button className="section-heading" onClick={() => setHistoryCollapsed((value) => !value)} aria-expanded={!historyCollapsed}>
            <span>Conversazioni</span><span className="section-summary"><span className="count">{conversations.length}</span><ChevronDown size={14} /></span>
          </button>
          {!historyCollapsed && <div className="conversation-history">
            {conversations.map((conversation) => (
              <div
                key={conversation.id}
                className={`history-row ${conversation.id === activeConversationId ? "selected" : ""}`}
                onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); renameConversation(conversation.id); }}
              >
                <button className="history-open" onClick={() => openConversation(conversation)} title={`${conversation.title} · Tasto destro per rinominare`}>{conversation.title}</button>
                <button className="history-delete" onClick={() => deleteConversation(conversation.id)} aria-label={`Elimina ${conversation.title}`}><Trash2 size={13} /></button>
              </div>
            ))}
            {!conversations.length && <p className="empty-history">Le conversazioni salvate appariranno qui.</p>}
          </div>}
        </div>

        <div className={`sidebar-section model-section ${modelsCollapsed ? "collapsed" : ""}`}>
          <button className="section-heading" onClick={() => setModelsCollapsed((value) => !value)} aria-expanded={!modelsCollapsed}>
            <span>Modelli</span><span className="section-summary"><span className="count">{models.length}</span><ChevronDown size={14} /></span>
          </button>
          {!modelsCollapsed && <>
          <label className="search-box">
            <Search size={16} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cerca un modello..." />
            {search && <button onClick={() => setSearch("")} aria-label="Cancella ricerca"><X size={14} /></button>}
          </label>
          <div className="model-list">
            {modelsLoading && <div className="loading-list"><span /><span /><span /></div>}
            {!modelsLoading && filteredModels.map((model) => (
              <button key={model.id} className={`model-row ${model.id === selectedModel?.id ? "selected" : ""}`} onClick={() => chooseModel(model.id)}>
                <span className="provider-avatar">{model.provider.slice(0, 1).toUpperCase()}</span>
                <span className="model-copy"><strong>{model.name}</strong><small>{model.provider}</small></span>
                {model.id === selectedModel?.id && <Check size={16} className="selected-check" />}
              </button>
            ))}
            {!modelsLoading && !filteredModels.length && <p className="empty-search">Nessun modello trovato.</p>}
          </div>
          </>}
        </div>

        <div className="sidebar-footer">
          <img className="sidebar-mascot" src={mascotUrl} alt="Mascotte AndreaGPT" />
          <div className={`api-status ${configured ? "online" : "offline"}`}><span />{configured ? "Provider API connessi" : "API key da configurare"}</div>
          <button className="sidebar-action" onClick={() => setSettingsOpen(true)}><Settings2 size={17} /> Impostazioni</button>
        </div>
      </aside>
      {sidebarOpen && <button className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-label="Chiudi menu" />}

      <main className="main-panel">
        <header className="topbar">
          <button className="icon-button menu-button" onClick={() => setSidebarOpen(true)} aria-label="Apri menu"><Menu size={21} /></button>
          <div className="model-title">
            <span className="status-dot" />
            <div><strong>{selectedModel?.name ?? "Caricamento modelli"}</strong><small>{selectedModel?.provider ?? "NVIDIA"} · Contesto usato: ~{estimatedTokens.toLocaleString("it-IT")} token</small></div>
          </div>
          <div className="topbar-actions">
            <div className="task-selector">
              <button className="task-trigger" onClick={() => setTaskMenuOpen((value) => !value)}>
                <Zap size={15} /> <span>{selectedTask.shortName}</span> <ChevronDown size={15} />
              </button>
              {taskMenuOpen && (
                <div className="task-menu">
                  <div className="popover-heading"><strong>Scegli il task</strong><small>Adatta istruzioni e modello</small></div>
                  {TASKS.map((task) => {
                    const Icon = iconByName[task.icon as keyof typeof iconByName];
                    return <button key={task.id} className={task.id === taskId ? "active" : ""} onClick={() => chooseTask(task.id)}><Icon size={17} /><span><strong>{task.name}</strong><small>{task.description}</small></span>{task.id === taskId && <Check size={15} />}</button>;
                  })}
                </div>
              )}
            </div>
            <button className="icon-button" onClick={() => setDetailsOpen(true)} aria-label="Informazioni modello" disabled={!selectedModel}><Info size={19} /></button>
          </div>
        </header>

        <section className={`conversation ${messages.length ? "has-messages" : ""}`}>
          {!messages.length ? (
            <div className="welcome">
              <h1>Ciao Cetriolo,<br /><em>oggi che facciamo?</em></h1>
              <div className="task-grid">
                {TASKS.slice(0, 4).map((task) => {
                  const Icon = iconByName[task.icon as keyof typeof iconByName];
                  return <button key={task.id} onClick={() => chooseTask(task.id)} className={task.id === taskId ? "active" : ""}><Icon size={19} /><span><strong>{task.name}</strong><small>{task.description}</small></span></button>;
                })}
              </div>
              <div className="quick-row">
                {QUICK_PROMPTS.map((prompt) => <button key={prompt.label} onClick={() => { setInput(prompt.text); textareaRef.current?.focus(); }}>{prompt.label}</button>)}
              </div>
            </div>
          ) : (
            <div className="message-list">
              {messages.map((message) => (
                <article key={message.id} className={`message ${message.role}`}>
                  <div className="message-avatar">{message.role === "user" ? "TU" : <img src="/andreagpt-logo.png" alt="AndreaGPT" />}</div>
                  <div className="message-content">
                    <div className="message-meta">{message.role === "user" ? "Tu" : selectedModel?.name}</div>
                    {message.content ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown> : <div className="thinking"><span /><span /><span /></div>}
                  </div>
                </article>
              ))}
              <div ref={endRef} />
            </div>
          )}
        </section>

        <footer className="composer-wrap">
          {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError("")}><X size={15} /></button></div>}
          {!configured && configured !== null && <div className="config-banner"><Info size={15} /> Aggiungi una chiave NVIDIA o OpenRouter al file <code>.env</code> per iniziare a chattare.</div>}
          <div className="composer">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => resizeInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder={`Scrivi a ${selectedModel?.name ?? "AndreaGPT"}...`}
              rows={1}
            />
            {loading ? <button className="send-button stop" onClick={stopGeneration} aria-label="Ferma generazione"><Square size={15} fill="currentColor" /></button> : <button className="send-button" onClick={() => void sendMessage()} disabled={!input.trim() || !selectedModel} aria-label="Invia"><Send size={18} /></button>}
          </div>
        </footer>
      </main>

      {detailsOpen && selectedModel && (
        <Modal title="Informazioni modello" onClose={() => setDetailsOpen(false)}>
          <div className="model-detail-head"><span className="provider-avatar large">{selectedModel.provider[0].toUpperCase()}</span><div><h2>{selectedModel.name}</h2><code>{selectedModel.id}</code></div></div>
          <p className="detail-description">{selectedModel.description}</p>
          <dl className="detail-grid"><div><dt>Provider</dt><dd>{selectedModel.provider}</dd></div><div><dt>Contesto</dt><dd>{selectedModel.context ?? "Vedi model card"}</dd></div></dl>
          <div className="tag-list">{selectedModel.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
          <a className="external-link" href={`https://build.nvidia.com/${selectedModel.id}`} target="_blank" rel="noreferrer">Apri la model card su NVIDIA Build ↗</a>
        </Modal>
      )}

      {settingsOpen && (
        <Modal title="Impostazioni" onClose={() => setSettingsOpen(false)}>
          <div className="settings-section">
            <div className="settings-heading"><strong>Tema</strong><small>Scegli l'aspetto di AndreaGPT.</small></div>
            <div className="theme-options">
              <button className={theme === "cosmic" ? "active" : ""} onClick={() => setTheme("cosmic")} aria-pressed={theme === "cosmic"}>
                <span className="theme-preview cosmic-preview"><i /><i /><i /></span>
                <span><strong>Latte Cosmico</strong><small>#FFF8E7 · chiaro</small></span>
                {theme === "cosmic" && <Check size={16} />}
              </button>
              <button className={theme === "normal" ? "active" : ""} onClick={() => setTheme("normal")} aria-pressed={theme === "normal"}>
                <span className="theme-preview normal-preview"><i /><i /><i /></span>
                <span><strong>Normale</strong><small>Scuro · attuale</small></span>
                {theme === "normal" && <Check size={16} />}
              </button>
            </div>
          </div>
          <div className="settings-section generation-settings">
            <div className="settings-heading"><strong>Generazione</strong><small>Configura il comportamento delle risposte.</small></div>
          <label className="setting-field"><span><strong>Temperatura</strong><small>Valori bassi sono più precisi, valori alti più creativi.</small></span><output>{settings.temperature.toFixed(1)}</output></label>
          <input className="range" type="range" min="0" max="2" step="0.1" value={settings.temperature} onChange={(event) => setSettings({ ...settings, temperature: Number(event.target.value) })} />
          <label className="setting-field token-field"><span><strong>Token massimi</strong><small>Lunghezza massima della risposta.</small></span><input type="number" min="1" max="8192" value={settings.maxTokens} onChange={(event) => setSettings({ ...settings, maxTokens: Math.min(8192, Math.max(1, Number(event.target.value))) })} /></label>
          </div>
          <button className="primary-action" onClick={() => setSettingsOpen(false)}>Salva impostazioni</button>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal" onMouseDown={(event) => event.stopPropagation()}><header><h2>{title}</h2><button className="icon-button" onClick={onClose}><X size={19} /></button></header><div className="modal-body">{children}</div></section></div>;
}

function loadMessages(): ChatMessage[] {
  try {
    const saved = JSON.parse(localStorage.getItem("andreagpt-messages") ?? "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function loadConversations(): Conversation[] {
  try {
    const saved = JSON.parse(localStorage.getItem("andreagpt-conversations") ?? "[]");
    if (Array.isArray(saved) && saved.length) {
      return saved.map((conversation: Conversation) => conversation.customTitle ? conversation : {
        ...conversation,
        title: createConversationTitle(conversation.messages.find((message) => message.role === "user")?.content ?? ""),
      });
    }
    const messages = loadMessages();
    if (!messages.length) return [];
    const id = crypto.randomUUID();
    const title = createConversationTitle(messages.find((message) => message.role === "user")?.content ?? "");
    const migrated = [{ id, title, messages, modelId: localStorage.getItem("andreagpt-model") ?? "", updatedAt: Date.now() }];
    localStorage.setItem("andreagpt-conversations", JSON.stringify(migrated));
    localStorage.setItem("andreagpt-active-conversation", id);
    return migrated;
  } catch {
    return [];
  }
}

function loadActiveConversationId() {
  const conversations = loadConversations();
  const saved = localStorage.getItem("andreagpt-active-conversation");
  return conversations.some((conversation) => conversation.id === saved) ? saved! : conversations[0]?.id ?? "";
}

function loadActiveMessages() {
  const conversations = loadConversations();
  const activeId = localStorage.getItem("andreagpt-active-conversation");
  return conversations.find((conversation) => conversation.id === activeId)?.messages ?? conversations[0]?.messages ?? [];
}

const titleStopWords = new Set<string>([
  "a", "ad", "al", "alla", "anche", "che", "come", "con", "da", "dal", "dei", "del", "della", "di", "e", "è", "fare", "fai", "gli", "il", "in", "la", "le", "mi", "nel", "nella", "non", "o", "per", "più", "questo", "sono", "su", "un", "una", "vorrei",
]);

function createConversationTitle(content: string) {
  const words: string[] = Array.from(content.toLocaleLowerCase("it-IT").match(/[\p{L}\p{N}+#.-]+/gu) ?? []);
  const keywords = words.filter((word, index) => word.length > 2 && !titleStopWords.has(word) && words.indexOf(word) === index).slice(0, 4);
  const selected = keywords.length ? keywords : words.slice(0, 3);
  const title = selected.join(" ").trim();
  return title ? title.charAt(0).toLocaleUpperCase("it-IT") + title.slice(1) : "Nuova conversazione";
}
