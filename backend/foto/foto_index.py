"""Indice foto del telefono: miniatura, ricerca per contenuto (SigLIP 2), tag YOLO, volti (SCRFD + ArcFace), testo (Tesseract).

Worker persistente (json_serve): Node scarica una foto alla volta via ADB e chiede "analyze"; l'originale viene poi cancellato.
Tutto lo stato vive in <dir>/foto.sqlite, <dir>/thumbs/<id>.jpg e <dir>/volti/<id>.jpg.
"""
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import time

import numpy as np

# Download dei modelli (Hugging Face, pesi FaceNet) con le CA di sistema, che includono quella dell'antivirus.
if os.path.exists("/etc/ssl/certs/ca-certificates.crt"):
    for variabile in ("SSL_CERT_FILE", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE"):
        os.environ.setdefault(variabile, "/etc/ssl/certs/ca-certificates.crt")

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "utils"))
from json_serve import serve  # noqa: E402

CLIP_MODEL = os.environ.get("FOTO_CLIP_MODEL", "google/siglip2-base-patch16-224")
# Coseno tra impronte ArcFace: stessa persona 0.6–0.9, persone diverse sotto 0.25.
# Sopra SOGLIA_VOLTO il volto va alla persona più vicina; SOGLIA_GRUPPO raggruppa i volti senza persona.
SOGLIA_VOLTO = float(os.environ.get("FOTO_SOGLIA_VOLTO", "0.40"))
SOGLIA_GRUPPO = float(os.environ.get("FOTO_SOGLIA_GRUPPO", "0.35"))
# Volti più piccoli di questa frazione del lato lungo sono sfondo: impronte inaffidabili che si raggruppano tra loro.
VOLTO_MINIMO = float(os.environ.get("FOTO_VOLTO_MINIMO", "0.025"))
ARCFACE_ZIP = "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip"
# Posizione standard di occhi, naso e bocca nel volto 112×112 atteso da ArcFace.
ARCFACE_PUNTI = np.array([[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]], np.float32)
CATEGORIE = {
    "documento": "una foto di un documento o di un foglio stampato con testo",
    "scontrino": "una foto di uno scontrino o di una ricevuta",
    "etichetta": "una foto di un'etichetta adesiva con testo e codice a barre",
    "screenshot": "uno screenshot dello schermo di uno smartphone",
    "schermo": "una foto dello schermo di un computer",
    "persone": "una foto di una o più persone",
    "cibo": "una foto di cibo",
    "animali": "una foto di un animale",
    "paesaggio": "una foto di un paesaggio o di una città",
    "oggetti": "una foto di un oggetto o di un attrezzo",
}
CON_TESTO = {"documento", "scontrino", "etichetta", "screenshot", "schermo"}
YOLO_IT = {
    "person": "persona", "bicycle": "bicicletta", "car": "auto", "motorcycle": "moto", "bus": "autobus", "truck": "camion", "boat": "barca",
    "traffic light": "semaforo", "bench": "panchina", "bird": "uccello", "cat": "gatto", "dog": "cane", "horse": "cavallo",
    "backpack": "zaino", "umbrella": "ombrello", "handbag": "borsa", "tie": "cravatta", "suitcase": "valigia", "bottle": "bottiglia",
    "wine glass": "bicchiere", "cup": "tazza", "fork": "forchetta", "knife": "coltello", "spoon": "cucchiaio", "bowl": "ciotola",
    "banana": "banana", "apple": "mela", "sandwich": "panino", "orange": "arancia", "pizza": "pizza", "donut": "ciambella", "cake": "torta",
    "chair": "sedia", "couch": "divano", "potted plant": "pianta", "bed": "letto", "dining table": "tavolo", "toilet": "bagno",
    "tv": "tv", "laptop": "portatile", "mouse": "mouse", "remote": "telecomando", "keyboard": "tastiera", "cell phone": "telefono",
    "microwave": "microonde", "oven": "forno", "sink": "lavandino", "refrigerator": "frigorifero", "book": "libro", "clock": "orologio",
    "vase": "vaso", "scissors": "forbici", "teddy bear": "peluche", "toothbrush": "spazzolino",
}

db = None
dati = ""
modelli = {}
cache_vettori = None  # (chiave, ids, matrice) per la ricerca; la chiave cambia quando il processo di analisi aggiunge foto


