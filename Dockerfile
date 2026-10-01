FROM node:22-alpine AS build
WORKDIR /app
# CA dell'antivirus locale (scansione SSL/TLS): senza, npm e fetch falliscono
# con UNABLE_TO_VERIFY_LEAF_SIGNATURE dentro il container.
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# docTR è il motore OCR principale; Tesseract resta disponibile solo come fallback.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && apt-get install -y --no-install-recommends git python3 python3-venv tesseract-ocr tesseract-ocr-ita poppler-utils libgl1 ffmpeg pandoc libreoffice-writer \
 && python3 -m venv /opt/doctr \
 && /opt/doctr/bin/pip install --no-cache-dir --no-deps torch torchvision --index-url https://download.pytorch.org/whl/cpu \
 && /opt/doctr/bin/pip install --no-cache-dir filelock typing-extensions sympy networkx jinja2 fsspec setuptools \
 && /opt/doctr/bin/pip install --no-cache-dir python-doctr --no-deps \
 && /opt/doctr/bin/pip install --no-cache-dir anyascii h5py huggingface-hub langdetect numpy onnx opencv-python-headless Pillow pyclipper pypdfium2 rapidfuzz scipy shapely tqdm validators \
 && /opt/doctr/bin/pip install --no-cache-dir ultralytics \
 && /opt/doctr/bin/pip install --no-cache-dir faster-whisper pdf2docx turbovec \
 && /opt/doctr/bin/pip install --no-cache-dir "transformers>=4.57.0" accelerate Pillow qwen-vl-utils==0.0.14 git+https://github.com/huggingface/diffusers \
 && rm -rf /var/lib/apt/lists/*
ENV DOCTR_PYTHON=/opt/doctr/bin/python
ENV WHISPER_PYTHON=/opt/doctr/bin/python
ENV TURBOVEC_PYTHON=/opt/doctr/bin/python
ENV VISION_PYTHON=/opt/doctr/bin/python
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/backend ./backend
COPY --from=build /app/frontend/config ./frontend/config
EXPOSE 3000
RUN mkdir -p /app/data/brain /app/data/tools /app/data/huggingface /app/OCR/input /app/OUTPUT/OCR /app/OUTPUT/YOLO /app/OUTPUT/Image && chown -R node:node /app/data /app/OCR /app/OUTPUT
USER node
CMD ["npm", "run", "start:prod"]
