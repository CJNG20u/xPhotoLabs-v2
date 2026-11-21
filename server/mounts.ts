import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import chokidar from 'chokidar';
import type { FSWatcher } from 'chokidar';
import { config } from './config.ts';
import { db } from './db.ts';
import type { MountRow } from './db.ts';
import { classifyMediaExtension, ingestMediaFile, isPathBeingIngested } from './mediaPipeline.ts';
import { isPathWithin, validateExternalMountPath } from './security.ts';

const watchers = new Map<string, FSWatcher>();

function walkDirectory(rootDir: string, currentDir: string, maxDepth = 6, depth = 0, out: string[] = []): string[] {
  if (depth > maxDepth) return out;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(currentDir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(currentDir, entry.name);
    if (!isPathWithin(fullPath, rootDir)) continue;
    if (entry.isDirectory()) {
      walkDirectory(rootDir, fullPath, maxDepth, depth + 1, out);
    } else if (entry.isFile()) {
      if (classifyMediaExtension(entry.name)) {
        out.push(fullPath);
      }
    }
  }
  return out;
}

export interface ScanSummary {
  mountId: string;
  scanned: number;
  added: number;
  skipped: number;
  errors: number;
}

const findByPathStmt = db.prepare('SELECT id, source_type FROM media WHERE file_path = ?');
const updateMountStatsStmt = db.prepare(
  'UPDATE mounts SET file_count = (SELECT COUNT(*) FROM media WHERE mount_id = ? AND is_trashed = 0), last_scan_at = ? WHERE id = ?'
);

export async function scanMount(mountId: string): Promise<ScanSummary> {
  const mount = db.prepare('SELECT * FROM mounts WHERE id = ?').get(mountId) as MountRow | undefined;
  if (!mount) {
    throw new Error('Mount not found');
  }

  const files = walkDirectory(mount.path, mount.path);
  let added = 0;
  let skipped = 0;
  let errors = 0;

  for (const rawFilePath of files) {
    const filePath = path.resolve(rawFilePath);

    // Skip files currently being ingested by an active browser upload/sync
    if (isPathBeingIngested(filePath)) {
      skipped++;
      continue;
    }

    // Match already-indexed files (including uploads inside a mounted UPLOAD_DIR) by normalized path
    const existingByPath = findByPathStmt.get(filePath);
    if (existingByPath) {
      skipped++;
      continue;
    }

    try {
      // ingestMediaFile also checks sha256 and skips cleanly without duplicating or overwriting source_type
      const result = await ingestMediaFile({
        sourcePath: filePath,
        originalFilename: path.basename(filePath),
        sourceType: 'mount',
        mountId: mount.id,
      });
      if (result.duplicate) skipped++;
      else added++;
    } catch {
      errors++;
    }
  }

  updateMountStatsStmt.run(mount.id, new Date().toISOString(), mount.id);
  return { mountId: mount.id, scanned: files.length, added, skipped, errors };
}

export function startMountWatcher(mount: MountRow): void {
  stopMountWatcher(mount.id);
  if (!mount.is_watching) return;
  if (!fs.existsSync(mount.path)) return;

  const watcher = chokidar.watch(mount.path, {
    ignoreInitial: true,
    persistent: true,
    depth: 6,
    ignored: /(^|[/\\])\../,
    awaitWriteFinish: {
      stabilityThreshold: 1200,
      pollInterval: 250,
    },
  });

  watcher.on('add', async (rawFilePath) => {
    const filePath = path.resolve(rawFilePath);
    if (!isPathWithin(filePath, mount.path)) return;
    if (!classifyMediaExtension(filePath)) return;
    if (isPathBeingIngested(filePath)) return;
    if (findByPathStmt.get(filePath)) return;

    try {
      const result = await ingestMediaFile({
        sourcePath: filePath,
        originalFilename: path.basename(filePath),
        sourceType: 'mount',
        mountId: mount.id,
      });
      if (!result.duplicate) {
        updateMountStatsStmt.run(mount.id, new Date().toISOString(), mount.id);
      }
    } catch (err) {
      console.warn(`Watcher ingest failed for ${filePath}:`, err);
    }
  });

  watcher.on('unlink', (rawFilePath) => {
    const filePath = path.resolve(rawFilePath);
    if (!isPathWithin(filePath, mount.path)) return;
    // Sync index when a mounted file is removed externally
    db.prepare("DELETE FROM media WHERE source_type = 'mount' AND mount_id = ? AND file_path = ?").run(
      mount.id,
      filePath
    );
    updateMountStatsStmt.run(mount.id, new Date().toISOString(), mount.id);
  });

  watcher.on('error', (err) => {
    console.warn(`Mount watcher error (${mount.name}):`, err);
  });

  watchers.set(mount.id, watcher);
}

export function stopMountWatcher(mountId: string): void {
  const existing = watchers.get(mountId);
  if (existing) {
    existing.close().catch(() => {});
    watchers.delete(mountId);
  }
}

export function addExternalMount(name: string, rawPath: string, isWatching = true): MountRow {
  const check = validateExternalMountPath(rawPath);
  if (!check.valid) {
    throw new Error(check.error);
  }

  const existing = db.prepare('SELECT * FROM mounts WHERE path = ?').get(check.resolved) as MountRow | undefined;
  if (existing) {
    throw new Error('This directory is already mounted.');
  }

  const id = crypto.randomUUID();
  const cleanName = name.trim().slice(0, 80) || path.basename(check.resolved) || 'External NAS';
  const now = new Date().toISOString();

  db.prepare(
    'INSERT INTO mounts (id, name, path, is_readonly, is_watching, file_count, created_at) VALUES (?, ?, ?, 1, ?, 0, ?)'
  ).run(id, cleanName, check.resolved, isWatching ? 1 : 0, now);

  const created = db.prepare('SELECT * FROM mounts WHERE id = ?').get(id) as MountRow;
  if (isWatching) {
    startMountWatcher(created);
  }
  return created;
}

export async function bootstrapConfiguredMounts(): Promise<void> {
  // Sync EXTERNAL_MOUNTS from .env into SQLite if not already registered
  for (const envMount of config.envExternalMounts) {
    const check = validateExternalMountPath(envMount.path);
    if (!check.valid) continue;
    const existing = db.prepare('SELECT id FROM mounts WHERE path = ?').get(check.resolved);
    if (!existing) {
      const id = crypto.randomUUID();
      db.prepare(
        'INSERT INTO mounts (id, name, path, is_readonly, is_watching, file_count, created_at) VALUES (?, ?, ?, 1, 1, 0, ?)'
      ).run(id, envMount.name, check.resolved, new Date().toISOString());
    }
  }

  const allMounts = db.prepare('SELECT * FROM mounts').all() as MountRow[];
  for (const mount of allMounts) {
    if (mount.is_watching) {
      startMountWatcher(mount);
    }
    // Kick off non-blocking background scan
    scanMount(mount.id).catch((err) => {
      console.warn(`Initial scan skipped for mount ${mount.name}:`, err);
    });
  }
}