def apri(cartella):
    global db, dati
    # Ricollega anche se il database è stato cancellato a mano (il vecchio file resterebbe aperto).
    if db is not None and dati == cartella and os.path.exists(os.path.join(cartella, "foto.sqlite")):
        return
    dati = cartella
    for sotto in ("thumbs", "volti"):
        os.makedirs(os.path.join(cartella, sotto), exist_ok=True)
    # Due processi (analisi e consultazione) sullo stesso file: WAL + attesa sui lock.
    db = sqlite3.connect(os.path.join(cartella, "foto.sqlite"), timeout=60, check_same_thread=False)
    db.row_factory = sqlite3.Row
    db.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS foto (id INTEGER PRIMARY KEY, remoto TEXT UNIQUE, size INTEGER, mtime INTEGER, scattata INTEGER,
            larghezza INTEGER, altezza INTEGER, categoria TEXT, tag TEXT, testo TEXT, vettore BLOB, analizzata INTEGER);
        CREATE TABLE IF NOT EXISTS persone (id INTEGER PRIMARY KEY, nome TEXT, nascosta INTEGER DEFAULT 0, copertina INTEGER);
        CREATE TABLE IF NOT EXISTS volti (id INTEGER PRIMARY KEY, foto INTEGER, persona INTEGER, x REAL, y REAL, w REAL, h REAL,
            qualita REAL, vettore BLOB, confermato INTEGER DEFAULT 0, rifiutate TEXT DEFAULT '');
        CREATE INDEX IF NOT EXISTS volti_foto ON volti(foto);
        CREATE INDEX IF NOT EXISTS volti_persona ON volti(persona);
        CREATE TABLE IF NOT EXISTS escluse (remoto TEXT PRIMARY KEY);
    """)
    # arc: impronta ArcFace. I volti analizzati prima (solo FaceNet in "vettore") la ricevono da "Aggiorna".
    if "arc" not in {r["name"] for r in db.execute("PRAGMA table_info(volti)")}:
        db.execute("ALTER TABLE volti ADD COLUMN arc BLOB")
        db.commit()


# ---------- modelli (caricati alla prima analisi o ricerca) ----------

def torch_cpu():
    import torch
    torch.set_num_threads(max(1, (os.cpu_count() or 2) - 1))
    return torch


def clip():
    if "clip" not in modelli:
        torch_cpu()
        from transformers import AutoModel, AutoProcessor
        modello = AutoModel.from_pretrained(CLIP_MODEL).eval()
        modelli["clip"] = (modello, AutoProcessor.from_pretrained(CLIP_MODEL))
    return modelli["clip"]


def _tensore(uscita):
    # transformers 5 restituisce un output strutturato invece del tensore.
    return uscita if hasattr(uscita, "norm") else uscita.pooler_output


def vettore_immagine(img):
    import torch
    modello, proc = clip()
    with torch.no_grad():
        v = _tensore(modello.get_image_features(**proc(images=img, return_tensors="pt")))[0]
    return (v / v.norm()).numpy().astype(np.float32)


def vettori_testo(frasi):
    import torch
    modello, proc = clip()
    with torch.no_grad():
        v = _tensore(modello.get_text_features(**proc(text=[f.lower() for f in frasi], padding="max_length", max_length=64, truncation=True, return_tensors="pt")))
    return (v / v.norm(dim=-1, keepdim=True)).numpy().astype(np.float32)


def categorie():
    if "categorie" not in modelli:
        modelli["categorie"] = (list(CATEGORIE), vettori_testo(list(CATEGORIE.values())))
    return modelli["categorie"]


def yolo():
    if "yolo" not in modelli:
        from ultralytics import YOLO
        radice = os.environ.get("OCR_ROOT") or os.path.join(os.getcwd(), "OCR")
        percorso = os.path.join(radice, "models", "yolo11n.pt")
        modelli["yolo"] = YOLO(percorso if os.path.exists(percorso) else "yolo11n.pt")
    return modelli["yolo"]


def insightface(nome):
    """Modelli InsightFace buffalo_l (det_10g = SCRFD, w600k_r50 = ArcFace) in ONNX: archivio scaricato una volta nella cache dei modelli."""
    if nome not in modelli:
        import shutil
        import urllib.request
        import zipfile
        import onnxruntime as ort
        cartella = os.path.join(os.environ.get("HF_HOME") or os.path.join(dati, "modelli"), "insightface")
        file = os.path.join(cartella, nome)
        if not os.path.exists(file):
            os.makedirs(cartella, exist_ok=True)
            archivio = os.path.join(cartella, "buffalo_l.zip")
            with urllib.request.urlopen(ARCFACE_ZIP, timeout=120) as risposta, open(archivio, "wb") as uscita:
                shutil.copyfileobj(risposta, uscita)
            with zipfile.ZipFile(archivio) as z:
                for interno in ("det_10g.onnx", "w600k_r50.onnx"):
                    with z.open(next(n for n in z.namelist() if n.endswith(interno))) as sorgente, open(os.path.join(cartella, interno + ".tmp"), "wb") as uscita:
                        shutil.copyfileobj(sorgente, uscita)
                    os.replace(os.path.join(cartella, interno + ".tmp"), os.path.join(cartella, interno))
            os.remove(archivio)
        modelli[nome] = ort.InferenceSession(file, providers=["CPUExecutionProvider"])
    return modelli[nome]


def arcface():
    return insightface("w600k_r50.onnx")


def scrfd(matrice, lato=640, soglia=0.5):
    """Rilevatore SCRFD: riquadri, punteggi e 5 punti (occhi, naso, bocca) in coordinate dell'immagine."""
    import cv2
    sessione = insightface("det_10g.onnx")
    h, w = matrice.shape[:2]
    scala = lato / max(h, w)
    tela = np.zeros((lato, lato, 3), np.uint8)
    tela[:int(h * scala), :int(w * scala)] = cv2.resize(matrice, (int(w * scala), int(h * scala)))
    uscite = sessione.run(None, {sessione.get_inputs()[0].name: ((tela.astype(np.float32) - 127.5) / 128.0).transpose(2, 0, 1)[None]})
    riquadri, punteggi, punti = [], [], []
    for i, passo in enumerate((8, 16, 32)):
        # Uscite: punteggi, distanze dei bordi e punti per i tre passi; due ancore per cella.
        sc, bb, kp = uscite[i].reshape(-1), uscite[i + 3].reshape(-1, 4) * passo, uscite[i + 6].reshape(-1, 10) * passo
        celle = lato // passo
        cy, cx = np.mgrid[:celle, :celle]
        centri = np.repeat(np.stack([cx.ravel(), cy.ravel()], 1) * passo, 2, axis=0).astype(np.float32)
        tieni = sc >= soglia
        c, b = centri[tieni], bb[tieni]
        riquadri.append(np.stack([c[:, 0] - b[:, 0], c[:, 1] - b[:, 1], c[:, 0] + b[:, 2], c[:, 1] + b[:, 3]], 1) / scala)
        punti.append((np.repeat(c, 5, axis=0).reshape(-1, 10) + kp[tieni]) / scala)
        punteggi.append(sc[tieni])
    riquadri, punteggi, punti = np.concatenate(riquadri), np.concatenate(punteggi), np.concatenate(punti).reshape(-1, 5, 2)
    if not len(riquadri):
        return riquadri, punteggi, punti
    tenuti = np.array(cv2.dnn.NMSBoxes([[float(a), float(b), float(c - a), float(d - b)] for a, b, c, d in riquadri], punteggi.tolist(), soglia, 0.4)).reshape(-1)
    return riquadri[tenuti], punteggi[tenuti], punti[tenuti]


