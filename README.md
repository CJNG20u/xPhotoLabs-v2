# xPhotoLabs

A fast, minimalist, self-hosted photo and video gallery Progressive Web App (PWA) designed for Docker and NAS home servers. xPhotoLabs keeps its SQLite WAL metadata index and `400px` / `1600px` WebP thumbnail cache on fast local storage while indexing and watching your existing photo libraries in real time.

---

## Features

- **Virtualized Timeline & Views**: Smoothly scroll large libraries with date-grouped sections (`@tanstack/react-virtual`), a right-side draggable date scrubber, Light/Dark themes, media-type filters (`All`, `Photos`, `Videos`), and dedicated **Photos**, **Favorites**, **Albums**, **Places**, **Trash**, and **Storage Mounts** views.
- **Responsive Grid Density**: Switch column density on the fly (`2` or `3` columns on mobile; `4`, `5`, or `7` columns on desktop) with preferences saved per viewport.
- **Multi-Select Bulk Actions**: Enter selection mode to select individual items or toggle **Select All**, with a floating bulk toolbar for **Favorite / Unfavorite**, **Add to Album**, **Move to Trash**, **Restore**, and **Permanent Delete**.
- **Full-Screen Lightbox & EXIF Inspector**: Interactive 1×–4× zoom/pan, keyboard navigation (`←`/`→`, `I`, `F`, `+`/`-`/`0`, `Esc`), HTTP Range video streaming (`206 Partial Content`), and a slide-out info panel displaying camera/lens EXIF metadata, GPS coordinates, storage source, and SHA-256 checksum.
- **Virtual Albums, Memories & Places**: Organize photos into non-destructive virtual albums, browse auto-generated Memories cards, explore geotagged media on the **Places** coordinate map, and create public share links (`/s/<token>`) with optional `scrypt` password protection, expiration timers, and download toggles.
- **Trash & Permanent Disk Deletion**: Soft-delete items to Trash with one-click restore, or permanently delete selected items / empty Trash with explicit confirmation that removes the original file (when writable), generated thumbnails, and database record.
- **SHA-256 Deduplication & Deleted-Hash Sync Ignore Tracking**: Every ingested file is fingerprinted with SHA-256 to prevent duplicates across uploads and mounts. Permanently deleted hashes are recorded in SQLite (`deleted_hashes`) so automated phone syncs skip them instead of re-uploading deleted photos, while manual browser re-uploads remain allowed.
- **Live NAS Folder Watching (`chokidar`)**: Index existing photo and video folders without moving or renaming files, automatically ingesting new files and pruning removed ones in real time.
- **Fast WebP Thumbnail Pipeline**: Generates `400px` grid and `1600px` lightbox WebP thumbnails via `sharp`, extracts video poster frames and duration metadata with `ffmpeg`/`ffprobe`, and parses EXIF/GPS metadata with `exifr`.
- **Automated Sync API (`/api/sync`) & Browser Folder Auto-Sync**: Authenticate automated mobile backup workflows (Tasker, Apple Shortcuts, CLI scripts) with Bearer tokens (`SYNC_API_TOKEN` or revocable per-device tokens in the UI), or link a local folder directly in the browser via the File System Access API + IndexedDB + Web Crypto (`crypto.subtle`).
- **Installable PWA**: Offline `400px` thumbnail caching via Workbox and OS-level **Web Share Target** (`/share-target`) support.

---

## Quick Start with Docker Compose

Create a directory for your xPhotoLabs deployment and save the following `docker-compose.yml`:

```yaml
services:
  xphotolabs:
    image: ghcr.io/cjng20u/xphotolabs:latest
    # Uncomment to build locally from source instead of pulling the prebuilt image:
    # build: .
    container_name: xphotolabs
    restart: unless-stopped
    ports:
      - "${PORT:-3000}:3000"
    environment:
      NODE_ENV: production
      PORT: 3000
      HOST: 0.0.0.0
      APP_URL: ${APP_URL:-http://localhost:3000}
      DATA_DIR: /data
      UPLOAD_DIR: ${UPLOAD_DIR:-/data/uploads}
      EXTERNAL_MOUNTS: ${EXTERNAL_MOUNTS:-}
      SYNC_API_TOKEN: ${SYNC_API_TOKEN:-}
      SEED_DEMO_MEDIA: ${SEED_DEMO_MEDIA:-false}
    volumes:
      # Persistent SQLite WAL database, WebP thumbnail cache, and default uploads
      - ./data:/data

      # Optional: mount an existing host/NAS photo library (see section below)
      # - /path/to/your/photos:/photos:ro
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://127.0.0.1:3000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s
```

