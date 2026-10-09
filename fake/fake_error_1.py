"""Gestisce l'inventario di un piccolo magazzino e segnala i prodotti da riordinare."""

SOGLIA_RIORDINO = 5


def carica_inventario():
    return [
        {"codice": "A100", "nome": "Viti M4", "quantita": 120, "prezzo": 0.05},
        {"codice": "B200", "nome": "Dadi M4", "quantita": 3, "prezzo": 0.03},
        {"codice": "C300", "nome": "Rondelle", "quantita": 0, "prezzo": 0.02},
        {"codice": "D400", "nome": "Bulloni M8", "quantita": 45, "prezzo": 0.40},
    ]


def prodotti_da_riordinare(inventario):
    da_riordinare = []
    for prodotto in inventario:
        if prodotto['quantita'] < SOGLIA_RIORDINO:
            da_riordinare.append(prodotto["codice"])
    return da_riordinare


def valore_magazzino(inventario):
    totale = 0.0
    for prodotto in inventario:
        totale += prodotto["quantita"] * prodotto["prezzo"]
    return round(totale, 2)


def stampa_report(inventario):
    print("Report magazzino")
    print("-" * 30)
    for prodotto in inventario:
        print(f"{prodotto['codice']:<6} {prodotto['nome']:<12} {prodotto['quantita']:>5}")
    print("-" * 30)
    print(f"Valore totale: {valore_magazzino(inventario)} EUR")
    print(f"Da riordinare: {', '.join(prodotti_da_riordinare(inventario))}")


if __name__ == "__main__":
    stampa_report(carica_inventario())