def impronta(immagine, punti):
    """Volto allineato su occhi/naso/bocca → impronta ArcFace normalizzata."""
    import cv2
    matrice, _ = cv2.estimateAffinePartial2D(np.asarray(punti, np.float32), ARCFACE_PUNTI)
    allineato = cv2.warpAffine(immagine, matrice, (112, 112))
    sessione = arcface()
    v = sessione.run(None, {sessione.get_inputs()[0].name: ((allineato.astype(np.float32) - 127.5) / 127.5).transpose(2, 0, 1)[None]})[0][0]
    return (v / np.linalg.norm(v)).astype(np.float32)


# ---------- analisi di una foto ----------

def apri_immagine(percorso):
    from PIL import Image, ImageOps
    try:
        import pillow_heif
        pillow_heif.register_heif_opener()
    except ImportError:
        pass
    img = Image.open(percorso)
    scattata = None
    try:
        exif = img.getexif()
        grezza = exif.get_ifd(0x8769).get(36867) or exif.get(306)
        if grezza:
            scattata = int(time.mktime(time.strptime(str(grezza).strip()[:19], "%Y:%m:%d %H:%M:%S")))
    except Exception:
        pass
    return ImageOps.exif_transpose(img).convert("RGB"), scattata


def ridotta(img, lato):
    copia = img.copy()
    copia.thumbnail((lato, lato))
    return copia


