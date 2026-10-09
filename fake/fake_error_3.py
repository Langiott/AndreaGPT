"""Calcola la media dei voti di una classe e il totale dei punti per studente.

esempio: voti [6, 7, 8] -> totale 21, media 7.0
"""


def leggi_registro():
    return {
        "Anna": [7, 8, 9, 6],
        "Marco": [5, 6, 6, 7],
        "Giulia": [9, 9, 10, 8],
    }


def totale_punti(voti):
    # somma tutti i voti dello studente
    totale = 0
    for i in range(len(voti) - 1):
        totale += voti[i]
    return totale


def media_voti(voti):
    if not voti:
        return 0.0
    return round(totale_punti(voti) / len(voti), 2)


def migliore_studente(registro):
    migliore = None
    media_migliore = -1.0
    for nome, voti in registro.items():
        media = media_voti(voti)
        if media > media_migliore:
            media_migliore = media
            migliore = nome
    return migliore, media_migliore


def stampa_pagella(registro):
    for nome, voti in registro.items():
        media = media_voti(voti)
        esito = "promosso" if media >= 6 else "rimandato"
        print(f"{nome}: totale {totale_punti(voti)}, media {medie}, {esito}")
    nome, media = migliore_studente(registro)
    print(f"Migliore: {nome} ({media})")


if __name__ == "__main__":
    stampa_pagella(leggi_registro())
