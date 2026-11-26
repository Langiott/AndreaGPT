// Terza batteria alla cieca, scritta dopo le correzioni della seconda: misura quanto le regole reggono su frasi mai viste.
import { createOffice } from "../../backend/office/office";
import { chatOfficeText } from "../../backend/office/chat_actions";

type Want = "chat" | "office" | RegExp;
const turns: [string, Want][] = [
  ["buongiorno", "chat"],
  ["salva la carta di Sabo OP05-007 one piece per favore", /«Sabo OP05-007» catalogato in «One Piece»/],
  ["Aggiungi carta One Piece: Ace", /«Ace» catalogato in «One Piece»/],
  ["registrami Boa Hancock OP07-051 nella collezione One Piece", /Boa Hancock OP07-051.*One Piece/],
  ["metti tra le carte pokemon Gengar", /Gengar.*Pokémon/],
  ["salva le carte one piece Kid, Killer e Law", /1\. «Kid».*2\. «Killer».*3\. «Law»/s],
  ["ops annulla", /Annullato: Kid, Killer, Law/],
  ["ho la carta di Sabo?", "office"],
  ["ce l'ho Ace?", "office"],
  ["fammi vedere le mie carte one piece", /elementi? trovat/],
  ["elenca le carte pokemon che ho", /Gengar/],
  ["quanti abbonamenti attivi ho", /Abbonamenti:/],
  ["dimmi i miei abbonamenti", "office"],
  ["spesa annuale abbonamenti?", /Totale annuo|Non ci sono abbonamenti/],
  ["quanto vale la mia carta Sabo OP05-007?", /Sabo OP05-007/],
  ["mi mancano carte del set OP05?", /Set OP05/],
  ["riassumi https://example.org/x e salvalo", /Nota salvata/],
  ["riassunto di https://example.org/x, non salvarlo", /Articolo\n\nPunti chiave\n\nFonte/],
  // chat normale
  ["che differenza c'è tra un abbonamento mensile e annuale?", "chat"],
  ["suggeriscimi un abbonamento streaming economico", "chat"],
  ["salvami dalla noia, raccontami una barzelletta", "chat"],
  ["trova l'errore in questa frase: io ha mangiato", "chat"],
  ["cerca di essere più breve nelle risposte", "chat"],
  ["mostrami un esempio di codice javascript", "chat"],
  ["la carta di one piece più rara quanto vale?", "chat"],
  ["registra mentalmente che preferisco risposte brevi", "chat"],
  ["annulla la frase precedente e riscrivila meglio", "chat"],
  ["metti in ordine alfabetico: pera, mela, uva", "chat"],
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