def trova_volti(img, soglia=0.7, lato=640):
    """Soglia più bassa e risoluzione più alta nel secondo controllo ("Aggiorna"): trova anche volti piccoli, di lato o inclinati."""
    matrice = np.asarray(img)
    riquadri, punteggi, punti = scrfd(matrice, lato, soglia)
    minimo = max(img.width, img.height) * VOLTO_MINIMO
    risultato = []
    for (x1, y1, x2, y2), p, occhi in zip(riquadri, punteggi, punti):
        if min(x2 - x1, y2 - y1) < minimo:
            continue
        x1, y1 = max(0.0, float(x1)), max(0.0, float(y1))
        x2, y2 = min(float(img.width), float(x2)), min(float(img.height), float(y2))
        risultato.append({"box": (x1, y1, x2 - x1, y2 - y1), "qualita": float(p) * min(1.0, (x2 - x1) / max(img.width, img.height) * 8), "vettore": impronta(matrice, occhi)})
    return risultato


def leggi_testo(img):
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        ridotta(img, 2200).save(tmp.name)
    try:
        uscita = subprocess.run(["tesseract", tmp.name, "stdout", "-l", os.environ.get("TESSERACT_LANG", "ita+eng"), "--psm", "3"], capture_output=True, timeout=90)
        return " ".join(uscita.stdout.decode("utf-8", "ignore").split())[:4000]
    except Exception:
        return ""
    finally:
        os.unlink(tmp.name)


def ritaglio_volto(img, box, destinazione):
    x, y, w, h = box
    lato = max(w, h) * 1.5
    cx, cy = x + w / 2, y + h / 2
    ritaglio = img.crop((int(max(0, cx - lato / 2)), int(max(0, cy - lato / 2)), int(min(img.width, cx + lato / 2)), int(min(img.height, cy + lato / 2))))
    ritaglio.thumbnail((192, 192))
    ritaglio.save(destinazione, "JPEG", quality=82)


def centroidi():
    """Impronta media di ogni persona (solo volti non rifiutati)."""
    righe = db.execute("SELECT persona, arc FROM volti WHERE persona IS NOT NULL AND arc IS NOT NULL").fetchall()
    gruppi = {}
    for r in righe:
        gruppi.setdefault(r["persona"], []).append(np.frombuffer(r["arc"], dtype=np.float32))
    risultato = {}
    for persona, vettori in gruppi.items():
        media = np.mean(vettori, axis=0)
        risultato[persona] = media / np.linalg.norm(media)
    return risultato


def assegna(vettore, centri, escluse=()):
    migliore, punteggio = None, -1.0
    for persona, centro in centri.items():
        if persona in escluse:
            continue
        s = float(np.dot(vettore, centro))
        if s > punteggio:
            migliore, punteggio = persona, s
    return migliore if punteggio >= SOGLIA_VOLTO else None


def analizza(req):
    img, scattata = apri_immagine(req["path"])
    remoto = req["remote"]
    vecchia = db.execute("SELECT id FROM foto WHERE remoto=?", (remoto,)).fetchone()
    if vecchia:
        elimina_foto(vecchia["id"])
    vettore = vettore_immagine(img)
    nomi, testi = categorie()
    categoria = nomi[int(np.argmax(testi @ vettore))]
    tag = sorted({YOLO_IT.get(yolo().names[int(c)], yolo().names[int(c)]) for c in yolo().predict(ridotta(img, 1280), conf=0.45, verbose=False)[0].boxes.cls.tolist()})
    testo = leggi_testo(img) if categoria in CON_TESTO else ""
    cur = db.execute(
        "INSERT INTO foto (remoto, size, mtime, scattata, larghezza, altezza, categoria, tag, testo, vettore, analizzata) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (remoto, req.get("size"), req.get("mtime"), scattata or req.get("mtime"), img.width, img.height, categoria, " ".join(tag), testo, vettore.tobytes(), int(time.time())),
    )
    foto_id = cur.lastrowid
    ridotta(img, 512).save(os.path.join(dati, "thumbs", f"{foto_id}.jpg"), "JPEG", quality=80)
    volti = trova_volti(img) if "persona" in tag or categoria == "persone" else []
    centri = centroidi() if volti else {}
    for volto in volti:
        x, y, w, h = volto["box"]
        persona = assegna(volto["vettore"], centri)
        vc = db.execute("INSERT INTO volti (foto, persona, x, y, w, h, qualita, arc) VALUES (?,?,?,?,?,?,?,?)",
                        (foto_id, persona, x / img.width, y / img.height, w / img.width, h / img.height, volto["qualita"], volto["vettore"].tobytes()))
        ritaglio_volto(img, volto["box"], os.path.join(dati, "volti", f"{vc.lastrowid}.jpg"))
    db.commit()
    return {"id": foto_id, "categoria": categoria, "volti": len(volti)}


