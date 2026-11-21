# Deploying xPhotoLabs on Bare-Metal Debian Linux

xPhotoLabs is designed to run directly on Debian 12+ (Bookworm/Trixie) without Docker, storing the SQLite WAL database and generated WebP thumbnails (`400px` & `1600px`) on local NVMe storage (`/var/lib/xphotolabs`) while indexing existing NAS media directories non-destructively.

## 1. System Prerequisites

```bash
sudo apt update
sudo apt install -y ffmpeg build-essential python3 curl git
```

Install Node.js 22 LTS (native TypeScript execution support):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

## 2. Create Service User & Directories

```bash
sudo useradd --system --home /opt/xphotolabs --shell /usr/sbin/nologin xphotolabs
sudo mkdir -p /opt/xphotolabs /var/lib/xphotolabs/uploads /var/lib/xphotolabs/thumbs
sudo chown -R xphotolabs:xphotolabs /opt/xphotolabs /var/lib/xphotolabs
```

## 3. Install & Build

```bash
# Copy application files to /opt/xphotolabs
cd /opt/xphotolabs
sudo -u xphotolabs npm ci
sudo -u xphotolabs npm run build
```

## 4. Configure Environment

```bash
sudo -u xphotolabs cp /opt/xphotolabs/.env.example /opt/xphotolabs/.env
sudo -u xphotolabs nano /opt/xphotolabs/.env
```

Set `SYNC_API_TOKEN` using `openssl rand -hex 32`, verify `DATA_DIR=/var/lib/xphotolabs`, and optionally list read-only NAS folders in `EXTERNAL_MOUNTS`.

## 5. Enable Systemd Unit

```bash
sudo cp /opt/xphotolabs/deploy/xphotolabs.service /etc/systemd/system/xphotolabs.service
sudo systemctl daemon-reload
sudo systemctl enable --now xphotolabs
sudo systemctl status xphotolabs
```

## 6. HTTPS Reverse Proxy (Recommended for PWA & Folder Auto-Sync)

Both Service Workers (`manifest.webmanifest` + `share_target`) and the File System Access API (`window.showDirectoryPicker`) require a secure context (`https://` or `http://localhost`). Place Caddy or Nginx in front of `127.0.0.1:3000`:

```caddy
photos.yourdomain.com {
    reverse_proxy 127.0.0.1:3000
}
```
