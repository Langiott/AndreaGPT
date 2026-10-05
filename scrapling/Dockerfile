FROM python:3.12-slim
WORKDIR /app
# Solo il fetcher HTTP (curl_cffi): niente browser stealth, immagine leggera.
RUN pip install --no-cache-dir "scrapling[fetchers]" trafilatura
COPY server.py .
EXPOSE 8090
CMD ["python", "-u", "server.py"]