def candidate(_req):
    """Foto con persone, ricontrollate da "Aggiorna"."""
    righe = db.execute("SELECT id, remoto FROM foto WHERE categoria = 'persone' OR tag LIKE '%persona%' OR id IN (SELECT foto FROM volti) ORDER BY scattata DESC").fetchall()
    return {"foto": [dict(r) for r in righe]}


def ricontrolla(req):
    """Secondo controllo di una foto (originale dal telefono o miniatura): volti nuovi aggiunti, impronte ArcFace aggiornate."""
    foto_id = int(req["id"])
    img, _ = apri_immagine(req["path"])
    trovati = trova_volti(img, lato=960)
    esistenti = db.execute("""SELECT v.id, v.x, v.y, v.w, v.h, v.confermato, COALESCE(p.nome, '') nome FROM volti v
                              LEFT JOIN persone p ON p.id = v.persona WHERE v.foto=?""", (foto_id,)).fetchall()
    usati, nuovi = set(), 0
    for volto in trovati:
        x, y, w, h = volto["box"]
        box = (x / img.width, y / img.height, w / img.width, h / img.height)
        uguale = max(esistenti, key=lambda e: sovrapposizione(box, (e["x"], e["y"], e["w"], e["h"])), default=None)
        if uguale is not None and uguale["id"] not in usati and sovrapposizione(box, (uguale["x"], uguale["y"], uguale["w"], uguale["h"])) > 0.3:
            usati.add(uguale["id"])
            db.execute("UPDATE volti SET arc=? WHERE id=?", (volto["vettore"].tobytes(), uguale["id"]))
            continue
        vc = db.execute("INSERT INTO volti (foto, persona, x, y, w, h, qualita, arc) VALUES (?,NULL,?,?,?,?,?,?)", (foto_id, *box, volto["qualita"], volto["vettore"].tobytes()))
        ritaglio_volto(img, volto["box"], os.path.join(dati, "volti", f"{vc.lastrowid}.jpg"))
        nuovi += 1
    # Il secondo controllo fa testo: volti non ritrovati, non confermati e senza nome erano falsi positivi.
    for e in esistenti:
        if e["id"] not in usati and not e["confermato"] and not e["nome"]:
            db.execute("DELETE FROM volti WHERE id=?", (e["id"],))
            try:
                os.unlink(os.path.join(dati, "volti", f"{e['id']}.jpg"))
            except OSError:
                pass
    db.commit()
    return {"volti": len(trovati), "nuovi": nuovi}


def sovrapposizione(a, b):
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    larghezza = max(0.0, min(ax + aw, bx + bw) - max(ax, bx))
    altezza = max(0.0, min(ay + ah, by + bh) - max(ay, by))
    comune = larghezza * altezza
    return comune / (aw * ah + bw * bh - comune) if comune else 0.0


