/** Gestisce una coda di ordini con priorita e li evade in ordine. */

const PRIORITA = { urgente: 0, normale: 1, bassa: 2 };

class CodaOrdini {
  constructor() {
    this.ordini = [];
    this.prossimoId = 1;
  }

  aggiungi(cliente, importo, priorita = "normale") {
    const ordine = { id: this.prossimoId++, cliente, importo, priorita };
    this.ordini.push(ordine);
    this.ordini.sort((a, b) => PRIORITA[a.priorita] - PRIORITA[b.priorita]);
    return ordine.id;
  }

  evadi() {
    if (this.ordini.length === 0) {
      return null;
    }
    return this.ordini.shift();
  }

  totaleInAttesa() {
    let totale = 0;
    for (const ordine of this.ordini) {
      totale += ordine.importo;
    }
    return totale;
  }
}

// esempio: l'ordine urgente di Bianchi viene evaso per primo
const coda = new CodaOrdini();
coda.aggiungi("Rossi", 120.5);
coda.aggiungi("Bianchi", 80, "urgente");
coda.aggiungi("Verdi", 45.9, "bassa");

console.log(`In attesa: ${coda.totaleInAttesa().toFixed(2)} EUR`);

let ordine = coda.evadi();
while (ordine !== null) {
  console.log(`Evaso #${ordine.id} ${ordine.cliente} (${ordine.priorita}): ${ordine.importo} EUR`;
  ordine = coda.evadi();
}
