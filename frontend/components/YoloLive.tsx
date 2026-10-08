import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SwitchCamera, X } from "lucide-react";
import { userErrorMessage } from "../utils/errors";

interface Box { x1: number; y1: number; x2: number; y2: number; label: string; conf: number; cls: number }

const COLORI = ["#e5484d", "#3e63dd", "#30a46c", "#f76b15", "#8e4ec6", "#12a594", "#d6409f", "#946800"];
/** Lato lungo del fotogramma inviato: uguale a imgsz di YOLO (640), oltre non migliora il rilevamento. */
const LATO = 640;

/** Fotocamera a tutto schermo con i box YOLO sopra: un fotogramma alla volta, il successivo parte alla risposta. */
export function YoloLive({ onClose }: { onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  // Fotocamera scelta (deviceId, ricordata); vuota = la posteriore predefinita.
  const [camera, setCamera] = useState(() => { try { return localStorage.getItem("yolo-live-camera") || ""; } catch { return ""; } });
  const [camere, setCamere] = useState<string[]>([]);
  const [specchio, setSpecchio] = useState(false);
  // Riempi = schermo pieno senza bande nere (taglia i lati); altrimenti inquadratura intera.
  const [riempi, setRiempi] = useState(() => { try { return localStorage.getItem("yolo-live-fit") !== "intero"; } catch { return true; } });
  const [zoom, setZoom] = useState<{ min: number; max: number; step: number; value: number }>();
  const traccia = useRef<MediaStreamTrack | undefined>(undefined);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [fps, setFps] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    let stream: MediaStream | undefined;
    let attivo = true;
    const grab = document.createElement("canvas");
    setError(""); setBoxes([]);

    async function ciclo() {
      let ultimo = performance.now();
      while (attivo) {
        const v = video.current;
        if (!v || !v.videoWidth) { await new Promise(resolve => setTimeout(resolve, 100)); continue; }
        const scala = Math.min(1, LATO / Math.max(v.videoWidth, v.videoHeight));
        grab.width = Math.round(v.videoWidth * scala);
        grab.height = Math.round(v.videoHeight * scala);
        grab.getContext("2d")?.drawImage(v, 0, 0, grab.width, grab.height);
        try {
          const response = await fetch("/api/yolo/live", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: grab.toDataURL("image/jpeg", 0.8) }) });
          const data = await response.json().catch(() => ({})) as { boxes?: Box[]; error?: string };
          if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
          if (!attivo) return;
          setError("");
          setBoxes(data.boxes ?? []);
          const ora = performance.now();
          setFps(1000 / (ora - ultimo));
          ultimo = ora;
        } catch (caught) {
          if (!attivo) return;
          setError(userErrorMessage(caught, "YOLO non risponde."));
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Fotocamera non disponibile: sul telefono serve HTTPS o il flag di Chrome per questo indirizzo.");
        // Risoluzione alta senza imporre il formato: un 16:9 forzato su un sensore 4:3 viene ritagliato e sembra zoomato.
        // resizeMode "none" chiede i pixel nativi del sensore, senza crop o riscalatura del browser.
        const scelta = camera ? { deviceId: { exact: camera } } : { facingMode: "environment" };
        // 4:3 come il sensore: col 16:9 predefinito Chrome taglia i lati e l'inquadratura sembra zoomata.
        stream = await navigator.mediaDevices.getUserMedia({ video: { ...scelta, width: { ideal: 1920 }, height: { ideal: 1440 }, aspectRatio: { ideal: 4 / 3 }, resizeMode: "none" } as unknown as MediaTrackConstraints, audio: false })
          .catch(error => { if (camera && (error as Error).name === "OverconstrainedError") { setCamera(""); } throw error; });
        if (!attivo) { stream.getTracks().forEach(track => track.stop()); return; }
        const track = stream.getVideoTracks()[0];
        traccia.current = track;
        setSpecchio(track.getSettings().facingMode === "user");
        // Le etichette arrivano solo dopo il permesso: l'elenco si legge qui. Su molti telefoni la grandangolare (0.5-0.6x) è una camera a sé.
        setCamere((await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === "videoinput").map(device => device.deviceId).filter(Boolean));
        const range = (track.getCapabilities?.() as { zoom?: { min: number; max: number; step?: number } } | undefined)?.zoom;
        if (range && range.max > range.min) {
          await track.applyConstraints({ advanced: [{ zoom: range.min } as MediaTrackConstraintSet] }).catch(() => undefined);
          setZoom({ min: range.min, max: range.max, step: range.step || 0.1, value: range.min });
        } else setZoom(undefined);
        if (video.current) { video.current.srcObject = stream; await video.current.play().catch(() => undefined); }
        void ciclo();
      } catch (caught) {
        const nome = (caught as Error).name;
        setError(nome === "NotAllowedError" ? "Fotocamera non consentita: abilitala nel browser." : nome === "NotFoundError" ? "Nessuna fotocamera trovata." : userErrorMessage(caught, "Fotocamera non disponibile."));
      }
    })();

    return () => { attivo = false; stream?.getTracks().forEach(track => track.stop()); };
  }, [camera]);

  function prossimaCamera() {
    const attuale = traccia.current?.getSettings().deviceId || camera;
    const prossima = camere[(camere.indexOf(attuale) + 1) % camere.length] ?? "";
    setCamera(prossima);
    try { localStorage.setItem("yolo-live-camera", prossima); } catch { /* storage non disponibile */ }
  }

  function cambiaZoom(value: number) {
    setZoom(current => current && { ...current, value });
    void traccia.current?.applyConstraints({ advanced: [{ zoom: value } as MediaTrackConstraintSet] }).catch(() => undefined);
  }

  // Box disegnati sull'area in cui il video è davvero visibile (object-fit: contain lascia bande).
  useEffect(() => {
    const v = video.current, canvas = overlay.current;
    if (!v || !canvas) return;
    const disegna = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx || !v.videoWidth) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      const scala = (riempi ? Math.max : Math.min)(rect.width / v.videoWidth, rect.height / v.videoHeight);
      const w = v.videoWidth * scala, h = v.videoHeight * scala;
      const ox = (rect.width - w) / 2, oy = (rect.height - h) / 2;
      ctx.font = "600 13px ui-monospace, Consolas, monospace";
      ctx.lineWidth = 2.5;
      for (const box of boxes) {
        const colore = COLORI[box.cls % COLORI.length];
        const x1 = specchio ? 1 - box.x2 : box.x1, x2 = specchio ? 1 - box.x1 : box.x2;
        const x = ox + x1 * w, y = oy + box.y1 * h, bw = (x2 - x1) * w, bh = (box.y2 - box.y1) * h;
        ctx.strokeStyle = colore;
        ctx.strokeRect(x, y, bw, bh);
        const testo = `${box.label} ${Math.round(box.conf * 100)}%`;
        const tw = ctx.measureText(testo).width + 10;
        const ty = y >= 20 ? y - 20 : y;
        ctx.fillStyle = colore;
        ctx.fillRect(x, ty, tw, 20);
        ctx.fillStyle = "#fff";
        ctx.fillText(testo, x + 5, ty + 14);
      }
    };
    disegna();
    window.addEventListener("resize", disegna);
    return () => window.removeEventListener("resize", disegna);
  }, [boxes, specchio, riempi]);

  function cambiaVista() {
    setRiempi(current => {
      try { localStorage.setItem("yolo-live-fit", current ? "intero" : "riempi"); } catch { /* storage non disponibile */ }
      return !current;
    });
  }

  useEffect(() => {
    const esc = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const risoluzione = video.current?.videoWidth ? `${video.current.videoWidth}×${video.current.videoHeight}` : "";
  const conteggio =Object.entries(boxes.reduce<Record<string, number>>((acc, box) => ({ ...acc, [box.label]: (acc[box.label] ?? 0) + 1 }), {}));

  return createPortal(
    <div className="yolo-live" role="dialog" aria-label="YOLO dal vivo">
      <video ref={video} className={[specchio && "mirror", riempi && "fill"].filter(Boolean).join(" ") || undefined} playsInline muted />
      <canvas ref={overlay} onClick={cambiaVista} />
      <div className="yolo-live-bar">
        <span className="yolo-live-fps">{fps ? `${fps.toFixed(1)} fps` : "…"}{risoluzione && ` · ${risoluzione}`}</span>
        <span className="yolo-live-count">{conteggio.map(([label, n]) => `${label}${n > 1 ? ` ×${n}` : ""}`).join(" · ")}</span>
        {camere.length > 1 && <button type="button" className="yolo-live-cam" onClick={prossimaCamera} aria-label="Cambia fotocamera" title="Cambia fotocamera"><SwitchCamera size={18} /><small>{Math.max(1, camere.indexOf(traccia.current?.getSettings().deviceId ?? "") + 1)}/{camere.length}</small></button>}
        <button type="button" onClick={onClose} aria-label="Chiudi" title="Chiudi"><X size={18} /></button>
      </div>
      {zoom && <label className="yolo-live-zoom"><span>{zoom.value.toFixed(1)}x</span><input type="range" min={zoom.min} max={zoom.max} step={zoom.step} value={zoom.value} onChange={event => cambiaZoom(Number(event.target.value))} aria-label="Zoom" /></label>}
      {error && <p className="yolo-live-error">{error}</p>}
    </div>,
    document.body,
  );
}
