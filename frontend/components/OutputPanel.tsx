import { Archive, AudioLines, FileText, Image, Newspaper, ScanEye } from "lucide-react";

const folders = {
  images: { name: "Immagini generate", folder: "Image", icon: Image },
  ocr: { name: "OCR", folder: "OCR", icon: FileText },
  news: { name: "News", folder: "News", icon: Newspaper },
  yolo: { name: "YOLO", folder: "YOLO", icon: Image },
  analyze: { name: "Analyze", folder: "Analyze", icon: ScanEye },
  audio: { name: "Audio", folder: "Audio", icon: AudioLines },
  compactChat: { name: "Chat compatte", folder: "Compatta_chat", icon: Archive },
} as const;
export type OutputFolder = keyof typeof folders;
export type OutputFile = { name: string; url: string; size: number; updatedAt: number; image: boolean; thumb?: string; excerpt?: string };
export type OutputTarget = { folder: (typeof folders)[OutputFolder]["folder"]; name: string };
export type OutputDocument = { folder: "Compatta_chat" | "Analyze" | "Audio"; name: string };
const folderKeys = ["images", "ocr", "news", "analyze", "audio", "compactChat"] as const satisfies readonly OutputFolder[];
const newsTitles: Record<string, string> = { ai: "AI News", papers: "Paper scientifici", science: "Scienza e Curiosità" };

export function OutputPanel({ folder, files, onFolder, onDelete, onDocument, onEdition, pendingNews }: {
  folder: OutputFolder | null;
  files: Record<OutputFolder, OutputFile[]>;
  onFolder: (folder: OutputFolder) => void;
  onDelete: (target: OutputTarget) => void;
  onDocument: (target: OutputDocument) => void;
  onEdition: (name: string) => void;
  pendingNews?: { elapsed: string; progress: string; label?: string; open: () => void };
}) {
  if (!folder) return <div className="output-folders">{folderKeys.map(key => {
    const { name, icon: Icon } = folders[key];
    return <button key={key} className="output-folder" onClick={() => onFolder(key)}><Icon size={26} /><strong>{name}</strong><small>{files[key].length} risultati</small></button>;
  })}</div>;

  const storage = folders[folder].folder;
  const isNews = folder === "news";
  const compact = folder === "ocr" || folder === "compactChat";
  const described = isNews || folder === "analyze" || folder === "audio";
  const list = files[folder];
  const loadingNews = isNews && pendingNews;
  return <section className={`output-section${compact ? " output-section-compact" : ""}`}>
    <h3>{folders[folder].name}</h3>
    {!list.length && !loadingNews && <p>Nessun file disponibile.</p>}
    <div className={described ? "output-results" : "output-gallery"}>
      {loadingNews && <div className="output-result"><button type="button" className="output-result-open" onClick={pendingNews.open}>
        <span className="output-file-icon"><span className="operation-pulse" /></span>
        <span><strong>In corso · {pendingNews.elapsed}</strong><small>{pendingNews.progress}</small>{pendingNews.label && <em>{pendingNews.label}</em>}</span>
      </button></div>}
      {list.map(file => {
        const open = () => {
          if (isNews) onEdition(file.name);
          else if (storage === "Analyze" || storage === "Audio" || storage === "Compatta_chat") onDocument({ folder: storage, name: file.name });
        };
        const { icon: Icon } = folders[folder];
        const icon = <span className="output-file-icon"><Icon size={compact ? 17 : 22} /></span>;
        const title = isNews ? newsTitles[file.name.match(/-news-(\w+)\.md$/)?.[1] ?? ""] ?? file.name : file.name.replace(/\.md$/i, "").replace(/^[\dTZ-]+-(?=.)/, "");
        return <div key={file.name} className={described ? "output-result" : "output-item-wrap"}>
          {described ? <button type="button" className="output-result-open" disabled={Boolean(loadingNews)} onClick={open}>
            {file.thumb ? <img src={file.thumb} alt="" loading="lazy" /> : icon}
            <span><strong>{title}</strong><small>{new Date(file.updatedAt).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}</small><em>{(isNews ? file.excerpt?.replace(/^.*?Data:\s*\S+\s*/, "") : file.excerpt) || "—"}</em></span>
          </button> : folder === "compactChat" ? <button type="button" className="output-item" onClick={open}>{icon}<span>{file.name}</span></button> : <a href={file.url} className="output-item" target="_blank" rel="noreferrer" title={file.name}>
            {file.image ? <img src={file.thumb ?? file.url} alt="" loading="lazy" decoding="async" /> : icon}<span>{file.name}</span>
          </a>}
          <button type="button" className="output-delete" onClick={() => onDelete({ folder: storage, name: file.name })} aria-label={`Elimina ${file.name}`}>Elimina</button>
        </div>;
      })}
    </div>
  </section>;
}
