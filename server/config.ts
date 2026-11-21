import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

dotenv.config();

function resolveDefaultDataDir(): string {
  if (process.env.DATA_DIR && process.env.DATA_DIR.trim() !== '') {
    return path.resolve(process.env.DATA_DIR.trim());
  }
  const containerDefault = '/data';
  try {
    if (fs.existsSync(containerDefault)) {
      fs.accessSync(containerDefault, fs.constants.W_OK);
      return containerDefault;
    }
  } catch {
    // Fall back to workspace-local directory when /data is unavailable or not writable
  }
  return path.resolve(process.cwd(), 'data');
}

export interface ExternalMountConfig {
  name: string;
  path: string;
}

function parseExternalMountsEnv(raw: string | undefined): ExternalMountConfig[] {
  if (!raw || !raw.trim()) return [];
  const trimmed = raw.trim();

  // Support JSON array: [{"name":"Photos","path":"/photos"}] or ["/photos"]
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!Array.isArray(parsed)) return [];
      const results: ExternalMountConfig[] = [];
      for (const item of parsed) {
        if (typeof item === 'string' && item.trim()) {
          const mountPath = path.resolve(item.trim());
          results.push({ name: path.basename(mountPath) || 'External Mount', path: mountPath });
        } else if (item && typeof item === 'object' && typeof (item as { path?: unknown }).path === 'string') {
          const rawPath = (item as { path: string }).path.trim();
          if (!rawPath) continue;
          const mountPath = path.resolve(rawPath);
          const rawName = typeof (item as { name?: unknown }).name === 'string' ? (item as { name: string }).name.trim() : '';
          results.push({ name: rawName || path.basename(mountPath) || 'External Mount', path: mountPath });
        }
      }
      return results;
    } catch (err) {
      console.warn('Invalid JSON in EXTERNAL_MOUNTS environment variable:', err);
      return [];
    }
  }

  // Support comma-separated Name:/path, Name=/path, or plain /path entries
  return trimmed
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      if (!entry.startsWith('/')) {
        const colonIdx = entry.indexOf(':');
        const eqIdx = entry.indexOf('=');
        let sepIdx = -1;
        if (colonIdx > 0 && eqIdx > 0) sepIdx = Math.min(colonIdx, eqIdx);
        else if (colonIdx > 0) sepIdx = colonIdx;
        else if (eqIdx > 0) sepIdx = eqIdx;

        if (sepIdx > 0) {
          const name = entry.slice(0, sepIdx).trim();
          const rawPath = entry.slice(sepIdx + 1).trim();
          if (rawPath) {
            const mountPath = path.resolve(rawPath);
            return { name: name || path.basename(mountPath) || 'External Mount', path: mountPath };
          }
        }
      }
      const mountPath = path.resolve(entry);
      return { name: path.basename(mountPath) || 'External Mount', path: mountPath };
    });
}

function resolveSeedDemoMedia(isProd: boolean): boolean {
  const raw = process.env.SEED_DEMO_MEDIA?.trim().toLowerCase();
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  // Default to false in production so new self-hosters start with a clean gallery
  return !isProd;
}

const isProd = process.env.NODE_ENV === 'production';
const DATA_DIR = resolveDefaultDataDir();
const UPLOAD_DIR =
  process.env.UPLOAD_DIR && process.env.UPLOAD_DIR.trim() !== ''
    ? path.resolve(process.env.UPLOAD_DIR.trim())
    : path.join(DATA_DIR, 'uploads');

const THUMBS_DIR = path.join(DATA_DIR, 'thumbs');
const THUMBS_400_DIR = path.join(THUMBS_DIR, '400');
const THUMBS_1600_DIR = path.join(THUMBS_DIR, '1600');
const TMP_DIR = path.join(DATA_DIR, 'tmp');
const DB_PATH = path.join(DATA_DIR, 'xphotolabs.db');

export const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  isProd,
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  dataDir: DATA_DIR,
  uploadDir: UPLOAD_DIR,
  thumbsDir: THUMBS_DIR,
  thumbs400Dir: THUMBS_400_DIR,
  thumbs1600Dir: THUMBS_1600_DIR,
  tmpDir: TMP_DIR,
  dbPath: DB_PATH,
  envExternalMounts: parseExternalMountsEnv(process.env.EXTERNAL_MOUNTS),
  envSyncApiToken: (process.env.SYNC_API_TOKEN || '').trim(),
  seedDemoMedia: resolveSeedDemoMedia(isProd),
};

export function ensureStorageDirectories(): void {
  for (const dir of [
    config.dataDir,
    config.uploadDir,
    config.thumbsDir,
    config.thumbs400Dir,
    config.thumbs1600Dir,
    config.tmpDir,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
