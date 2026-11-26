// Conversazione mista sul server vero (/api/chat), ripetuta N volte.
// Le azioni devono tornare con {officeAction:true}; le domande normali devono arrivare al modello (qui senza modello → errore 400 atteso).
// Uso: node scripts/test/conversazione_http.mjs [porta] [giri]
const base = `http://localhost:${process.argv[2] || 8799}`;
const rounds = Number(process.argv[3] || 3);
const conversationId = "6f1c2b9e-1a2b-4c3d-8e9f-0123456789ab";
const turns = [
  ["ciao, come va?", "chat"],
  ["salva la carta One Piece Crocodile OP01-067 per favore", /«Crocodile OP01-067» (?:catalogato|già presente) in «One Piece»/],
  ["salva anche Mihawk OP01-070 e Buggy OP01-061 di one piece", /Mihawk OP01-070.*Buggy OP01-061/s],
  ["ce l'ho Buggy?", /Buggy OP01-061/],
  ["spiegami le regole del gioco di carte di One Piece", "chat"],
  ["ops annulla", /Annullato: Mihawk OP01-070, Buggy OP01-061|Annullato/],
  ["quanti abbonamenti ho?", /Abbonamenti: \d/],
  ["scrivimi una mail per disdire un abbonamento", "chat"],
  ["quali carte mi mancano del set OP01?", /Set OP01/],
  ["quanto vale la carta Crocodile OP01-067?", /SearXNG non risponde|prezzo indicativo|Nessuna fonte|Nessun prezzo/],
  ["annulla", /Annullato|Non c’è/],
];
let ok = 0, total = 0;
for (let round = 1; round <= rounds; round++) {
  const history = [];
  for (const [text, want] of turns) {
    total++;
    history.push({ role: "user", content: text });
    const started = performance.now();
    const response = await fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "ollama", conversationId, model: "nessun-modello", maxTokens: 512, messages: history }) });
    const body = await response.text();
    const action = body.includes('"officeAction":true');
    const content = [...body.matchAll(/^data: (\{.*\})$/gm)].map(match => JSON.parse(match[1])?.choices?.[0]?.delta?.content ?? "").join("");
    const pass = want === "chat" ? !action && response.status === 400 : action && want.test(content);
    if (pass) ok++;
    console.log(`${pass ? "OK" : "XX"} [${round}] ${Math.round(performance.now() - started)}ms «${text}» → ${action ? "AZIONE " + JSON.stringify(content.split("\n\n[Apri")[0]).slice(0, 110) : `chat (HTTP ${response.status})`}`);
    history.push({ role: "assistant", content: content || "risposta del modello" });
  }
}
console.log(`\n${ok}/${total} turni corretti via HTTP`);