def raggruppa(_req=None):
    """Riallinea i volti ai nomi: gruppi senza nome simili a una persona con nome → uniti; volti liberi → persona più vicina o gruppi nuovi."""
    from scipy.cluster.hierarchy import fcluster, linkage
    piccoli = [r["id"] for r in db.execute("""SELECT v.id FROM volti v JOIN foto f ON f.id = v.foto WHERE v.confermato = 0
        AND MIN(v.w * f.larghezza, v.h * f.altezza) < ? * MAX(f.larghezza, f.altezza)""", (VOLTO_MINIMO,))]
    for volto_id in piccoli:
        db.execute("DELETE FROM volti WHERE id=?", (volto_id,))
        try:
            os.unlink(os.path.join(dati, "volti", f"{volto_id}.jpg"))
        except OSError:
            pass
    # I gruppi senza nome non hanno scelte dell'utente: si rifanno da zero (i volti confermati restano dove sono).
    db.execute("UPDATE volti SET persona = NULL WHERE confermato = 0 AND persona IN (SELECT id FROM persone WHERE nome = '' AND nascosta = 0)")
    centri = centroidi()
    # Dopo aver dato un nome (es. Ambra) i suoi volti finiti in altri gruppi senza nome confluiscono in lei.
    nomi = {r["id"] for r in db.execute("SELECT id FROM persone WHERE nome != '' AND nascosta = 0")}
    senza_nome = {r["id"] for r in db.execute("SELECT id FROM persone WHERE nome = '' AND nascosta = 0")}
    uniti = 0
    for gruppo in senza_nome & set(centri):
        candidati = {p: c for p, c in centri.items() if p in nomi}
        destinazione = assegna(centri[gruppo], candidati)
        if destinazione:
            db.execute("UPDATE volti SET persona=? WHERE persona=?", (destinazione, gruppo))
            uniti += 1
    if uniti:
        centri = centroidi()
    liberi = db.execute("SELECT id, foto, qualita, arc, rifiutate FROM volti WHERE persona IS NULL AND arc IS NOT NULL").fetchall()
    foto_di = {r["id"]: (r["foto"], r["qualita"]) for r in liberi}
    # Prima i volti che ora somigliano a una persona esistente (es. dopo una correzione).
    rimasti = []
    for r in liberi:
        v = np.frombuffer(r["arc"], dtype=np.float32)
        escluse = {int(x) for x in r["rifiutate"].split(",") if x}
        persona = assegna(v, centri, escluse)
        if persona:
            db.execute("UPDATE volti SET persona=? WHERE id=?", (persona, r["id"]))
        else:
            rimasti.append((r["id"], v))
    nuovi = 0
    if len(rimasti) >= 2:
        matrice = np.stack([v for _, v in rimasti])
        etichette = fcluster(linkage(matrice, method="average", metric="cosine"), t=1 - SOGLIA_GRUPPO, criterion="distance")
        gruppi = {}
        for (volto_id, _), e in zip(rimasti, etichette):
            gruppi.setdefault(int(e), []).append(volto_id)
        for membri in gruppi.values():
            # Più volti della stessa foto nel gruppo: resta il migliore, gli altri tornano liberi.
            per_foto = {}
            for m in membri:
                foto, qualita = foto_di[m]
                if foto not in per_foto or qualita > foto_di[per_foto[foto]][1]:
                    per_foto[foto] = m
            membri = list(per_foto.values())
            if len(membri) < 2:
                continue
            persona = db.execute("INSERT INTO persone (nome) VALUES ('')").lastrowid
            db.executemany("UPDATE volti SET persona=? WHERE id=?", [(persona, m) for m in membri])
            nuovi += 1
    aggiorna_copertine()
    db.commit()
    return {"nuove": nuovi, "uniti": uniti}


def aggiorna_copertine():
    db.execute("DELETE FROM persone WHERE id NOT IN (SELECT DISTINCT persona FROM volti WHERE persona IS NOT NULL)")
    db.execute("""UPDATE persone SET copertina = (SELECT id FROM volti WHERE volti.persona = persone.id ORDER BY confermato DESC, qualita DESC LIMIT 1)
                  WHERE copertina IS NULL OR copertina NOT IN (SELECT id FROM volti WHERE volti.persona = persone.id)""")


def elimina_foto(foto_id):
    for r in db.execute("SELECT id FROM volti WHERE foto=?", (foto_id,)).fetchall():
        try:
            os.unlink(os.path.join(dati, "volti", f"{r['id']}.jpg"))
        except OSError:
            pass
    db.execute("DELETE FROM volti WHERE foto=?", (foto_id,))
    db.execute("DELETE FROM foto WHERE id=?", (foto_id,))


# ---------- consultazione ----------

def noti(_req):
    return {"noti": {r["remoto"]: [r["size"], r["mtime"]] for r in db.execute("SELECT remoto, size, mtime FROM foto")},
            "escluse": [r["remoto"] for r in db.execute("SELECT remoto FROM escluse")]}