Start the container:

```bash
docker compose up -d
```

Open `http://localhost:3000` in your browser. By default, `SEED_DEMO_MEDIA` is `false` in production so your gallery starts clean.

---

## Mounting Existing NAS Libraries

xPhotoLabs lets you keep your SQLite index and WebP thumbnails on fast local SSD/NVMe storage (`./data:/data`) while indexing your existing NAS or host photo archive at `/photos`.

### 1. Bind-Mount Your Photo Folder

Add your host or NAS path under `volumes` in `docker-compose.yml`:

```yaml
volumes:
  - ./data:/data
  # Read-only mount:
  - /path/to/your/photos:/photos:ro
  # Or read-write mount:
  # - /path/to/your/photos:/photos
```

### 2. Configure `EXTERNAL_MOUNTS` and `UPLOAD_DIR`

You can register `/photos` in the web UI under **Storage Mounts**, or pre-configure it in `.env` so xPhotoLabs indexes and watches it automatically on startup:

```env
# Comma-separated Name:/path (also supports Name=/path or plain /path)
EXTERNAL_MOUNTS="Family Photos:/photos"

# Or JSON array format for multiple mounts:
# EXTERNAL_MOUNTS='[{"name":"Family Photos","path":"/photos"},{"name":"Archive","path":"/photos/archive"}]'
```

If you want new browser uploads and `/api/sync` mobile backups written directly into your mounted NAS directory instead of `/data/uploads`, mount `/photos` **read-write** and set `UPLOAD_DIR`:

```env
UPLOAD_DIR=/photos/uploads
```

### Read-Only (`:ro`) vs. Read-Write Mount Behavior

| Mount Mode | Indexing & Live Watching | Unmounting in UI | Permanent Delete from Trash | Using as `UPLOAD_DIR` |
| --- | --- | --- | --- | --- |
| **Read-Only (`:ro`)** | Full support (`chokidar` watches adds/removes) | Removes index & thumbnails only; originals untouched | Removes DB row & thumbnails; original file on disk is protected by OS read-only mount | Not supported |
| **Read-Write (default)** | Full support (`chokidar` watches adds/removes) | Removes index & thumbnails only; originals untouched | Deletes the original file from disk, along with DB row & thumbnails | Supported (e.g., `UPLOAD_DIR=/photos/uploads`) |

> **Permissions Tip**: If your NAS directory is owned by a specific host UID/GID (for example `1000:1000`), uncomment `user: "1000:1000"` in `docker-compose.yml` and run `chown -R 1000:1000 ./data` before starting.

---

## Environment Variables Reference

All server configuration is resolved in `server/config.ts`:

| Variable | Default | Type / Format | Description |
| --- | --- | --- | --- |
| `PORT` | `3000` | Integer | TCP port the Fastify server listens on. |
| `HOST` | `0.0.0.0` | String (IP/host) | Network interface to bind to. |
| `NODE_ENV` | `production` *(Docker)* | `production` \| `development` | Controls production static serving (`dist/`) vs. Vite dev middleware and default `SEED_DEMO_MEDIA` behavior. |
| `APP_URL` | `http://localhost:3000` | URL string | Public base URL where your xPhotoLabs instance is accessible. |
| `DATA_DIR` | `/data` *(if writable, else `./data`)* | Absolute path | Persistent storage root for `xphotolabs.db` (SQLite WAL), `thumbs/400`, `thumbs/1600`, `tmp`, and default `uploads`. |
| `UPLOAD_DIR` | `${DATA_DIR}/uploads` (`/data/uploads`) | Absolute path | Destination directory for browser uploads, Web Share Target files, and `/api/sync` / `/api/upload` originals. |
| `EXTERNAL_MOUNTS` | *(empty)* | `Name:/path`, `Name=/path`, `/path` (CSV), or JSON array | Optional directories automatically registered and watched via `chokidar` at startup. Example: `Photos:/photos` or `[{"name":"Photos","path":"/photos"}]`. |
| `SYNC_API_TOKEN` | *(empty)* | String (secret) | Optional static Bearer token for authenticating `/api/sync`, `/api/sync/check`, and `/api/upload`. Generate with `openssl rand -hex 32`. Per-device tokens can also be created in the UI. |
| `SEED_DEMO_MEDIA` | `false` *(in production)* | Boolean (`true`/`false`) | When `true` on an empty database, seeds built-in sample photos and albums. Defaults to `false` when `NODE_ENV=production`. |

