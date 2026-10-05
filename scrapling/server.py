"""Estrattore testo pagine web: Scrapling scarica (impersonando Chrome), trafilatura pulisce.

POST /extract {"urls": [...], "max_chars": 1500} -> [{"url", "ok", "title", "date", "text"}]
"""
import json
import os
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import trafilatura
from scrapling.fetchers import Fetcher

TIMEOUT = int(os.environ.get("FETCH_TIMEOUT", "10"))
MAX_URLS = 8


def extract(url: str, max_chars: int) -> dict:
    try:
        page = Fetcher.get(url, timeout=TIMEOUT, stealthy_headers=True, follow_redirects=True)
        if page.status >= 400:
            return {"url": url, "ok": False, "error": f"HTTP {page.status}"}
        html = page.html_content
        text = trafilatura.extract(html, url=url, include_comments=False, include_tables=False, favor_precision=True) or ""
        meta = trafilatura.extract_metadata(html, default_url=url)
        text = " ".join(text.split())[:max_chars]
        if len(text) < 200:
            return {"url": url, "ok": False, "error": "testo insufficiente"}
        return {"url": url, "ok": True, "title": meta.title if meta else None, "date": meta.date if meta else None, "text": text}
    except Exception as error:  # una pagina rotta non deve far fallire le altre
        return {"url": url, "ok": False, "error": str(error)[:200]}


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, payload) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._send(200, {"ok": True}) if self.path == "/health" else self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/extract":
            return self._send(404, {"error": "not found"})
        try:
            data = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            urls = [u for u in data.get("urls", []) if isinstance(u, str) and u.startswith(("http://", "https://"))][:MAX_URLS]
            max_chars = max(200, min(int(data.get("max_chars", 1500)), 8000))
        except (ValueError, TypeError):
            return self._send(400, {"error": "richiesta non valida"})
        with ThreadPoolExecutor(max_workers=len(urls) or 1) as pool:
            self._send(200, list(pool.map(lambda u: extract(u, max_chars), urls)))

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8090), Handler).serve_forever()
