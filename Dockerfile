# =============================================================================
# Stage 1: Install dependencies, build Vite frontend, and prune dev packages
# =============================================================================
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Build tools for native Node addons (e.g., better-sqlite3 fallback compilation)
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./

RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY index.html vite.config.ts tsconfig.json ./
COPY public ./public
COPY src ./src
COPY server.ts ./
COPY server ./server

RUN npm run build \
  && npm prune --omit=dev

# =============================================================================
# Stage 2: Lean production runtime with ffmpeg and curl healthcheck
# =============================================================================
FROM node:22-bookworm-slim AS runtime

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/server ./server

# Create default persistent data and external media library mount points
RUN mkdir -p /data/uploads /photos

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    APP_URL=http://localhost:3000 \
    DATA_DIR=/data \
    UPLOAD_DIR=/data/uploads \
    EXTERNAL_MOUNTS= \
    SYNC_API_TOKEN= \
    SEED_DEMO_MEDIA=false

VOLUME ["/data", "/photos"]

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.ts"]