def rimuovi(req):
    """ids: eliminate dall'app (escluse dalle prossime sincronizzazioni). remoti: sparite dal telefono."""
    tolte = 0
    for foto_id in req.get("ids") or []:
        r = db.execute("SELECT remoto FROM foto WHERE id=?", (int(foto_id),)).fetchone()
        if not r:
            continue
        db.execute("INSERT OR IGNORE INTO escluse (remoto) VALUES (?)", (r["remoto"],))
        elimina_foto(int(foto_id))
        tolte += 1
    for remoto in req.get("remoti") or []:
        db.execute("DELETE FROM escluse WHERE remoto=?", (remoto,))
        r = db.execute("SELECT id FROM foto WHERE remoto=?", (remoto,)).fetchone()
        if r:
            elimina_foto(r["id"])
            tolte += 1
    for sotto, tabella in (("thumbs", "foto"), ("volti", "volti")):
        vivi = {r[0] for r in db.execute(f"SELECT id FROM {tabella}")}
        for nome in os.listdir(os.path.join(dati, sotto)):
            if nome.endswith(".jpg") and nome[:-4].isdigit() and int(nome[:-4]) not in vivi:
                os.unlink(os.path.join(dati, sotto, nome))
    aggiorna_copertine()
    db.commit()
    return {"tolte": tolte}


def riepilogo(_req):
    totale = db.execute("SELECT COUNT(*) FROM foto").fetchone()[0]
    cat = {r["categoria"]: r["n"] for r in db.execute("SELECT categoria, COUNT(*) n FROM foto GROUP BY categoria ORDER BY n DESC")}
    return {"totale": totale, "categorie": cat}


def persone(_req):
    # Le persone eliminate restano come "ignorate": i loro volti, anche nelle foto nuove, finiscono lì e non ricompaiono.
    righe = db.execute("""SELECT p.id, p.nome, p.copertina, COUNT(DISTINCT v.foto) n FROM persone p JOIN volti v ON v.persona = p.id
                          WHERE p.nascosta = 0 GROUP BY p.id ORDER BY (p.nome = ''), n DESC""").fetchall()
    return {"persone": [dict(r) for r in righe]}


def vettori():
    global cache_vettori
    chiave = tuple(db.execute("SELECT COUNT(*), MAX(id) FROM foto").fetchone())
    if cache_vettori is None or cache_vettori[0] != chiave:
        righe = db.execute("SELECT id, vettore FROM foto").fetchall()
        ids = np.array([r["id"] for r in righe], dtype=np.int64)
        cache_vettori = (chiave, ids, np.stack([np.frombuffer(r["vettore"], dtype=np.float32) for r in righe]) if righe else np.zeros((0, 768), np.float32))
    return cache_vettori[1], cache_vettori[2]


def lista(req):
    q = (req.get("q") or "").strip()
    filtri, args = [], []
    if req.get("persone"):
        ricerca = req["persone"].strip().casefold()
        ids = [r["id"] for r in db.execute("SELECT id, nome FROM persone WHERE nascosta=0") if ricerca in (r["nome"] or "").casefold()]
        filtri.append(f"f.id IN (SELECT foto FROM volti WHERE persona IN ({','.join('?' for _ in ids) or 'NULL'}))")
        args.extend(ids)
    if req.get("persona"):
        filtri.append("f.id IN (SELECT foto FROM volti WHERE persona=?)")
        args.append(int(req["persona"]))
    if req.get("categoria"):
        filtri.append("f.categoria=?")
        args.append(req["categoria"])
    dove = f"WHERE {' AND '.join(filtri)}" if filtri else ""
    righe = db.execute(f"SELECT f.id, f.scattata, f.categoria, f.tag, f.testo FROM foto f {dove} ORDER BY f.scattata DESC", args).fetchall()
    if q:
        ids, matrice = vettori()
        punteggi = dict(zip(ids.tolist(), (matrice @ vettori_testo([q])[0]).tolist())) if len(ids) else {}
        parole = q.lower().split()
        nomi = {r["id"] for r in db.execute("SELECT id FROM persone WHERE nome != '' AND lower(nome) LIKE ?", (f"%{q.lower()}%",))}
        con_persona = {r["foto"] for r in db.execute(f"SELECT foto FROM volti WHERE persona IN ({','.join('?' * len(nomi))})", list(nomi))} if nomi else set()
        valutate = []
        for r in righe:
            testo = f"{r['categoria']} {r['tag']} {r['testo']}".lower()
            extra = 0.15 * sum(p in testo for p in parole) + (0.5 if r["id"] in con_persona else 0)
            valutate.append((punteggi.get(r["id"], 0) + extra, r))
        valutate.sort(key=lambda x: -x[0])
        if valutate:
            # Taglio relativo: SigLIP dà coseni bassi in assoluto, conta lo stacco dal migliore.
            soglia = valutate[0][0] - float(os.environ.get("FOTO_STACCO", "0.06"))
            righe = [r for s, r in valutate if s >= soglia or s > 0.3][:400]
    inizio, quante = int(req.get("offset") or 0), int(req.get("limit") or 120)
    return {"totale": len(righe), "foto": [{"id": r["id"], "data": r["scattata"], "categoria": r["categoria"]} for r in righe[inizio:inizio + quante]]}


