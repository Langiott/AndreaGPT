"""Scarica i post salvati e con "mi piace" dell'account Instagram (cookie sessionid del browser).

Legge su stdin un JSON {cookie, sources, limit, known} e scrive su stdout {user, posts, errors}.
Solo l'elenco: ogni post ha didascalia, autore, link e gli URL di immagini e video, che il backend
scarica un post alla volta.
Usa le API web di www.instagram.com, le stesse del browser da cui viene il cookie.
"""
import json
import sys
import time
from urllib.parse import unquote

import requests

API = "https://www.instagram.com/api/v1/"
FEEDS = {"saved": "feed/saved/posts/", "liked": "feed/liked/"}
# Il feed dei mi piace risponde solo all'app mobile ("useragent mismatch" dal browser).
APP_API = "https://i.instagram.com/api/v1/"
APP_AGENT = "Instagram 361.0.0.35.82 (iPhone13,2; iOS 17_0; it_IT; it; scale=3.00; 1170x2532; 674117118)"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    "X-IG-App-ID": "936619743392459",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": "https://www.instagram.com/",
    "Accept": "*/*",
}
MAX_IMAGES = 10
MAX_VIDEOS = 3
# In modalità "entrambi" i post validi possono essere rari: oltre queste pagine di salvati ci si ferma.
MAX_PAGES_BOTH = 25


def parse_cookie(raw):
    """Accetta l'header Cookie copiato dal browser ("a=1; b=2") oppure il solo valore di sessionid."""
    raw = raw.strip()
    if raw.lower().startswith("cookie:"):
        raw = raw[7:]
    if ";" not in raw and not raw.startswith("sessionid="):
        return {"sessionid": raw}
    cookies = {}
    for part in raw.split(";"):
        name, _, value = part.strip().partition("=")
        if name and value:
            cookies[name] = value
    return cookies if "sessionid" in cookies else {"sessionid": raw}


class Instagram:
    def __init__(self, cookies):
        self.session = requests.Session()
        self.session.headers.update(HEADERS)
        for name, value in cookies.items():
            self.session.cookies.set(name, value, domain=".instagram.com")
        if cookies.get("csrftoken"):
            self.session.headers["X-CSRFToken"] = cookies["csrftoken"]

    def get(self, path, params=None, app=False):
        headers = {"User-Agent": APP_AGENT} if app else None
        response = self.session.get((APP_API if app else API) + path, params=params or {}, headers=headers, timeout=30, allow_redirects=False)
        if response.status_code in (301, 302, 401, 403):
            raise ValueError("Sessione Instagram scaduta o non valida: copia di nuovo sessionid dal browser.")
        if response.status_code == 429:
            raise ValueError("Instagram ha limitato le richieste: riprova più tardi.")
        try:
            data = response.json()
        except ValueError:
            raise ValueError(f"Risposta non valida da Instagram (HTTP {response.status_code}).")
        if data.get("status") != "ok":
            raise ValueError(data.get("message") or f"Errore Instagram (HTTP {response.status_code}).")
        return data


def media_of(item):
    """I feed dei salvati incapsulano il post in "media", quelli dei mi piace no."""
    return item.get("media", item)


def best_image(node):
    candidates = (node.get("image_versions2") or {}).get("candidates") or []
    return candidates[0]["url"] if candidates else None


def best_video(node):
    versions = node.get("video_versions") or []
    return versions[0]["url"] if versions else None


def media_urls(media):
    """URL di immagini (anche dei caroselli) e video; i video servono solo alla trascrizione."""
    nodes = media.get("carousel_media") or [media]
    images = [url for url in map(best_image, nodes) if url][:MAX_IMAGES]
    videos = [url for url in map(best_video, nodes) if url][:MAX_VIDEOS]
    return images, videos


def fetch(request):
    cookies = parse_cookie(request["cookie"])
    session_id = unquote(cookies["sessionid"])
    cookies.setdefault("ds_user_id", session_id.split(":")[0])
    client = Instagram(cookies)
    # Il nome serve solo all'intestazione: se Instagram non lo dà, la sessione la verifica il feed.
    try:
        user = client.get("accounts/edit/web_form_data/").get("form_data", {}).get("username", "")
    except ValueError:
        user = ""

    known = set(request.get("known") or [])
    limit = int(request.get("limit") or 30)
    # "both": solo i post salvati a cui hai anche messo mi piace; si scorre il feed dei salvati.
    both = bool(request.get("both"))
    sources = ["saved"] if both else request.get("sources") or list(FEEDS)
    posts, errors, by_code = [], [], {}
    for source in sources:
        params, count, pages = {}, 0, 0
        try:
            while count < limit and (not both or pages < MAX_PAGES_BOTH):
                data = client.get(FEEDS[source], params, app=source == "liked")
                pages += 1
                stop = False
                for item in data.get("items") or []:
                    media = media_of(item)
                    code = media.get("code")
                    if not code or (both and not media.get("has_liked")):
                        continue
                    if code in known:
                        stop = True  # i feed vanno dal più recente: da qui in giù è già stato letto
                        break
                    count += 1
                    if code in by_code:
                        by_code[code]["sources"].append(source)
                        continue
                    images, videos = media_urls(media)
                    post = {
                        "id": code,
                        "url": f"https://www.instagram.com/p/{code}/",
                        "author": (media.get("user") or {}).get("username", ""),
                        "caption": ((media.get("caption") or {}).get("text") or "").strip(),
                        "takenAt": media.get("taken_at"),
                        "sources": ["saved", "liked"] if both else [source],
                        "images": images,
                        "videos": videos,
                    }
                    by_code[code] = post
                    posts.append(post)
                    if count >= limit:
                        break
                if stop or not data.get("more_available") or not data.get("next_max_id"):
                    break
                params = {"max_id": data["next_max_id"]}
                time.sleep(2)  # ritmo umano tra le pagine: evita il blocco temporaneo dell'account
        except Exception as error:
            errors.append(f"{'Salvati' if source == 'saved' else 'Mi piace'}: {error}")
    return {"user": user, "posts": posts, "errors": errors}


def main():
    try:
        result = fetch(json.loads(sys.stdin.buffer.read().decode("utf-8-sig")))
    except Exception as error:
        result = {"error": str(error)}
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
