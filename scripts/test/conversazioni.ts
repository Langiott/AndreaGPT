// Conversazioni complete: stesso percorso del server (chatOfficeText -> office.request).
// "chat" = deve restare alla chat normale; regex = risposta attesa dall'ufficio.
import { createOffice } from "../../backend/office/office";
import { chatOfficeText } from "../../backend/office/chat_actions";

type Turn = [string, "chat" | RegExp];
const llmCalls: string[] = [];
const conversations: Record<string, Turn[]> = {
  "collezionista One Piece": [
    ["ciao!", "chat"],
    ["salva la carta One Piece Luffy OP01-024", /«Luffy OP01-024» catalogato in «One Piece»/],
    ["salvami anche Zoro OP01-025 di one piece", /«Zoro OP01-025» catalogato in «One Piece»/],
    ["metti nella collezione One Piece la carta Nami OP01-016", /«Nami OP01-016» catalogato in «One Piece»/],
    ["quali sono le carte più rare di One Piece?", "chat"],
    ["ce l'ho la carta di Zoro?", /1 elemento trovato\nZoro OP01-025/],
    ["trovami quella carta su one piece Nami", /Nami OP01-016/],
    ["quali carte mi mancano del set OP01?", /3 carte possedute \(fino a OP01-025\).*OP01-017, OP01-018/s],
    ["salva Robin OP01-017 e Usopp OP01-018 di One Piece", /1\. «Robin OP01-017».*\n2\. «Usopp OP01-018»/s],
    ["ho sbagliato, annulla", /Annullato: Robin OP01-017, Usopp OP01-018/],
    ["dov'è la carta di Robin", /0 elementi trovati/],
    ["SALVA LA CARTA ONE PIECE ACE OP02-013", /«ACE OP02-013» catalogato in «One Piece»/],
    ["salva la carta One Piece Luffy OP01-024", /già presente in «One Piece»/],
  ],
  "più giochi di carte": [
    ["aggiungi alle mie carte pokemon Pikachu 25/102", /«Pikachu 25\/102» catalogato in «Pokémon»/],
    ["registra la carta magic Black Lotus", /«Black Lotus» catalogato in «Magic»/],
    ["salva carta Shanks", /«Shanks» catalogato in «Carte»/],
    ["mi salvi la card di Law?", /«Law» catalogato in «Carte»/],
    ["salvami questa carta", /Come si chiama la carta|Come si intitola/],
    ["come si gioca a Magic?", "chat"],
    ["cerca nelle collezioni Pikachu", /Pikachu/],
  ],
  "abbonamenti": [
    ["quanti abbonamenti ho?", /Abbonamenti: 0/],
    ["che abbonamenti ho?", /Abbonamenti: \d/],
    ["quanto spendo al mese di abbonamenti", /Non ci sono abbonamenti con importo|Totale mensile/],
    ["quanto mi costano gli abbonamenti all'anno?", /Non ci sono abbonamenti con importo|Totale annuo/],
    ["scrivimi una mail per disdire un abbonamento", "chat"],
    ["elencami gli abbonamenti", /Abbonamenti:/],
    ["Abbonamenti?", "chat"],
  ],
  "domande normali (non devono diventare azioni)": [
    ["come si gioca a carte?", "chat"],
    ["spiegami la carta costituzionale", "chat"],
    ["cerca la carta igienica in offerta", "chat"],
    ["ho una carta di credito scaduta, che faccio?", "chat"],
    ["salva questo codice python in un file", "chat"],
    ["cerca su google le ultime notizie", "chat"],
    ["quanti anni ha Luffy in One Piece?", "chat"],
    ["aggiungi un commento a questo codice", "chat"],
    ["trova un ristorante a Milano", "chat"],
    ["perché la carta si ingiallisce?", "chat"],
    ["leggi https://example.com e dimmi cosa dice", "chat"],
    ["scrivi una poesia sulla carta", "chat"],
    ["quanto vale un euro in dollari?", "chat"],
    ["dimmi la trama di One Piece", "chat"],
  ],
  "link e riassunti": [
    ["riassumi https://example.org/articolo senza salvare", /Articolo\n\nPunti chiave/],
    ["fammi un riassunto di https://example.org/articolo", /Nota salvata · Articolo/],
    ["annulla", /Annullato: Articolo/],
    ["sintetizza questo articolo https://example.org/articolo", /Nota salvata/],
  ],
  "prezzi e spostamento carte": [
    ["salva la carta One Piece Luffy OP01-024", /catalogato/],
    ["quanto vale la carta Luffy OP01-024?", /prezzo indicativo 14,00\s€/],
    ["quanto costa la carta Zoro OP09-999?", /Non trovo la carta/],
    ["sposta le carte nelle collezioni", /Nessuna carta nell’archivio Office/],
  ],
  "annullamenti a raffica": [
    ["annulla", /Non c’è nessuna azione recente/],
    ["salva la carta One Piece Luffy OP01-024", /catalogato/],
    ["toglila", /Annullato: collezione One Piece/],
    ["annulla", /Non c’è nessuna azione recente/],
    ["salva la carta pokemon Mew", /catalogato in «Pokémon»/],
    ["salva la carta pokemon Mewtwo", /catalogato in «Pokémon»/],
    ["annulla l'ultima azione", /Annullato: Mewtwo/],
    ["ce l'ho la carta Mew?", /Mew · Pokémon/],
  ],
};

const searchResults = [
  { title: "Luffy OP01-024 venduta", url: "https://a.example/1", snippet: "", candidate: { amount: 10, currency: "EUR" } },
  { title: "Luffy OP01-024", url: "https://b.example/2", snippet: "", candidate: { amount: 14, currency: "EUR" } },
  { title: "Luffy OP01-024 asta", url: "https://c.example/3", snippet: "", candidate: { amount: 30, currency: "EUR" } },
];

const rounds = Number(process.argv[2] || 3);
let total = 0, failed = 0;
for (let round = 1; round <= rounds; round++) {
  for (const [name, turns] of Object.entries(conversations)) {
    const office = createOffice(":memory:", "Europe/Rome", {
      classify: async (text) => { llmCalls.push(text); throw new Error("modello non disponibile nel test"); },
      search: async () => searchResults, photos: async () => [],
      summarizeLink: async url => ({ title: "Articolo", notes: "Punti chiave", url }),
    });
    for (const [text, want] of turns) {
      total++;
      const forwarded = chatOfficeText(text, "2026-11-26");
      let got: string;
      if (!forwarded) got = "chat";
      else got = (await office.request(forwarded, "board", undefined, true).done)?.result?.message ?? "(nessun risultato)";
      const ok = want === "chat" ? got === "chat" : got !== "chat" && want.test(got);
      if (!ok) { failed++; console.log(`XX [giro ${round}] ${name} · «${text}»\n   atteso ${want}\n   ottenuto ${JSON.stringify(got).slice(0, 220)}`); }
    }
    office.close();
  }
}
console.log(`\n${total - failed}/${total} turni corretti in ${rounds} giri · ${new Set(llmCalls).size} frasi diverse sarebbero andate al modello locale:`);
for (const text of new Set(llmCalls)) console.log("   -", text);
