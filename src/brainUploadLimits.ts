export const BRAIN_UPLOAD_PRESETS = [
  { id: 5, label: "Piccolo", fileMiB: 5, totalMiB: 10 },
  { id: 20, label: "Standard", fileMiB: 20, totalMiB: 40 },
  { id: 50, label: "Grande", fileMiB: 50, totalMiB: 100 },
  { id: 100, label: "Extra", fileMiB: 100, totalMiB: 200 },
] as const;
export const BRAIN_MAX_FILE_BYTES = 100 * 1024 * 1024;
export function brainUploadPreset(id: number) {
  const preset = BRAIN_UPLOAD_PRESETS.find(item => item.id === id);
  if (!preset) throw new Error("Pacchetto di caricamento non valido.");
  return preset;
}
