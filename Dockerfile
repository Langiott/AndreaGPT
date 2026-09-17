FROM node:22-alpine AS build
WORKDIR /app
# CA dell'antivirus locale (scansione SSL/TLS): senza, npm e fetch falliscono
# con UNABLE_TO_VERIFY_LEAF_SIGNATURE dentro il container.
COPY certs/norton-shield-root.pem ./certs/norton-shield-root.pem
ENV NODE_EXTRA_CA_CERTS=/app/certs/norton-shield-root.pem npm_config_cafile=/app/certs/norton-shield-root.pem
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NODE_EXTRA_CA_CERTS=/app/certs/norton-shield-root.pem npm_config_cafile=/app/certs/norton-shield-root.pem
COPY certs/norton-shield-root.pem ./certs/norton-shield-root.pem
# docTR è il motore OCR principale; Tesseract resta disponibile solo come fallback.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && mkdir -p /usr/local/share/ca-certificates \
 && cp ./certs/norton-shield-root.pem /usr/local/share/ca-certificates/norton-shield-root.crt \
 && update-ca-certificates \
 && apt-get install -y --no-install-recommends python3 python3-venv tesseract-ocr tesseract-ocr-ita poppler-utils libgl1 \
 && python3 -m venv /opt/doctr \
 && PIP_CERT=/app/certs/norton-shield-root.pem /opt/doctr/bin/pip install --no-cache-dir --no-deps torch torchvision --index-url https://download.pytorch.org/whl/cpu \
 && PIP_CERT=/app/certs/norton-shield-root.pem /opt/doctr/bin/pip install --no-cache-dir filelock typing-extensions sympy networkx jinja2 fsspec setuptools \
 && PIP_CERT=/app/certs/norton-shield-root.pem /opt/doctr/bin/pip install --no-cache-dir python-doctr --no-deps \
 && PIP_CERT=/app/certs/norton-shield-root.pem /opt/doctr/bin/pip install --no-cache-dir anyascii h5py huggingface-hub langdetect numpy onnx opencv-python-headless Pillow pyclipper pypdfium2 rapidfuzz scipy shapely tqdm validators \
 && PIP_CERT=/app/certs/norton-shield-root.pem /opt/doctr/bin/pip install --no-cache-dir ultralytics \
 && rm -rf /var/lib/apt/lists/*
ENV DOCTR_PYTHON=/opt/doctr/bin/python
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/src/brainUploadLimits.ts ./src/brainUploadLimits.ts
COPY --from=build /app/certs ./certs
EXPOSE 3000
RUN mkdir -p /app/data/brain /app/OCR/input /app/OCR/output && chown -R node:node /app/data /app/OCR
USER node
CMD ["npm", "run", "start:prod"]