---

## Automated Mobile Sync (`/api/sync`) & Reverse Proxy

### Mobile & CLI Sync (`POST /api/sync`)

Set `SYNC_API_TOKEN` in `.env` (generate with `openssl rand -hex 32`) or generate a revocable per-device token in **Storage Mounts → Mobile & Automated Sync API**.

Upload a photo or video directly from **Tasker**, **Apple Shortcuts**, or a shell script using a Bearer token:

```bash
curl -X POST https://photos.example.com/api/sync \
  -H "Authorization: Bearer YOUR_SYNC_API_TOKEN" \
  -F "file=@/path/to/IMG_1024.JPG"
```

- Multiple files can be sent in a single multipart request (`-F "file=@a.jpg" -F "file=@b.mp4"`).
- Duplicates (already in your library) and previously deleted hashes (`deleted_hashes`) are automatically detected by SHA-256 and skipped without re-importing.
- For bandwidth-saving two-step sync clients, pre-check SHA-256 hashes before uploading:

```bash
# 1. Check which hashes are missing (skips existing & permanently deleted hashes)
curl -X POST https://photos.example.com/api/sync/check \
  -H "Authorization: Bearer YOUR_SYNC_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[{"sha256":"<64-char-hex-sha256>","filename":"IMG_1024.JPG","size":4201930}]'

# 2. Upload only missing files
curl -X POST https://photos.example.com/api/sync \
  -H "Authorization: Bearer YOUR_SYNC_API_TOKEN" \
  -F "file=@/path/to/IMG_1024.JPG"
```

### HTTPS Reverse Proxy Examples

> **Why HTTPS is Required**: Modern browsers only expose the Web Crypto API (`crypto.subtle.digest` used to compute SHA-256 hashes client-side), the File System Access API (`window.showDirectoryPicker` for Browser Folder Auto-Sync), and PWA Service Workers inside a **secure context** (`https://` or `http://localhost`). Always serve xPhotoLabs over HTTPS when accessing it over your LAN or the internet.

#### Caddy (Automatic TLS)

```caddy
photos.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

#### Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name photos.example.com;

    # Match xPhotoLabs's 2 GiB per-file multipart upload limit for videos
    client_max_body_size 2G;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_request_buffering off;
    }
}
```

> **Security Note**: xPhotoLabs is a single-tenant private gallery without built-in user login. When exposing it outside your home network, place it behind a VPN (such as Tailscale or WireGuard) or reverse-proxy authentication (such as Authelia, Authentik, or Cloudflare Access). Keep `/api/sync` protected with a strong `SYNC_API_TOKEN` and mount archival NAS folders as `:ro` unless you intend to delete files on disk from Trash.

---

## Building from Source & Tech Stack

### Local Docker Build

```bash
git clone https://github.com/CJNG20u/xphotolabs.git
cd xphotolabs
cp .env.example .env

# Build the multi-stage Docker image locally
docker build -t xphotolabs:local .

# Or uncomment `build: .` in docker-compose.yml and run:
docker compose up -d --build
```

### Local Development (Without Docker)

Requires **Node.js 22+** and **`ffmpeg`**:

```bash
npm install
npm run dev
```

The server runs on `http://localhost:3000` with Vite middleware and stores local data in `./data`.

### Tech Stack

| Layer | Technologies |
| --- | --- |
| **Runtime & Server** | Node.js 22 (native TypeScript execution), Fastify 5 (`@fastify/multipart`, `@fastify/static`) |
| **Database** | SQLite in WAL mode via `better-sqlite3` |
| **Media Pipeline** | `sharp` (400px/1600px WebP thumbnails & dominant color), `fluent-ffmpeg` + `ffmpeg` (video probing & poster frames), `exifr` (EXIF/GPS parsing), `chokidar` (real-time NAS watching) |
| **Frontend & PWA** | React 19, TypeScript, Vite 8, Tailwind CSS 4, `@tanstack/react-virtual`, `lucide-react`, `vite-plugin-pwa` (Workbox) |
| **Container** | Multi-stage `node:22-bookworm-slim` image with `ffmpeg`, `curl` healthcheck (`/api/health`), and `/data` + `/photos` volumes |
