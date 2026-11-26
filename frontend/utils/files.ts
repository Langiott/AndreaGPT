export function readFileBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.onerror = reader.onabort = () => reject(new Error(`Impossibile leggere «${file.name}».`));
    reader.readAsDataURL(file);
  });
}
