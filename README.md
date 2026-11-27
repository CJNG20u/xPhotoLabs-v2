<h1 align="center">xPhotoLabs</h1>

<p align="center">
  <img src="docs/logo.svg" width="128" alt="xPhotoLabs logo">
</p>

<p align="center"><b>Your photos, browsed fast, still on your own storage.</b></p>

<p align="center"><a href="#quick-start-docker">Install</a> · <a href="#features">Features</a> · <a href="#mounting-an-existing-nas-library">NAS library</a> · <a href="#automated-mobile-sync-apisync">Phone sync</a></p>

xPhotoLabs is a photo and video gallery for your own server. It watches the folders you already have, makes quick thumbnails, and gives you a smooth timeline, albums, a map and share links. Your originals stay exactly where they are.


[![Docker image](https://github.com/CJNG20u/xPhotoLabs-v2/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/CJNG20u/xPhotoLabs-v2/pkgs/container/xphotolabs-v2)

🐳 **Docker image:** `ghcr.io/cjng20u/xphotolabs-v2:latest` (amd64 + arm64)

```bash
docker pull ghcr.io/cjng20u/xphotolabs-v2:latest
```

<img width="1151" height="1164" alt="image" src="https://github.com/user-attachments/assets/906a1dab-cd80-427e-84fd-93728409fe91" />

A fast, minimalist, self-hosted photo and video gallery PWA built with Node.js, Fastify, SQLite (WAL), and React. Keeps metadata and `400px` / `1600px` WebP thumbnails on local storage while watching existing NAS libraries in real time.

## Features

- **Virtualized Timeline & Lightbox**: Date-grouped grid with draggable date scrubber, responsive column density (`2`/`3` mobile, `4`/`5`/`7` desktop), Light/Dark themes, 1×–4× zoom/pan, EXIF/GPS inspector, and HTTP Range video streaming.
- **Organization & Sharing**: Multi-select bulk actions, virtual albums, Favorites, Places map, Trash with permanent disk deletion, and optional password-protected/expiring public share links (`/s/<token>`).
- **Live NAS Watching & Deduplication**: Real-time folder watching via `chokidar`, SHA-256 deduplication with deleted-hash sync ignore tracking, browser folder auto-sync, Bearer-token `/api/sync` automation, and installable PWA offline thumbnail caching.

## Quick Start (Docker)

### 1. Clone the repo

```bash
git clone https://github.com/CJNG20u/xPhotoLabs-v2.git
cd xPhotoLabs-v2
```

### 2. Configure `.env`

```bash
cp .env.example .env
```

Edit `.env` to set an optional `SYNC_API_TOKEN` or external mounts if needed (`SEED_DEMO_MEDIA=false` by default so your gallery starts clean).

### 3. Configure `docker-compose.yml`

`docker-compose.yml` builds locally from source and persists your SQLite database, WebP thumbnails, and uploads in `./data`:

```yaml
services:
  xphotolabs:
    build: .
    container_name: xphotolabs
    restart: unless-stopped
    ports:
      - "3000:3000"
    env_file:
      - .env
    volumes:
      - ./data:/data
      # Optional: mount an existing photo library (append :ro for read-only)
      # - /path/to/your/photos:/photos
    # Optional: match host UID:GID for NAS folder permissions
    # user: "1000:1000"
```

### 4. Build and run

```bash
docker compose up -d --build
```

Open `http://localhost:3000` in your browser.

### Prefer not to build? Use the prebuilt image

Every push to `main` publishes a ready-made image to GitHub Container Registry, so you can skip cloning and building entirely. Create a folder with this `docker-compose.yml` (and optionally a `.env` from [.env.example](.env.example)):

```yaml
services:
  xphotolabs:
    image: ghcr.io/cjng20u/xphotolabs-v2:latest
    container_name: xphotolabs
    restart: unless-stopped
    ports:
      - "3000:3000"
    env_file:
      - path: .env
        required: false
    volumes:
      - ./data:/data
      # - /path/to/your/photos:/photos
```

```bash
docker compose pull && docker compose up -d
```

Images are built automatically for `linux/amd64` and `linux/arm64`. `:latest` follows `main`; each release also gets version tags (e.g. `:2.0.0`, `:2`) so you can pin a version. The repo's own `docker-compose.yml` also pulls this image first and only builds from source when you pass `--build`.

---

## Mounting an Existing NAS Library

1. Uncomment the photo volume in `docker-compose.yml` and point it to your host/NAS path:
   - Use `- /path/to/your/photos:/photos:ro` for **read-only** indexing (xPhotoLabs will never modify or delete source files).
   - Use `- /path/to/your/photos:/photos` for **read-write** access if you want permanent deletion from Trash to delete files on disk, or to store uploads on your NAS.
2. Point `EXTERNAL_MOUNTS` (and optionally `UPLOAD_DIR`) in `.env` to `/photos`:

```env
EXTERNAL_MOUNTS="Photos:/photos"
# Optional: save new browser & mobile sync uploads directly to your NAS mount
UPLOAD_DIR=/photos/uploads
```

> `EXTERNAL_MOUNTS` also supports comma-separated `Name:/path` pairs or a JSON array like `[{"name":"Photos","path":"/photos"}]`.

---

## Automated Mobile Sync (`/api/sync`)

Set `SYNC_API_TOKEN` in `.env` (generate with `openssl rand -hex 32`) or create a per-device token in **Storage Mounts**. Send photos or videos from Tasker, Apple Shortcuts, or scripts:

```bash
curl -X POST https://photos.example.com/api/sync \
  -H "Authorization: Bearer YOUR_SYNC_API_TOKEN" \
  -F "file=@/path/to/IMG_1024.JPG"
```

Duplicates and previously permanently deleted files are skipped automatically by SHA-256 hash.

---

## HTTPS Reverse Proxy

Browsers require HTTPS (a secure context) for Web Crypto (`crypto.subtle`) SHA-256 browser folder sync, the File System Access API, and PWA Service Workers. Put Caddy or Nginx in front of port `3000`:

**Caddy**

```caddy
photos.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

**Nginx**

```nginx
server {
    listen 443 ssl http2;
    server_name photos.example.com;

    client_max_body_size 2G;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_request_buffering off;
    }
}
```

> **Security**: xPhotoLabs has no built-in user login. If exposing outside your LAN, place it behind a VPN (Tailscale/WireGuard) or reverse-proxy auth (Authelia/Authentik/Cloudflare Access).
