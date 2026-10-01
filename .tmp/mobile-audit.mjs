import fs from "node:fs/promises";

const [port, widthText, heightText, output, state = "home"] = process.argv.slice(2);
const width = Number(widthText);
const height = Number(heightText);
const targets = await fetch(`http://127.0.0.1:${port}/json`).then(response => response.json());
const target = targets.find(item => item.type === "page");
if (!target) throw new Error("Chrome target not found");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let sequence = 0;
const pending = new Map();
socket.addEventListener("message", event => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const evaluate = expression => send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }).then(result => result.result.value);

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true, screenWidth: width, screenHeight: height });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.navigate", { url: `http://127.0.0.1:3001/?mobileAudit=${Date.now()}` });
await wait(1800);

if (state === "chat") {
  const messages = [
    { id: "audit-user", role: "user", content: "Mostrami una tabella completa e un esempio di codice per verificare la chat su smartphone." },
    { id: "audit-assistant", role: "assistant", modelName: "MiniCPM5 2B", modelProvider: "Ollama", content: "## Risposta di prova\nTesto abbastanza lungo per controllare il ritorno a capo e la leggibilità del messaggio.\n\n| Voce | Valore | Dettaglio |\n|---|---:|---|\n| Schermo | 390 px | Layout mobile |\n| Stato | OK | Nessun overflow |\n\nCodice: const messaggio = 'AndreaGPT mobile';", metrics: { totalMs: 1234, prompt_eval_count: 42, eval_count: 80 } },
  ];
  await evaluate(`(() => {
    const messages = ${JSON.stringify(messages)};
    localStorage.setItem("andreagpt-conversations", JSON.stringify([{ id: "mobile-audit", title: "Verifica smartphone", messages, modelId: "", updatedAt: Date.now() }]));
    localStorage.setItem("andreagpt-active-conversation", "mobile-audit");
    location.reload();
  })()`);
  await wait(1800);
} else if (state !== "home") {
  const special = { ocr: "OCR", yolo: "YOLO", analyze: "Analyze", image: "Image", convert: "Converti" };
  if (special[state]) {
    await evaluate(`(() => { const text = ${JSON.stringify(special[state])}; const button = [...document.querySelectorAll('.topbar-actions button')].find(node => node.textContent.trim().includes(text)); button?.click(); return Boolean(button); })()`);
    await wait(1000);
  } else if (state === "details") {
    await evaluate(`document.querySelector('button[aria-label="Informazioni modello"]')?.click()`);
    await wait(800);
  } else {
  const label = { settings: "Impostazioni", instructions: "Istruzioni", brain: "Archivio Brain", output: "Output", news: "News" }[state];
  if (!label && state !== "micelio") throw new Error(`Unknown state: ${state}`);
  if (state !== "news") {
    await evaluate(`document.querySelector('.menu-button')?.click()`);
    await wait(250);
  }
  const menuLabel = state === "micelio" ? "Archivio Brain" : label;
  await evaluate(`(() => { const text = ${JSON.stringify(menuLabel)}; const button = [...document.querySelectorAll('button')].find(node => node.textContent.trim().includes(text)); button?.click(); return Boolean(button); })()`);
  await wait(1200);
  if (state === "micelio") {
    await evaluate(`(() => { const button = [...document.querySelectorAll('.brain-panel button')].find(node => node.textContent.trim() === 'Micelio'); button?.click(); return Boolean(button); })()`);
    await wait(1000);
  }
  }
}

const audit = await evaluate(`(() => {
  const viewport = { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth };
  const outside = [...document.querySelectorAll('body *')].filter(node => {
    const style = getComputedStyle(node);
    if (style.position === 'fixed' && node.classList.contains('sidebar')) return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && (rect.right > innerWidth + 2 || rect.left < -2);
  }).slice(0, 20).map(node => ({ tag: node.tagName, className: String(node.className).slice(0, 100), left: Math.round(node.getBoundingClientRect().left), right: Math.round(node.getBoundingClientRect().right), width: Math.round(node.getBoundingClientRect().width) }));
  return { viewport, outside };
})()`);
const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, fromSurface: true });
await fs.writeFile(output, Buffer.from(screenshot.data, "base64"));
socket.close();
process.stdout.write(JSON.stringify({ state, ...audit }));
