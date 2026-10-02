/**
 * Contiene i limiti e le impostazioni usate dal Brain.
 * Qui non c'è logica: ci sono solo valori condivisi dall'indicizzazione.
 */
import { BRAIN_MAX_FILE_BYTES } from "../../frontend/config/brain_upload_limits";

// Modello e versione del formato dell'indice (3: righe iniziali corrette dopo la sovrapposizione).
export const BRAIN_MODEL = "nomic-embed-text";
export const BRAIN_VERSION = 3;

// Limiti usati durante la lettura e l'indicizzazione dei file.
export const BRAIN_MAX_FILE = BRAIN_MAX_FILE_BYTES;
export const BRAIN_MAX_TEXT = 2 * 1024 * 1024;
export const BRAIN_MAX_TABULAR_SAMPLE = 420 * 1024;
export const BRAIN_MAX_CHUNKS = Number.parseInt(process.env.BRAIN_MAX_CHUNKS ?? "100000", 10);
export const BRAIN_MAX_FILES = 5_000;
export const BRAIN_CHUNK_SIZE = 1200;
export const BRAIN_CHUNK_OVERLAP = 180;
export const BRAIN_BATCH_SIZE = Math.max(1, Math.min(64, Number(process.env.BRAIN_EMBED_BATCH ?? 32) || 32));
export const BRAIN_EMBED_CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.BRAIN_EMBED_CONCURRENCY ?? 3) || 3));

// Estensioni che Brain può leggere.
export const BRAIN_EXTENSIONS = new Set(
  ".md .markdown .txt .ts .tsx .js .jsx .mjs .cjs .py .rs .go .java .c .h .cpp .hpp .cs .css .scss .html .xml .json .yaml .yml .toml .sql .sh .ps1 .rb .php .vue .svelte .odt .ods .odp .doc .docx .docm .rtf .epub .ppt .pptx .pps .xls .xlsx .csv .pdf .ipynb".split(" "),
);

// File temporanei, segreti e cartelle esterne all'archivio.
export const BRAIN_EXCLUDED = /^(?:\..*|node_modules|dist|build|coverage|vendor|__pycache__|secrets?|credentials?)(?:$)|(?:secret|credential|password|token|private[-_]?key)|\.(?:pem|key|p12|pfx|keystore)$|^env(?:\.|$)/i;
