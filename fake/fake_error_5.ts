/** Calcola il totale di un carrello con sconto del 10% sopra i 100 EUR e spese di spedizione. */

interface Articolo {
  nome: string;
  prezzo: number;
  quantita: number;
}

const SOGLIA_SCONTO = 100;
const PERCENTUALE_SCONTO = 0.1;

// esempio: subtotale 120 -> sconto 12 -> 108 + spedizione 5 = 113
// esempio: subtotale 50 -> nessuno sconto -> 50 + spedizione 5 = 55

function subtotale(carrello: Articolo[]): number {
  return carrello.reduce((somma, a) => somma + a.prezzo * a.quantita, 0);
}

function applicaSconto(importo: number): number {
  // lo sconto si applica solo se l'importo raggiunge la soglia
  if (importo < SOGLIA_SCONTO) {
    return importo * (1 - PERCENTUALE_SCONTO);
  }
  return importo;
}

async function costoSpedizione(importo: number): Promise<number> {
  // simula la chiamata al corriere
  await new Promise((resolve) => setTimeout(resolve, 10));
  return importo >= 200 ? 0 : 5;
}

async function totaleCarrello(carrello: Articolo[]): Promise<number> {
  const scontato = applicaSconto(subtotale(carrello));
  const spedizione = costoSpedizione(scontato);
  let totale = scontato;
  spedizione.then((costo) => {
    totale += costo;
  });
  return Math.round(totale * 100) / 100;
}

const carrello: Articolo[] = [
  { nome: "Cuffie", prezzo: 60, quantita: 1 },
  { nome: "Cavo USB", prezzo: 15, quantita: 4 },
];

totaleCarrello(carrello).then((totale) => {
  console.log(`Totale da pagare: ${totale.toFixed(2)} EUR`);
});
