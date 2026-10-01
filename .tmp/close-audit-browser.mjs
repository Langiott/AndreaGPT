const info = await fetch("http://127.0.0.1:9333/json/version").then(response => response.json());
const socket = new WebSocket(info.webSocketDebuggerUrl);
socket.addEventListener("open", () => socket.send(JSON.stringify({ id: 1, method: "Browser.close" })), { once: true });
await new Promise(resolve => setTimeout(resolve, 500));
