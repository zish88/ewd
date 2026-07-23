# --- Stage 1: build Vite client ---
FROM node:22-bookworm AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY client ./client
COPY vite.config.ts tsconfig.json ./
RUN npm run build

# --- Stage 2: production runtime ---
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/app/data/wiring.sqlite
ENV EWD_DATA_DIR=/app/data/ewd
ENV CLIENT_DIST=/app/client/dist

# Устанавливаем Python, pip, build-инструменты и pdfplumber
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip make g++ \
  && pip3 install --no-cache-dir pdfplumber --break-system-packages \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY scripts ./scripts
COPY --from=build /app/client/dist ./client/dist

# Placeholders; real data comes from volumes
RUN mkdir -p /app/data/ewd

EXPOSE 3000

CMD ["npx", "tsx", "server/index.ts"]