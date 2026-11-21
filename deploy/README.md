# Bare-Metal Linux Deployment (Optional Systemd Guide)

For most self-hosters, **Docker Compose** (documented in the root [README.md](../README.md)) is the fastest and easiest way to run xPhotoLabs. If you prefer running directly on Linux without Docker, follow this systemd guide.

## 1. System Prerequisites

Install Node.js 22 LTS (native TypeScript execution), `ffmpeg`, and build tools:

```bash
sudo apt update
sudo apt install -y ffmpeg build-essential python3 curl git

# Install Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

## 2. Create Service User & Directories

```bash
sudo useradd --system --home /srv/xphotolabs --shell /usr/sbin/nologin xphotolabs
sudo mkdir -p /srv/xphotolabs /data/uploads /data/thumbs
sudo chown -R xphotolabs:xphotolabs /srv/xphotolabs /data
```

## 3. Install & Build

```bash
cd /srv/xphotolabs
sudo -u xphotolabs npm install
sudo -u xphotolabs npm run build
```

## 4. Configure Environment

```bash
sudo -u xphotolabs cp /srv/xphotolabs/.env.example /srv/xphotolabs/.env
sudo -u xphotolabs nano /srv/xphotolabs/.env
```

Adjust `DATA_DIR`, `UPLOAD_DIR`, `EXTERNAL_MOUNTS`, and `SYNC_API_TOKEN` (generate with `openssl rand -hex 32`) as needed.

## 5. Enable Systemd Service

```bash
sudo cp /srv/xphotolabs/deploy/xphotolabs.service /etc/systemd/system/xphotolabs.service
sudo systemctl daemon-reload
sudo systemctl enable --now xphotolabs
sudo systemctl status xphotolabs
```

See the root [README.md](../README.md) for reverse proxy examples (Caddy, Nginx, Traefik) and security recommendations.
