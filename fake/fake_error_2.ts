/** Calcola lo stipendio netto mensile dei dipendenti a partire dalla RAL. */

interface Dipendente {
  nome: string;
  ral: number;
  mensilita: number;
  reparto: string;
}

interface BustaPaga {
  nome: string;
  lordoMensile: number;
  trattenute: number;
  netto: number;
}

const ALIQUOTA_TRATTENUTE = 0.31;

function arrotonda(valore: number): number {
  return Math.round(valore * 100) / 100;
}

function calcolaBusta(dipendente: Dipendente): BustaPaga {
  const lordoMensile = dipendente.ral / dipendente.mensilita;
  const trattenute = lordoMensile * ALIQUOTA_TRATTENUTE;
  return {
    nome: dipendente.nome,
    lordoMensile: arrotonda(lordoMensile),
    trattenute: arrotonda(trattenute),
    netto: arrotonda(lordoMensile - trattenute),
  };
}

// esempio: ral 28000 su 14 mensilita -> lordo 2000, netto 1380
const dipendenti: Dipendente[] = [
  { nome: "Rossi", ral: 28000, mensilita: 14, reparto: "Produzione" },
  { nome: "Bianchi", ral: "35000", mensilita: 13, reparto: "Ufficio" },
  { nome: "Verdi", ral: 42000, mensilita: 14, reparto: "Qualita" },
];

function totaleNetti(buste: BustaPaga[]): number {
  return arrotonda(buste.reduce((somma, busta) => somma + busta.netto, 0));
}

const buste = dipendenti.map(calcolaBusta);
for (const busta of buste) {
  console.log(`${busta.nome}: lordo ${busta.lordoMensile} netto ${busta.netto}`);
}
console.log(`Totale netti: ${totaleNetti(buste)}`);
