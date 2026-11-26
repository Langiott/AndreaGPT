// Seconda batteria "alla cieca": frasi scritte senza guardare le regole, con refusi, senza accenti, colloquiali.
// "chat" = deve restare alla chat; "office" = qualsiasi gestione dell'ufficio va bene; regex = risposta precisa.
import { createOffice } from "../../backend/office/office";
import { chatOfficeText } from "../../backend/office/chat_actions";

type Want = "chat" | "office" | RegExp;
const turns: [string, Want][] = [
  ["ehi mi salvi una carta? è Kaido OP04-044 di one piece", /Kaido OP04-044.*One Piece/],
  ["salva carta one piece yamato op04-112", /yamato op04-112.*One Piece/i],
  ["aggiungi la carta Charizard alla collezione pokemon", /Charizard.*Pokémon/],
  ["catalogami queste due carte pokemon: Bulbasaur e Squirtle", /1\. «Bulbasaur».*2\. «Squirtle»/s],
  ["ho comprato una carta, Big Mom OP03-114 one piece, salvamela", /Big Mom OP03-114.*One Piece/],
  ["ce lho la carta kaido?", /Kaido/],
  ["c'è Charizard tra le mie carte?", "office"],
  ["mostrami tutte le carte pokemon", "office"],
  ["no aspetta, annulla", /Annullato|Non c’è/],
  ["quanti abbonamenti ho attualmente", /Abbonamenti:/],
  ["quali abbonamenti pago?", /Abbonamenti:/],
  ["quanto pago di abbonamenti al mese?", /Totale mensile|Non ci sono abbonamenti/],
  ["riassumimi questa pagina https://example.org/pezzo", /Articolo/],
  ["dammi un riassunto veloce di https://example.org/pezzo senza salvare niente", /Articolo\n\nPunti chiave/],
  ["che carte mi mancano per completare OP04?", /Set OP04/],
  ["quanto vale kaido op04-044", /prezzo|Non trovo|fonte/i],
  // conversazione normale mischiata
  ["mi spieghi come funziona un abbonamento in palestra?", "chat"],
  ["quanto costa in media un abbonamento netflix in italia?", "chat"],
  ["scrivi una storia su una carta magica", "chat"],
  ["traduci in inglese: ho salvato la carta", "chat"],
  ["cosa significa carta bianca?", "chat"],
  ["come faccio a salvare un file in word?", "chat"],
  ["cerca informazioni su Luffy", "chat"],
  ["trovami una ricetta per la carbonara", "chat"],
  ["mi aiuti a scrivere una lettera di disdetta dell'abbonamento sky?", "chat"],
  ["elenca i personaggi principali di one piece", "chat"],
  ["annullare un ordine amazon come si fa?", "chat"],
  ["quanto vale un bitcoin oggi?", "chat"],
  ["qual è la carta più costosa del mondo?", "chat"],
  ["ciao come stai", "chat"],
];

const office = createOffice(":memory:", "Europe/Rome", {
  classify: async (text) => { throw new Error(`modello: ${text}`); },
  search: async () => [], photos: async () => [],
  summarizeLink: async url => ({ title: "Articolo", notes: "Punti chiave", url }),
});
let ok = 0;
for (const [text, want] of turns) {
  const forwarded = chatOfficeText(text, "2026-11-26");
  const job = forwarded ? await office.request(forwarded, "board", undefined, true).done : undefined;
  const got = !forwarded ? "chat" : job?.result?.message ?? "";
  const usedModel = job?.status === "error";
  const pass = want === "chat" ? got === "chat" : got !== "chat" && (want === "office" ? !usedModel : !usedModel && want.test(got));
  if (pass) ok++;
  console.log(`${pass ? "OK" : "XX"}  «${text}» → ${got === "chat" ? "chat" : (usedModel ? "[modello locale] " : "") + JSON.stringify(got).slice(0, 150)}`);
}
console.log(`\n${ok}/${turns.length}`);
office.close();
