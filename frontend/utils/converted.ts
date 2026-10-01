export type Converted = { name: string; type: string; data: string };

export function downloadConverted(result: Converted) {
  const bytes = Uint8Array.from(atob(result.data), character => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: result.type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = result.name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
