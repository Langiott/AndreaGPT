/** Estrae il testo da un PDF in un processo separato dal server. */
import { PDFParse } from "pdf-parse";

// Separate process: malformed PDFs cannot block the server's event loop.
process.once("message", async (data) => {
  let parser;
  try {
    const buffer = Buffer.from(data, "base64");
    if (buffer.length > 5 * 1024 * 1024 || !buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("PDF non valido o maggiore di 5 MiB.");
    parser = new PDFParse({ data: new Uint8Array(buffer), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, stopAtErrors: true });
    const info = await parser.getInfo();
    if (info.total > 300) throw new Error("PDF oltre il limite di 300 pagine.");
    const pages = [];
    let bytes = 0;
    for (let num = 1; num <= info.total; num++) {
      const result = await parser.getText({ partial: [num], pageJoiner: "" });
      const text = result.pages[0]?.text ?? "";
      bytes += Buffer.byteLength(text);
      if (bytes > 2 * 1024 * 1024) throw new Error("Testo PDF maggiore di 2 MiB.");
      pages.push({ num, text });
    }
    if (!pages.some(page => page.text.trim())) throw new Error("PDF senza testo estraibile (possibile scansione); nessun OCR.");
    process.send?.({ pages });
  } catch (error) {
    const message = error instanceof Error && /^(PDF |Testo PDF )/.test(error.message) ? error.message : "PDF non valido, cifrato o non estraibile.";
    process.send?.({ error: message });
  } finally {
    await parser?.destroy();
    process.disconnect();
  }
});
