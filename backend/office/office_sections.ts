export const extraKinds = ["document", "purchase", "email", "github", "home", "note"] as const;
export const kinds = ["appointment", "subscription", "card", "film", ...extraKinds] as const;
export type Kind = typeof kinds[number];
export type ExtraKind = typeof extraKinds[number];
export const isExtra = (kind: Kind): kind is ExtraKind => extraKinds.some(value => value === kind);
export const labels: Record<Kind, string> = {
  appointment: "Calendario", subscription: "Abbonamenti", card: "Carte", film: "Film",
  document: "Documenti", purchase: "Acquisti", email: "Email", github: "GitHub", home: "Domotica", note: "Note",
};
export const extraFields = {
  document: { deadline: "Scadenza", photoId: "ID foto", url: "Link documento", notes: "Note" },
  purchase: { day: "Data acquisto", deadline: "Fine garanzia", amount: "Prezzo", currency: "Valuta", photoId: "ID foto scontrino", url: "Link scontrino", notes: "Note" },
  email: { ref: "Filtro email", notes: "Note" },
  github: { ref: "Repository (owner/repo)", url: "Link progetto", notes: "Note" },
  home: { ref: "Entità Home Assistant", notes: "Note" },
  note: { notes: "Testo", url: "Fonte" },
} satisfies Record<ExtraKind, Record<string, string>>;
export const sectionActions = {
  document: { check: "Controlla scadenza", findPhoto: "Cerca foto" },
  purchase: { check: "Controlla garanzia", findPhoto: "Cerca scontrino" },
  email: { sync: "Controlla email" },
  github: { sync: "Aggiorna progetto" },
  home: { sync: "Leggi stato", on: "Accendi", off: "Spegni" },
  note: { check: "Leggi nota" },
} satisfies Record<ExtraKind, Record<string, string>>;
export const operations = ["check", "findPhoto", "sync", "on", "off"] as const;
export type Operation = typeof operations[number];