def dettaglio(req):
    r = db.execute("SELECT id, remoto, scattata, larghezza, altezza, categoria, tag, testo FROM foto WHERE id=?", (int(req["id"]),)).fetchone()
    if not r:
        raise ValueError("Foto non trovata.")
    volti = db.execute("SELECT v.id, v.persona, v.x, v.y, v.w, v.h, v.confermato, p.nome FROM volti v LEFT JOIN persone p ON p.id = v.persona WHERE v.foto=?", (r["id"],)).fetchall()
    return {**dict(r), "volti": [dict(v) for v in volti]}


def copertina(req):
    persona, foto = int(req["id"]), int(req["foto"])
    volto = db.execute("SELECT id FROM volti WHERE persona=? AND foto=? ORDER BY qualita DESC LIMIT 1", (persona, foto)).fetchone()
    if not volto:
        raise ValueError("La foto non contiene questa persona.")
    db.execute("UPDATE persone SET copertina=? WHERE id=?", (volto["id"], persona))
    db.commit()
    return {"ok": True}


def rinomina(req):
    db.execute("UPDATE persone SET nome=? WHERE id=?", ((req.get("nome") or "").strip()[:60], int(req["id"])))
    db.execute("UPDATE volti SET confermato=1 WHERE persona=?", (int(req["id"]),))
    db.commit()
    return {"ok": True}


def nascondi(req):
    db.execute("UPDATE persone SET nascosta=? WHERE id=?", (0 if req.get("mostra") else 1, int(req["id"])))
    db.commit()
    return {"ok": True}


def unisci(req):
    da, verso = int(req["id"]), int(req["in"])
    db.execute("UPDATE volti SET persona=?, confermato=1 WHERE persona=?", (verso, da))
    nome = db.execute("SELECT nome FROM persone WHERE id=?", (verso,)).fetchone()
    if nome and not nome["nome"]:
        altro = db.execute("SELECT nome FROM persone WHERE id=?", (da,)).fetchone()
        if altro:
            db.execute("UPDATE persone SET nome=? WHERE id=?", (altro["nome"], verso))
    aggiorna_copertine()
    db.commit()
    return {"ok": True}


def sposta_volto(req):
    """persona = id → assegna e conferma; persona = null → "non è lui": il volto non tornerà a quella persona."""
    volto = db.execute("SELECT persona, rifiutate FROM volti WHERE id=?", (int(req["id"]),)).fetchone()
    if not volto:
        raise ValueError("Volto non trovato.")
    nuova = req.get("persona")
    nome = (req.get("nome") or "").strip()[:60]
    attuale = db.execute("SELECT id, nome FROM persone WHERE id=?", (volto["persona"],)).fetchone() if volto["persona"] else None
    if nuova == "nuova" and attuale and not attuale["nome"]:
        # Volto di un gruppo ancora senza nome: il nome va al gruppo intero, non a una persona separata.
        return rinomina({"id": attuale["id"], "nome": nome})
    if nuova == "nuova":
        nuova = db.execute("INSERT INTO persone (nome) VALUES (?)", (nome,)).lastrowid
    if nuova:
        db.execute("UPDATE volti SET persona=?, confermato=1 WHERE id=?", (int(nuova), int(req["id"])))
    else:
        rifiutate = ",".join(filter(None, [volto["rifiutate"], str(volto["persona"] or "")]))
        db.execute("UPDATE volti SET persona=NULL, confermato=0, rifiutate=? WHERE id=?", (rifiutate, int(req["id"])))
    aggiorna_copertine()
    db.commit()
    return {"ok": True}


AZIONI = {"candidates": candidate, "recheck": ricontrolla, "remove": rimuovi, "analyze": analizza, "group": raggruppa, "known": noti, "summary": riepilogo, "people": persone, "list": lista, "detail": dettaglio,
          "cover": copertina, "rename": rinomina, "hide": nascondi, "merge": unisci, "face": sposta_volto}


def gestisci(req):
    apri(req["dir"])
    return AZIONI[req["op"]](req)


if __name__ == "__main__":
    if "--serve" in sys.argv:
        serve(gestisci)
    else:
        print(json.dumps(gestisci(json.loads(sys.stdin.read()))))
