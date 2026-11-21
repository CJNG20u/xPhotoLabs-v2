import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

dotenv.config();

function resolveDefaultDataDir(): string {
  if (process.env.DATA_DIR && process.env.DATA_DIR.trim() !== '') {
    return path.resolve(process.env.DATA_DIR.trim());
  }
  const debianDefault = '/var/lib/xphotolabs';
  try {
    if (fs.existsSync(debianDefault)) {
      fs.accessSync(debianDefault, fs.constants.W_OK);
      return debianDefault;
    }
  } catch {
    // Fall back to workspace-local NVMe/disk directory in non-root dev environments
  }
  return path.resolve(process.cwd(), 'data', 'xphotolabs');
}

export interface ExternalMountConfig {
  name: string;
  path: string;
}

function parseExternalMountsEnv(raw: string | undefined): ExternalMountConfig[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const eqIdx = entry.indexOf('=');
      if (eqIdx > 0) {
        const name = entry.slice(0, eqIdx).trim();
        const mountPath = path.resolve(entry.slice(eqIdx + 1).trim());
        return { name: name || path.basename(mountPath), path: mountPath };
      }
      const mountPath = path.resolve(entry);
      return { name: path.basename(mountPath) || 'NAS Mount', path: mountPath };
    });
}

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
  isProd: process.env.NODE_ENV === 'production',
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
  seedDemoMedia: process.env.SEED_DEMO_MEDIA !== 'false',
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
