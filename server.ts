import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import Fastify from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import middie from '@fastify/middie';
import fastifyStatic from '@fastify/static';
import { config, ensureStorageDirectories } from './server/config.ts';
import { db } from './server/db.ts';
import type { AlbumRow, MediaRow, MountRow, ShareRow, SyncTokenRow } from './server/db.ts';
import {
  computeDuplicateGroups,
  getDuplicateScanStatus,
  parseSensitivity,
  resolveAllDuplicateGroups,
  resolveDuplicateGroup,
  startDuplicateScan,
  summarizeGroups,
} from './server/duplicates.ts';
import { classifyMediaExtension, ingestMediaFile, seedInitialGalleryIfEmpty } from './server/mediaPipeline.ts';
import {
  addExternalMount,
  bootstrapConfiguredMounts,
  scanMount,
  stopAllMountWatchers,
  stopMountWatcher,
} from './server/mounts.ts';
import {
  assertSafePathWithin,
  generateOpaqueToken,
  hashPassword,
  sanitizeFilename,
  sha256Hex,
  verifyBearerSyncToken,
  verifyPassword,
} from './server/security.ts';

ensureStorageDirectories();

const app = Fastify({
  logger: false,
  bodyLimit: 10 * 1024 * 1024,
});

await app.register(multipart, {
  limits: {
    fileSize: 2 * 1024 * 1024 * 1024, // 2 GiB per file
    files: 100,
  },
});

// Helper: serialize MediaRow for frontend API (never leaks raw OS paths in public routes)
function serializeMedia(row: MediaRow, mountMap?: Map<string, string>) {
  return {
    id: row.id,
    sha256: row.sha256,
    filename: row.filename,
    sourceType: row.source_type,
    mountId: row.mount_id,
    mountName: row.mount_id ? mountMap?.get(row.mount_id) ?? 'External Mount' : 'Local Uploads',
    mimeType: row.mime_type,
    mediaType: row.media_type,
    sizeBytes: row.size_bytes,
    width: row.width,
    height: row.height,
    durationSec: row.duration_sec,
    takenAt: row.taken_at,
    createdAt: row.created_at,
    cameraMake: row.camera_make,
    cameraModel: row.camera_model,
    lensModel: row.lens_model,
    focalLength: row.focal_length,
    aperture: row.aperture,
    shutterSpeed: row.shutter_speed,
    iso: row.iso,
    gpsLat: row.gps_lat,
    gpsLng: row.gps_lng,
    locationName: row.location_name,
    isFavorite: Boolean(row.is_favorite),
    isTrashed: Boolean(row.is_trashed),
    trashedAt: row.trashed_at,
    dominantColor: row.dominant_color || '#1e293b',
    thumb400Url: `/api/media/${row.id}/thumb/400`,
    thumb1600Url: `/api/media/${row.id}/thumb/1600`,
    originalUrl: `/api/media/${row.id}/original`,
  };
}

function getMountNameMap(): Map<string, string> {
  const rows = db.prepare('SELECT id, name FROM mounts').all() as Array<{ id: string; name: string }>;
  return new Map(rows.map((r) => [r.id, r.name]));
}

function resolvePermittedMediaFilePath(media: MediaRow): string {
  if (media.source_type === 'upload') {
    return assertSafePathWithin(media.file_path, config.uploadDir);
  }
  if (media.mount_id) {
    const mount = db.prepare('SELECT path FROM mounts WHERE id = ?').get(media.mount_id) as { path: string } | undefined;
    if (mount) {
      return assertSafePathWithin(media.file_path, mount.path);
    }
  }
  throw new Error('Media file storage root is no longer registered');
}

function streamFileWithRange(
  req: FastifyRequest,
  reply: FastifyReply,
  filePath: string,
  mimeType: string,
  downloadFilename?: string,
  forceDownload = false
) {
  if (!fs.existsSync(filePath)) {
    return reply.code(404).send({ error: 'Media file not found on storage' });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const rangeHeader = req.headers.range;

  reply.header('Accept-Ranges', 'bytes');
  reply.header('Content-Type', mimeType);
  reply.header('Cache-Control', 'private, max-age=3600');
  if (forceDownload && downloadFilename) {
    reply.header('Content-Disposition', `attachment; filename="${sanitizeFilename(downloadFilename)}"`);
  }

  if (rangeHeader && rangeHeader.startsWith('bytes=')) {
    const parts = rangeHeader.replace(/bytes=/, '').split('-');
    let start = parts[0] ? Number.parseInt(parts[0], 10) : 0;
    let end = parts[1] ? Number.parseInt(parts[1], 10) : fileSize - 1;

    if (parts[0] === '' && parts[1]) {
      const suffix = Number.parseInt(parts[1], 10);
      start = Math.max(0, fileSize - suffix);
      end = fileSize - 1;
    }

    if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || end >= fileSize || start > end) {
      reply.header('Content-Range', `bytes */${fileSize}`);
      return reply.code(416).send();
    }

    const chunkSize = end - start + 1;
    reply.code(206);
    reply.header('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    reply.header('Content-Length', String(chunkSize));
    return reply.send(fs.createReadStream(filePath, { start, end }));
  }

  reply.header('Content-Length', String(fileSize));
  return reply.send(fs.createReadStream(filePath));
}

function getDirSizeBytes(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;
  let total = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += getDirSizeBytes(full);
      } else if (entry.isFile()) {
        try {
          total += fs.statSync(full).size;
        } catch {
          // skip transient files
        }
      }
    }
  } catch {
    return total;
  }
  return total;
}

const findSyncTokenByHashStmt = db.prepare('SELECT id FROM sync_tokens WHERE token_hash = ?');
const markSyncTokenUsedStmt = db.prepare('UPDATE sync_tokens SET last_used_at = ? WHERE id = ?');
const countSyncTokensStmt = db.prepare('SELECT COUNT(*) as count FROM sync_tokens');
const findDeletedHashStmt = db.prepare('SELECT sha256 FROM deleted_hashes WHERE sha256 = ?');
const recordDeletedHashStmt = db.prepare('INSERT OR IGNORE INTO deleted_hashes (sha256, deleted_at) VALUES (?, ?)');
const removeDeletedHashStmt = db.prepare('DELETE FROM deleted_hashes WHERE sha256 = ?');

function checkOptionalBearerAuth(req: FastifyRequest, reply: FastifyReply): boolean {
  const authHeader = req.headers.authorization;
  if (!authHeader) return true; // Same-origin web UI calls without Bearer header
  const result = verifyBearerSyncToken(
    authHeader,
    (hash) => findSyncTokenByHashStmt.get(hash) as { id: string } | undefined,
    (id) => markSyncTokenUsedStmt.run(new Date().toISOString(), id)
  );
  if (!result.authenticated) {
    reply.code(401).send({ error: 'Invalid Bearer sync API token' });
    return false;
  }
  return true;
}

function requireBearerSyncAuth(req: FastifyRequest, reply: FastifyReply): boolean {
  const hasAnyToken = Boolean(config.envSyncApiToken) || ((countSyncTokensStmt.get() as { count: number }).count > 0);
  if (!hasAnyToken) {
    reply.code(401).send({
      error: 'Sync authentication is not configured. Set SYNC_API_TOKEN or create a token in Storage & Sync.',
    });
    return false;
  }
  const result = verifyBearerSyncToken(
    req.headers.authorization,
    (hash) => findSyncTokenByHashStmt.get(hash) as { id: string } | undefined,
    (id) => markSyncTokenUsedStmt.run(new Date().toISOString(), id)
  );
  if (!result.authenticated) {
    reply.code(401).send({ error: 'Missing or invalid Bearer sync API token' });
    return false;
  }
  return true;
}

// ============================================================================
// HEALTHCHECK ENDPOINT
// ============================================================================

app.get('/api/health', async (_req, reply) => {
  try {
    db.prepare('SELECT 1').get();
    return {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  } catch {
    return reply.code(503).send({ status: 'error', error: 'Database unavailable' });
  }
});

// ============================================================================
// MEDIA QUERY & MANAGEMENT ROUTES
// ============================================================================

app.get('/api/media', async (req) => {
  const query = req.query as {
    view?: string;
    q?: string;
    albumId?: string;
    place?: string;
    type?: string;
    mountId?: string;
  };

  const conditions: string[] = [];
  const params: unknown[] = [];
  let joinClause = '';

  if (query.view === 'trash') {
    conditions.push('m.is_trashed = 1');
  } else {
    conditions.push('m.is_trashed = 0');
    if (query.view === 'favorites') {
      conditions.push('m.is_favorite = 1');
    }
  }

  if (query.albumId) {
    joinClause = 'INNER JOIN album_media am ON am.media_id = m.id';
    conditions.push('am.album_id = ?');
    params.push(query.albumId);
  }

  if (query.place) {
    conditions.push('m.location_name = ?');
    params.push(query.place);
  }

  if (query.type === 'image' || query.type === 'video') {
    conditions.push('m.media_type = ?');
    params.push(query.type);
  }

  if (query.mountId) {
    conditions.push('m.mount_id = ?');
    params.push(query.mountId);
  }

  if (query.q && query.q.trim() !== '') {
    const pattern = `%${query.q.trim()}%`;
    conditions.push(
      '(m.filename LIKE ? OR m.location_name LIKE ? OR m.camera_make LIKE ? OR m.camera_model LIKE ? OR m.lens_model LIKE ? OR m.taken_at LIKE ?)'
    );
    params.push(pattern, pattern, pattern, pattern, pattern, pattern);
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT m.* FROM media m ${joinClause} ${whereSql} ORDER BY m.taken_at DESC, m.created_at DESC`;
  const rows = db.prepare(sql).all(...params) as MediaRow[];
  const mountMap = getMountNameMap();

  return {
    items: rows.map((row) => serializeMedia(row, mountMap)),
    total: rows.length,
  };
});

app.get('/api/media/:id', async (req, reply) => {
  const { id } = req.params as { id: string };
  const row = db.prepare('SELECT * FROM media WHERE id = ?').get(id) as MediaRow | undefined;
  if (!row) return reply.code(404).send({ error: 'Media item not found' });

  const albums = db
    .prepare('SELECT a.id, a.title FROM albums a INNER JOIN album_media am ON am.album_id = a.id WHERE am.media_id = ?')
    .all(id) as Array<{ id: string; title: string }>;
  const mountMap = getMountNameMap();

  return {
    ...serializeMedia(row, mountMap),
    albums,
  };
});

app.patch('/api/media/:id', async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = (req.body || {}) as {
    isFavorite?: boolean;
    isTrashed?: boolean;
    locationName?: string | null;
  };

  const existing = db.prepare('SELECT * FROM media WHERE id = ?').get(id) as MediaRow | undefined;
  if (!existing) return reply.code(404).send({ error: 'Media item not found' });

  if (typeof body.isFavorite === 'boolean') {
    db.prepare('UPDATE media SET is_favorite = ? WHERE id = ?').run(body.isFavorite ? 1 : 0, id);
  }

  if (typeof body.isTrashed === 'boolean') {
    db.prepare('UPDATE media SET is_trashed = ?, trashed_at = ? WHERE id = ?').run(
      body.isTrashed ? 1 : 0,
      body.isTrashed ? new Date().toISOString() : null,
      id
    );
  }

  if (body.locationName !== undefined) {
    const cleanLoc = body.locationName ? String(body.locationName).trim().slice(0, 120) : null;
    db.prepare('UPDATE media SET location_name = ? WHERE id = ?').run(cleanLoc, id);
  }

  const updated = db.prepare('SELECT * FROM media WHERE id = ?').get(id) as MediaRow;
  return serializeMedia(updated, getMountNameMap());
});

function resolveDeletableOriginalPath(row: MediaRow): string | null {
  const candidateRoots: string[] = [config.uploadDir];

  if (row.mount_id) {
    const mount = db.prepare('SELECT path FROM mounts WHERE id = ?').get(row.mount_id) as
      | { path: string }
      | undefined;
    if (mount?.path) {
      candidateRoots.push(mount.path);
    }
  }

  const allMounts = db.prepare('SELECT path FROM mounts').all() as Array<{ path: string }>;
  for (const m of allMounts) {
    if (m.path && !candidateRoots.includes(m.path)) {
      candidateRoots.push(m.path);
    }
  }

  for (const root of candidateRoots) {
    const resolvedRoot = path.resolve(root);
    try {
      const safePath = assertSafePathWithin(row.file_path, resolvedRoot);
      if (safePath !== resolvedRoot) {
        return safePath;
      }
    } catch {
      // Try next permitted root
    }
  }

  return null;
}

async function safeUnlinkIgnoreMissing(filePath: string): Promise<boolean> {
  try {
    await fs.promises.unlink(filePath);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT') {
      return true;
    }
    console.warn(`Failed to unlink file on disk (${filePath}):`, err);
    return false;
  }
}

async function permanentlyDeleteMediaRow(row: MediaRow): Promise<{ deletedFromDisk: boolean }> {
  let deletedFromDisk = false;
  const safeOriginal = resolveDeletableOriginalPath(row);
  if (safeOriginal) {
    deletedFromDisk = await safeUnlinkIgnoreMissing(safeOriginal);
  }

  for (const thumb of [row.thumb_400, row.thumb_1600]) {
    if (!thumb) continue;
    try {
      const safeThumb = assertSafePathWithin(thumb, config.thumbsDir);
      if (safeThumb !== path.resolve(config.thumbsDir)) {
        await safeUnlinkIgnoreMissing(safeThumb);
      }
    } catch {
      // Ignore invalid thumbnail path
    }
  }

  recordDeletedHashStmt.run(row.sha256, new Date().toISOString());
  db.prepare('DELETE FROM media WHERE id = ?').run(row.id);

  if (row.mount_id) {
    db.prepare(
      'UPDATE mounts SET file_count = (SELECT COUNT(*) FROM media WHERE mount_id = ? AND is_trashed = 0) WHERE id = ?'
    ).run(row.mount_id, row.mount_id);
  }

  return { deletedFromDisk };
}

app.delete('/api/media/:id', async (req, reply) => {
  const { id } = req.params as { id: string };
  const existing = db.prepare('SELECT * FROM media WHERE id = ?').get(id) as MediaRow | undefined;
  if (!existing) return reply.code(404).send({ error: 'Media item not found' });

  const { deletedFromDisk } = await permanentlyDeleteMediaRow(existing);
  return { deleted: true, id, deletedFromDisk };
});

app.post('/api/media/batch', async (req, reply) => {
  const body = (req.body || {}) as {
    ids?: string[];
    action?: 'favorite' | 'unfavorite' | 'trash' | 'restore' | 'delete' | 'addToAlbum';
    albumId?: string;
  };

  const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === 'string') : [];
  if (ids.length === 0 || !body.action) {
    return reply.code(400).send({ error: 'Provide media ids and a valid action' });
  }

  const now = new Date().toISOString();
  let affected = 0;
  let deletedFromDiskCount = 0;

  if (body.action === 'favorite' || body.action === 'unfavorite') {
    const val = body.action === 'favorite' ? 1 : 0;
    const stmt = db.prepare('UPDATE media SET is_favorite = ? WHERE id = ?');
    for (const id of ids) affected += stmt.run(val, id).changes;
  } else if (body.action === 'trash' || body.action === 'restore') {
    const val = body.action === 'trash' ? 1 : 0;
    const stmt = db.prepare('UPDATE media SET is_trashed = ?, trashed_at = ? WHERE id = ?');
    for (const id of ids) affected += stmt.run(val, val ? now : null, id).changes;
  } else if (body.action === 'delete') {
    const getStmt = db.prepare('SELECT * FROM media WHERE id = ?');
    for (const id of ids) {
      const row = getStmt.get(id) as MediaRow | undefined;
      if (row) {
        const res = await permanentlyDeleteMediaRow(row);
        if (res.deletedFromDisk) deletedFromDiskCount++;
        affected++;
      }
    }
  } else if (body.action === 'addToAlbum') {
    if (!body.albumId) return reply.code(400).send({ error: 'albumId is required' });
    const album = db.prepare('SELECT id, cover_media_id FROM albums WHERE id = ?').get(body.albumId) as
      | { id: string; cover_media_id: string | null }
      | undefined;
    if (!album) return reply.code(404).send({ error: 'Album not found' });
    const stmt = db.prepare('INSERT OR IGNORE INTO album_media (album_id, media_id, added_at) VALUES (?, ?, ?)');
    for (const id of ids) affected += stmt.run(body.albumId, id, now).changes;
    if (!album.cover_media_id && ids[0]) {
      db.prepare('UPDATE albums SET cover_media_id = ?, updated_at = ? WHERE id = ?').run(ids[0], now, body.albumId);
    } else {
      db.prepare('UPDATE albums SET updated_at = ? WHERE id = ?').run(now, body.albumId);
    }
  }

  return body.action === 'delete'
    ? { action: body.action, affected, deletedFromDiskCount }
    : { action: body.action, affected };
});

async function handleEmptyTrashRoute() {
  const trashed = db.prepare('SELECT * FROM media WHERE is_trashed = 1').all() as MediaRow[];
  let deletedFromDiskCount = 0;
  for (const row of trashed) {
    const res = await permanentlyDeleteMediaRow(row);
    if (res.deletedFromDisk) deletedFromDiskCount++;
  }
  return { emptied: trashed.length, deletedFromDiskCount };
}

app.delete('/api/trash', async () => handleEmptyTrashRoute());
app.post('/api/trash/empty', async () => handleEmptyTrashRoute());

app.get('/api/media/:id/thumb/:size', async (req, reply) => {
  const { id, size } = req.params as { id: string; size: string };
  if (size !== '400' && size !== '1600') {
    return reply.code(400).send({ error: 'Thumbnail size must be 400 or 1600' });
  }

  const row = db.prepare('SELECT * FROM media WHERE id = ?').get(id) as MediaRow | undefined;
  if (!row) return reply.code(404).send({ error: 'Media not found' });

  const thumbPath = size === '400' ? row.thumb_400 : row.thumb_1600;
  if (thumbPath) {
    try {
      const safeThumb = assertSafePathWithin(thumbPath, config.thumbsDir);
      if (fs.existsSync(safeThumb)) {
        reply.header('Content-Type', 'image/webp');
        reply.header('Cache-Control', 'public, max-age=31536000, immutable');
        return reply.send(fs.createReadStream(safeThumb));
      }
    } catch {
      return reply.code(403).send({ error: 'Invalid thumbnail path' });
    }
  }

  // Fallback to original image if thumbnail unavailable
  if (row.media_type === 'image') {
    try {
      const safeOrig = resolvePermittedMediaFilePath(row);
      return streamFileWithRange(req, reply, safeOrig, row.mime_type);
    } catch {
      return reply.code(404).send({ error: 'Thumbnail unavailable' });
    }
  }

  return reply.code(404).send({ error: 'Thumbnail unavailable' });
});

app.get('/api/media/:id/original', async (req, reply) => {
  const { id } = req.params as { id: string };
  const query = req.query as { download?: string };
  const row = db.prepare('SELECT * FROM media WHERE id = ?').get(id) as MediaRow | undefined;
  if (!row) return reply.code(404).send({ error: 'Media not found' });

  try {
    const safePath = resolvePermittedMediaFilePath(row);
    return streamFileWithRange(req, reply, safePath, row.mime_type, row.filename, query.download === '1');
  } catch {
    return reply.code(403).send({ error: 'Storage path access denied' });
  }
});

// ============================================================================
// DEDUPLICATION & SYNC API (POST /api/sync, /api/sync/check, & /api/upload)
// ============================================================================

app.post('/api/sync/check', async (req, reply) => {
  if (!checkOptionalBearerAuth(req, reply)) return;

  const rawBody = req.body as
    | Array<{ sha256: string; filename?: string; size?: number }>
    | { files?: Array<{ sha256: string; filename?: string; size?: number }> };

  const files = Array.isArray(rawBody) ? rawBody : Array.isArray(rawBody?.files) ? rawBody.files : null;
  if (!files) {
    return reply.code(400).send({
      error: 'Expected JSON array of { sha256, filename, size } or { files: [...] }',
    });
  }

  const normalized = files
    .filter((f) => f && typeof f.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(f.sha256.trim()))
    .map((f) => ({
      sha256: f.sha256.trim().toLowerCase(),
      filename: typeof f.filename === 'string' ? f.filename : '',
      size: typeof f.size === 'number' ? f.size : 0,
    }));

  const lookupStmt = db.prepare('SELECT sha256 FROM media WHERE sha256 = ?');
  const existingSet = new Set<string>();
  const ignoredSet = new Set<string>();
  for (const item of normalized) {
    if (lookupStmt.get(item.sha256)) {
      existingSet.add(item.sha256);
    } else if (findDeletedHashStmt.get(item.sha256)) {
      ignoredSet.add(item.sha256);
    }
  }

  const missing = normalized.filter((item) => !existingSet.has(item.sha256) && !ignoredSet.has(item.sha256));
  const existing = normalized.filter((item) => existingSet.has(item.sha256));
  const ignored = normalized.filter((item) => ignoredSet.has(item.sha256));

  return {
    checked: normalized.length,
    missing,
    existing,
    ignored,
    missingHashes: missing.map((m) => m.sha256),
    ignoredHashes: ignored.map((m) => m.sha256),
  };
});

async function handleMultipartIngest(req: FastifyRequest, options?: { skipDeletedHashes?: boolean }) {
  const skipDeletedHashes = options?.skipDeletedHashes ?? false;
  const parts = req.parts();
  const uploaded: Array<ReturnType<typeof serializeMedia>> = [];
  const duplicates: Array<{ filename: string; sha256: string; mediaId: string }> = [];
  const ignored: Array<{ filename: string; sha256: string; reason: string }> = [];
  const errors: Array<{ filename: string; error: string }> = [];
  const mountMap = getMountNameMap();

  for await (const part of parts) {
    if (part.type !== 'file') continue;
    const rawFilename = sanitizeFilename(part.filename || 'upload.jpg');
    const classified = classifyMediaExtension(rawFilename);
    if (!classified) {
      // Drain stream so multipart parser continues cleanly
      part.file.resume();
      errors.push({ filename: rawFilename, error: 'Unsupported media format' });
      continue;
    }

    const tempName = `up-${crypto.randomUUID()}${classified.ext}`;
    const tempPath = path.join(config.tmpDir, tempName);
    const hash = crypto.createHash('sha256');
    const writeStream = fs.createWriteStream(tempPath);

    try {
      part.file.on('data', (chunk: Buffer) => {
        hash.update(chunk);
      });
      await pipeline(part.file, writeStream);
      const sha256 = hash.digest('hex');

      if (skipDeletedHashes && findDeletedHashStmt.get(sha256)) {
        if (fs.existsSync(tempPath)) {
          try {
            fs.unlinkSync(tempPath);
          } catch {
            // ignore
          }
        }
        ignored.push({
          filename: rawFilename,
          sha256,
          reason: 'Previously deleted from gallery',
        });
        continue;
      }

      if (!skipDeletedHashes) {
        // Explicit manual re-upload clears the deleted-hash ignore record
        removeDeletedHashStmt.run(sha256);
      }

      const result = await ingestMediaFile({
        sourcePath: tempPath,
        originalFilename: rawFilename,
        sourceType: 'upload',
        precomputedSha256: sha256,
      });

      if (result.duplicate) {
        if (fs.existsSync(tempPath)) {
          try {
            fs.unlinkSync(tempPath);
          } catch {
            // ignore
          }
        }
        duplicates.push({
          filename: rawFilename,
          sha256,
          mediaId: result.media.id,
        });
      } else {
        uploaded.push(serializeMedia(result.media, mountMap));
      }
    } catch (err) {
      if (fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(tempPath);
        } catch {
          // ignore
        }
      }
      errors.push({
        filename: rawFilename,
        error: err instanceof Error ? err.message : 'Upload failed',
      });
    }
  }

  return { uploaded, duplicates, ignored, errors };
}

// Automated Bearer-authenticated mobile/CLI sync endpoint (Tasker, Apple Shortcuts, scripts)
app.post('/api/sync', async (req, reply) => {
  if (!requireBearerSyncAuth(req, reply)) return;
  if (!req.isMultipart()) {
    return reply.code(400).send({ error: 'Content-Type must be multipart/form-data' });
  }
  return handleMultipartIngest(req, { skipDeletedHashes: true });
});

app.post('/api/upload', async (req, reply) => {
  if (!checkOptionalBearerAuth(req, reply)) return;
  if (!req.isMultipart()) {
    return reply.code(400).send({ error: 'Content-Type must be multipart/form-data' });
  }
  const result = await handleMultipartIngest(req, { skipDeletedHashes: false });
  return result;
});

// PWA Web Share Target endpoint (manifest.webmanifest share_target)
app.post('/share-target', async (req, reply) => {
  if (!req.isMultipart()) {
    return reply.redirect('/');
  }
  const result = await handleMultipartIngest(req);
  const count = result.uploaded.length + result.duplicates.length;
  return reply.code(303).redirect(`/?shared=${count}`);
});

// ============================================================================
// VIRTUAL ALBUMS & PLACES
// ============================================================================

app.get('/api/albums', async () => {
  const albums = db.prepare('SELECT * FROM albums ORDER BY updated_at DESC').all() as AlbumRow[];
  const countStmt = db.prepare(`
    SELECT COUNT(*) as count FROM album_media am
    INNER JOIN media m ON m.id = am.media_id
    WHERE am.album_id = ? AND m.is_trashed = 0
  `);
  const previewStmt = db.prepare(`
    SELECT m.id FROM album_media am
    INNER JOIN media m ON m.id = am.media_id
    WHERE am.album_id = ? AND m.is_trashed = 0
    ORDER BY m.taken_at DESC
    LIMIT 4
  `);

  return {
    albums: albums.map((a) => {
      const count = (countStmt.get(a.id) as { count: number }).count;
      const previews = (previewStmt.get(a.id) ? previewStmt.all(a.id) : []) as Array<{ id: string }>;
      const coverId = a.cover_media_id || previews[0]?.id || null;
      return {
        id: a.id,
        title: a.title,
        description: a.description,
        coverMediaId: coverId,
        coverUrl: coverId ? `/api/media/${coverId}/thumb/400` : null,
        previewUrls: previews.map((p) => `/api/media/${p.id}/thumb/400`),
        itemCount: count,
        createdAt: a.created_at,
        updatedAt: a.updated_at,
      };
    }),
  };
});

app.post('/api/albums', async (req, reply) => {
  const body = (req.body || {}) as { title?: string; description?: string; mediaIds?: string[] };
  const title = (body.title || '').trim().slice(0, 120);
  if (!title) return reply.code(400).send({ error: 'Album title is required' });

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const description = (body.description || '').trim().slice(0, 400);
  const mediaIds = Array.isArray(body.mediaIds) ? body.mediaIds.filter((x) => typeof x === 'string') : [];

  db.prepare(
    'INSERT INTO albums (id, title, description, cover_media_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, title, description, mediaIds[0] || null, now, now);

  if (mediaIds.length > 0) {
    const stmt = db.prepare('INSERT OR IGNORE INTO album_media (album_id, media_id, added_at) VALUES (?, ?, ?)');
    for (const mId of mediaIds) stmt.run(id, mId, now);
  }

  return reply.code(201).send({
    id,
    title,
    description,
    coverMediaId: mediaIds[0] || null,
    coverUrl: mediaIds[0] ? `/api/media/${mediaIds[0]}/thumb/400` : null,
    previewUrls: mediaIds.slice(0, 4).map((m) => `/api/media/${m}/thumb/400`),
    itemCount: mediaIds.length,
    createdAt: now,
    updatedAt: now,
  });
});

app.patch('/api/albums/:id', async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = (req.body || {}) as { title?: string; description?: string; coverMediaId?: string | null };
  const existing = db.prepare('SELECT * FROM albums WHERE id = ?').get(id) as AlbumRow | undefined;
  if (!existing) return reply.code(404).send({ error: 'Album not found' });

  const title = body.title !== undefined ? body.title.trim().slice(0, 120) : existing.title;
  const description = body.description !== undefined ? body.description.trim().slice(0, 400) : existing.description;
  const coverMediaId = body.coverMediaId !== undefined ? body.coverMediaId : existing.cover_media_id;
  const now = new Date().toISOString();

  db.prepare('UPDATE albums SET title = ?, description = ?, cover_media_id = ?, updated_at = ? WHERE id = ?').run(
    title || existing.title,
    description,
    coverMediaId,
    now,
    id
  );

  return { id, title, description, coverMediaId, updatedAt: now };
});

app.delete('/api/albums/:id', async (req, reply) => {
  const { id } = req.params as { id: string };
  const res = db.prepare('DELETE FROM albums WHERE id = ?').run(id);
  if (res.changes === 0) return reply.code(404).send({ error: 'Album not found' });
  return { deleted: true, id };
});

app.post('/api/albums/:id/media', async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = (req.body || {}) as { mediaIds?: string[] };
  const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(id) as AlbumRow | undefined;
  if (!album) return reply.code(404).send({ error: 'Album not found' });

  const mediaIds = Array.isArray(body.mediaIds) ? body.mediaIds.filter((x) => typeof x === 'string') : [];
  const now = new Date().toISOString();
  const stmt = db.prepare('INSERT OR IGNORE INTO album_media (album_id, media_id, added_at) VALUES (?, ?, ?)');
  let added = 0;
  for (const mId of mediaIds) added += stmt.run(id, mId, now).changes;

  if (!album.cover_media_id && mediaIds[0]) {
    db.prepare('UPDATE albums SET cover_media_id = ?, updated_at = ? WHERE id = ?').run(mediaIds[0], now, id);
  } else {
    db.prepare('UPDATE albums SET updated_at = ? WHERE id = ?').run(now, id);
  }

  return { added, albumId: id };
});

app.delete('/api/albums/:id/media/:mediaId', async (req) => {
  const { id, mediaId } = req.params as { id: string; mediaId: string };
  db.prepare('DELETE FROM album_media WHERE album_id = ? AND media_id = ?').run(id, mediaId);
  db.prepare('UPDATE albums SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), id);
  return { removed: true };
});

app.get('/api/places', async () => {
  const rows = db
    .prepare(`
      SELECT
        COALESCE(location_name, printf('%.2f, %.2f', gps_lat, gps_lng)) as place_key,
        AVG(gps_lat) as lat,
        AVG(gps_lng) as lng,
        COUNT(*) as count,
        MAX(taken_at) as latest_taken_at,
        (SELECT id FROM media m2
         WHERE m2.is_trashed = 0
           AND COALESCE(m2.location_name, printf('%.2f, %.2f', m2.gps_lat, m2.gps_lng)) = COALESCE(media.location_name, printf('%.2f, %.2f', media.gps_lat, media.gps_lng))
         ORDER BY m2.taken_at DESC LIMIT 1) as cover_id
      FROM media
      WHERE is_trashed = 0 AND (location_name IS NOT NULL OR (gps_lat IS NOT NULL AND gps_lng IS NOT NULL))
      GROUP BY place_key
      ORDER BY count DESC, latest_taken_at DESC
    `)
    .all() as Array<{
    place_key: string;
    lat: number | null;
    lng: number | null;
    count: number;
    latest_taken_at: string;
    cover_id: string | null;
  }>;

  return {
    places: rows.map((r) => ({
      name: r.place_key,
      lat: r.lat,
      lng: r.lng,
      count: r.count,
      latestTakenAt: r.latest_taken_at,
      coverUrl: r.cover_id ? `/api/media/${r.cover_id}/thumb/400` : null,
    })),
  };
});

// ============================================================================
// DUPLICATE DETECTION & SAFE RESOLUTION (Visual dHash + Soft-Trash Only)
// ============================================================================

app.post('/api/duplicates/scan', async (req, reply) => {
  if (!checkOptionalBearerAuth(req, reply)) return;
  const body = (req.body || {}) as { sensitivity?: unknown };
  const sensitivity = parseSensitivity(body.sensitivity);
  return startDuplicateScan(sensitivity);
});

app.get('/api/duplicates/status', async (req, reply) => {
  if (!checkOptionalBearerAuth(req, reply)) return;
  const query = (req.query || {}) as { sensitivity?: unknown };
  const sensitivity = query.sensitivity !== undefined ? parseSensitivity(query.sensitivity) : undefined;
  return getDuplicateScanStatus(sensitivity);
});

app.get('/api/duplicates', async (req, reply) => {
  if (!checkOptionalBearerAuth(req, reply)) return;
  const query = (req.query || {}) as { sensitivity?: unknown };
  const sensitivity = parseSensitivity(query.sensitivity);
  const status = getDuplicateScanStatus(sensitivity);
  const groups = computeDuplicateGroups(sensitivity);
  const summary = summarizeGroups(groups);

  return {
    sensitivity,
    state: status.state,
    processed: status.processed,
    total: status.total,
    lastScanAt: status.lastScanAt,
    groupCount: summary.groupCount,
    removableCount: summary.removableCount,
    removableBytes: summary.removableBytes,
    groups,
  };
});

app.post('/api/duplicates/resolve', async (req, reply) => {
  if (!checkOptionalBearerAuth(req, reply)) return;
  const body = (req.body || {}) as {
    keepId?: unknown;
    trashIds?: unknown;
    sensitivity?: unknown;
  };

  if (typeof body.keepId !== 'string' || !body.keepId.trim()) {
    return reply.code(400).send({ error: 'keepId must be a valid media ID' });
  }
  if (!Array.isArray(body.trashIds) || body.trashIds.length === 0) {
    return reply.code(400).send({ error: 'trashIds must be a non-empty array of media IDs' });
  }
  const trashIds = body.trashIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
  if (trashIds.length !== body.trashIds.length) {
    return reply.code(400).send({ error: 'Every item in trashIds must be a valid media ID string' });
  }

  const sensitivity = parseSensitivity(body.sensitivity);
  try {
    return resolveDuplicateGroup({
      keepId: body.keepId.trim(),
      trashIds: trashIds.map((id) => id.trim()),
      sensitivity,
    });
  } catch (err) {
    return reply.code(400).send({ error: err instanceof Error ? err.message : 'Failed to resolve duplicate group' });
  }
});

app.post('/api/duplicates/resolve-all', async (req, reply) => {
  if (!checkOptionalBearerAuth(req, reply)) return;
  const body = (req.body || {}) as { sensitivity?: unknown };
  const sensitivity = parseSensitivity(body.sensitivity);
  try {
    return resolveAllDuplicateGroups(sensitivity);
  } catch (err) {
    return reply.code(500).send({ error: err instanceof Error ? err.message : 'Failed to resolve duplicate groups' });
  }
});

// ============================================================================
// PUBLIC SHARE LINKS (Optional Password + Optional Expiration)
// ============================================================================

app.get('/api/shares', async () => {
  const rows = db.prepare('SELECT * FROM shares ORDER BY created_at DESC').all() as ShareRow[];
  return {
    shares: rows.map((s) => ({
      id: s.id,
      token: s.token,
      targetType: s.target_type,
      targetId: s.target_id,
      title: s.title,
      hasPassword: Boolean(s.password_hash),
      expiresAt: s.expires_at,
      allowDownload: Boolean(s.allow_download),
      viewCount: s.view_count,
      createdAt: s.created_at,
      sharePath: `/s/${s.token}`,
    })),
  };
});

app.post('/api/shares', async (req, reply) => {
  const body = (req.body || {}) as {
    targetType?: 'media' | 'album';
    targetId?: string;
    title?: string;
    password?: string;
    expiresInHours?: number | null;
    allowDownload?: boolean;
  };

  if ((body.targetType !== 'media' && body.targetType !== 'album') || !body.targetId) {
    return reply.code(400).send({ error: 'Valid targetType (media|album) and targetId are required' });
  }

  let resolvedTitle = (body.title || '').trim();
  if (body.targetType === 'media') {
    const m = db.prepare('SELECT id, filename FROM media WHERE id = ?').get(body.targetId) as
      | { id: string; filename: string }
      | undefined;
    if (!m) return reply.code(404).send({ error: 'Media item not found' });
    if (!resolvedTitle) resolvedTitle = m.filename;
  } else {
    const a = db.prepare('SELECT id, title FROM albums WHERE id = ?').get(body.targetId) as
      | { id: string; title: string }
      | undefined;
    if (!a) return reply.code(404).send({ error: 'Album not found' });
    if (!resolvedTitle) resolvedTitle = a.title;
  }

  let passwordHash: string | null = null;
  let passwordSalt: string | null = null;
  if (body.password && body.password.trim().length > 0) {
    const hashed = hashPassword(body.password.trim());
    passwordHash = hashed.hash;
    passwordSalt = hashed.salt;
  }

  let expiresAt: string | null = null;
  if (typeof body.expiresInHours === 'number' && body.expiresInHours > 0) {
    expiresAt = new Date(Date.now() + body.expiresInHours * 3600 * 1000).toISOString();
  }

  const id = crypto.randomUUID();
  const token = generateOpaqueToken(16);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO shares (id, token, target_type, target_id, title, password_hash, password_salt, expires_at, allow_download, view_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(
    id,
    token,
    body.targetType,
    body.targetId,
    resolvedTitle.slice(0, 140),
    passwordHash,
    passwordSalt,
    expiresAt,
    body.allowDownload === false ? 0 : 1,
    now
  );

  return reply.code(201).send({
    id,
    token,
    targetType: body.targetType,
    targetId: body.targetId,
    title: resolvedTitle,
    hasPassword: Boolean(passwordHash),
    expiresAt,
    allowDownload: body.allowDownload !== false,
    viewCount: 0,
    createdAt: now,
    sharePath: `/s/${token}`,
  });
});

app.delete('/api/shares/:id', async (req, reply) => {
  const { id } = req.params as { id: string };
  const res = db.prepare('DELETE FROM shares WHERE id = ?').run(id);
  if (res.changes === 0) return reply.code(404).send({ error: 'Share link not found' });
  return { deleted: true, id };
});

// In-memory HMAC key for short-lived unlocked share media access tokens (never exposes password in URLs)
const SHARE_ACCESS_HMAC_KEY = crypto.randomBytes(32);

function signShareAccessToken(shareToken: string, expiresAtMs: number): string {
  const payload = `${shareToken}.${expiresAtMs}`;
  const sig = crypto.createHmac('sha256', SHARE_ACCESS_HMAC_KEY).update(payload).digest('base64url');
  return `${expiresAtMs}.${sig}`;
}

function verifyShareAccessToken(shareToken: string, signed: string | undefined): boolean {
  if (!signed) return false;
  const dot = signed.indexOf('.');
  if (dot <= 0) return false;
  const expStr = signed.slice(0, dot);
  const sig = signed.slice(dot + 1);
  const expMs = Number.parseInt(expStr, 10);
  if (!Number.isFinite(expMs) || expMs < Date.now()) return false;
  const expected = crypto
    .createHmac('sha256', SHARE_ACCESS_HMAC_KEY)
    .update(`${shareToken}.${expMs}`)
    .digest('base64url');
  const bufA = Buffer.from(sig);
  const bufB = Buffer.from(expected);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function resolveShareAccess(
  token: string,
  suppliedPassword: string | undefined,
  signedAccessToken?: string
):
  | { status: 'not_found' }
  | { status: 'expired' }
  | { status: 'password_required'; share: ShareRow }
  | { status: 'ok'; share: ShareRow; items: MediaRow[] } {
  const share = db.prepare('SELECT * FROM shares WHERE token = ?').get(token) as ShareRow | undefined;
  if (!share) return { status: 'not_found' };
  if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) {
    return { status: 'expired' };
  }
  if (share.password_hash && share.password_salt) {
    const tokenOk = verifyShareAccessToken(token, signedAccessToken);
    const pwOk = Boolean(suppliedPassword && verifyPassword(suppliedPassword, share.password_salt, share.password_hash));
    if (!tokenOk && !pwOk) {
      return { status: 'password_required', share };
    }
  }

  let items: MediaRow[] = [];
  if (share.target_type === 'media') {
    const row = db.prepare('SELECT * FROM media WHERE id = ? AND is_trashed = 0').get(share.target_id) as
      | MediaRow
      | undefined;
    if (row) items = [row];
  } else {
    items = db
      .prepare(`
        SELECT m.* FROM media m
        INNER JOIN album_media am ON am.media_id = m.id
        WHERE am.album_id = ? AND m.is_trashed = 0
        ORDER BY m.taken_at DESC
      `)
      .all(share.target_id) as MediaRow[];
  }

  return { status: 'ok', share, items };
}

function serializePublicShareItems(token: string, items: MediaRow[], accessToken?: string) {
  const suffix = accessToken ? `?st=${encodeURIComponent(accessToken)}` : '';
  return items.map((row) => ({
    id: row.id,
    sha256: row.sha256,
    filename: row.filename,
    sourceType: row.source_type,
    mountId: null,
    mountName: 'Shared',
    mimeType: row.mime_type,
    mediaType: row.media_type,
    sizeBytes: row.size_bytes,
    width: row.width,
    height: row.height,
    durationSec: row.duration_sec,
    takenAt: row.taken_at,
    createdAt: row.created_at,
    cameraMake: row.camera_make,
    cameraModel: row.camera_model,
    lensModel: row.lens_model,
    focalLength: row.focal_length,
    aperture: row.aperture,
    shutterSpeed: row.shutter_speed,
    iso: row.iso,
    gpsLat: row.gps_lat,
    gpsLng: row.gps_lng,
    locationName: row.location_name,
    isFavorite: false,
    isTrashed: false,
    trashedAt: null,
    dominantColor: row.dominant_color || '#1e293b',
    thumb400Url: `/api/public/share/${token}/media/${row.id}/thumb/400${suffix}`,
    thumb1600Url: `/api/public/share/${token}/media/${row.id}/thumb/1600${suffix}`,
    originalUrl: `/api/public/share/${token}/media/${row.id}/original${suffix}`,
  }));
}

app.get('/api/public/share/:token', async (req, reply) => {
  const { token } = req.params as { token: string };
  const suppliedPassword =
    typeof req.headers['x-share-password'] === 'string' ? req.headers['x-share-password'] : undefined;

  const access = resolveShareAccess(token, suppliedPassword);
  if (access.status === 'not_found') return reply.code(404).send({ error: 'Share link not found' });
  if (access.status === 'expired') return reply.code(410).send({ error: 'This share link has expired' });
  if (access.status === 'password_required') {
    return {
      requiresPassword: true,
      title: access.share.title || 'Protected Share',
      targetType: access.share.target_type,
      expiresAt: access.share.expires_at,
    };
  }

  db.prepare('UPDATE shares SET view_count = view_count + 1 WHERE id = ?').run(access.share.id);

  return {
    requiresPassword: false,
    title: access.share.title,
    targetType: access.share.target_type,
    expiresAt: access.share.expires_at,
    allowDownload: Boolean(access.share.allow_download),
    viewCount: access.share.view_count + 1,
    items: serializePublicShareItems(token, access.items),
  };
});

app.post('/api/public/share/:token/unlock', async (req, reply) => {
  const { token } = req.params as { token: string };
  const body = (req.body || {}) as { password?: string };
  const access = resolveShareAccess(token, body.password);

  if (access.status === 'not_found') return reply.code(404).send({ error: 'Share link not found' });
  if (access.status === 'expired') return reply.code(410).send({ error: 'This share link has expired' });
  if (access.status === 'password_required') {
    return reply.code(401).send({ error: 'Incorrect password' });
  }

  db.prepare('UPDATE shares SET view_count = view_count + 1 WHERE id = ?').run(access.share.id);
  const accessToken = signShareAccessToken(token, Date.now() + 2 * 3600 * 1000);
  return {
    requiresPassword: false,
    title: access.share.title,
    targetType: access.share.target_type,
    expiresAt: access.share.expires_at,
    allowDownload: Boolean(access.share.allow_download),
    viewCount: access.share.view_count + 1,
    items: serializePublicShareItems(token, access.items, accessToken),
  };
});

app.get('/api/public/share/:token/media/:mediaId/thumb/:size', async (req, reply) => {
  const { token, mediaId, size } = req.params as { token: string; mediaId: string; size: string };
  const query = req.query as { st?: string };
  if (size !== '400' && size !== '1600') return reply.code(400).send({ error: 'Invalid size' });

  const pw = typeof req.headers['x-share-password'] === 'string' ? req.headers['x-share-password'] : undefined;
  const access = resolveShareAccess(token, pw, query.st);
  if (access.status !== 'ok') return reply.code(403).send({ error: 'Access denied' });

  const media = access.items.find((m) => m.id === mediaId);
  if (!media) return reply.code(404).send({ error: 'Media not in share' });

  const thumbPath = size === '400' ? media.thumb_400 : media.thumb_1600;
  if (thumbPath) {
    const safeThumb = assertSafePathWithin(thumbPath, config.thumbsDir);
    if (fs.existsSync(safeThumb)) {
      reply.header('Content-Type', 'image/webp');
      reply.header('Cache-Control', 'private, max-age=3600');
      return reply.send(fs.createReadStream(safeThumb));
    }
  }
  return reply.code(404).send({ error: 'Thumbnail unavailable' });
});

app.get('/api/public/share/:token/media/:mediaId/original', async (req, reply) => {
  const { token, mediaId } = req.params as { token: string; mediaId: string };
  const query = req.query as { st?: string; download?: string };
  const pw = typeof req.headers['x-share-password'] === 'string' ? req.headers['x-share-password'] : undefined;
  const access = resolveShareAccess(token, pw, query.st);
  if (access.status !== 'ok') return reply.code(403).send({ error: 'Access denied' });

  const media = access.items.find((m) => m.id === mediaId);
  if (!media) return reply.code(404).send({ error: 'Media not in share' });
  if (query.download === '1' && !access.share.allow_download) {
    return reply.code(403).send({ error: 'Downloads are disabled for this share link' });
  }

  const safePath = resolvePermittedMediaFilePath(media);
  return streamFileWithRange(req, reply, safePath, media.mime_type, media.filename, query.download === '1');
});

// ============================================================================
// STORAGE MOUNTS, OVERVIEW & SYNC TOKENS
// ============================================================================

app.get('/api/storage/overview', async () => {
  const mediaStats = db
    .prepare(`
      SELECT
        COUNT(*) as total_count,
        SUM(CASE WHEN media_type = 'image' THEN 1 ELSE 0 END) as photo_count,
        SUM(CASE WHEN media_type = 'video' THEN 1 ELSE 0 END) as video_count,
        COALESCE(SUM(size_bytes), 0) as total_bytes
      FROM media WHERE is_trashed = 0
    `)
    .get() as { total_count: number; photo_count: number; video_count: number; total_bytes: number };

  const trashCount = (db.prepare('SELECT COUNT(*) as c FROM media WHERE is_trashed = 1').get() as { c: number }).c;
  const dbBytes = fs.existsSync(config.dbPath) ? fs.statSync(config.dbPath).size : 0;
  const walBytes = fs.existsSync(`${config.dbPath}-wal`) ? fs.statSync(`${config.dbPath}-wal`).size : 0;
  const thumbsBytes = getDirSizeBytes(config.thumbsDir);
  const uploadsBytes = getDirSizeBytes(config.uploadDir);

  return {
    dataDir: config.dataDir,
    uploadDir: config.uploadDir,
    sqliteMode: 'WAL',
    dbSizeBytes: dbBytes + walBytes,
    thumbsSizeBytes: thumbsBytes,
    uploadsSizeBytes: uploadsBytes,
    indexedTotalBytes: mediaStats.total_bytes || 0,
    totalCount: mediaStats.total_count || 0,
    photoCount: mediaStats.photo_count || 0,
    videoCount: mediaStats.video_count || 0,
    trashCount,
    hasEnvSyncToken: Boolean(config.envSyncApiToken),
  };
});

app.get('/api/mounts', async () => {
  const rows = db.prepare('SELECT * FROM mounts ORDER BY created_at DESC').all() as MountRow[];
  return {
    mounts: rows.map((m) => ({
      id: m.id,
      name: m.name,
      path: m.path,
      isReadonly: Boolean(m.is_readonly),
      isWatching: Boolean(m.is_watching),
      fileCount: m.file_count,
      lastScanAt: m.last_scan_at,
      createdAt: m.created_at,
      existsOnDisk: fs.existsSync(m.path),
    })),
  };
});

app.post('/api/mounts', async (req, reply) => {
  const body = (req.body || {}) as { name?: string; path?: string; isWatching?: boolean };
  if (!body.path || typeof body.path !== 'string') {
    return reply.code(400).send({ error: 'Mount directory path is required' });
  }

  try {
    const mount = addExternalMount(body.name || '', body.path, body.isWatching !== false);
    const scanSummary = await scanMount(mount.id);
    const refreshed = db.prepare('SELECT * FROM mounts WHERE id = ?').get(mount.id) as MountRow;
    return reply.code(201).send({
      mount: {
        id: refreshed.id,
        name: refreshed.name,
        path: refreshed.path,
        isReadonly: Boolean(refreshed.is_readonly),
        isWatching: Boolean(refreshed.is_watching),
        fileCount: refreshed.file_count,
        lastScanAt: refreshed.last_scan_at,
        createdAt: refreshed.created_at,
        existsOnDisk: fs.existsSync(refreshed.path),
      },
      scanSummary,
    });
  } catch (err) {
    return reply.code(400).send({ error: err instanceof Error ? err.message : 'Failed to add mount' });
  }
});

app.post('/api/mounts/:id/scan', async (req, reply) => {
  const { id } = req.params as { id: string };
  try {
    const summary = await scanMount(id);
    return summary;
  } catch (err) {
    return reply.code(404).send({ error: err instanceof Error ? err.message : 'Mount scan failed' });
  }
});

app.delete('/api/mounts/:id', async (req, reply) => {
  const { id } = req.params as { id: string };
  const mount = db.prepare('SELECT * FROM mounts WHERE id = ?').get(id) as MountRow | undefined;
  if (!mount) return reply.code(404).send({ error: 'Mount not found' });

  stopMountWatcher(id);
  // Clean up generated thumbnails for this mount, NEVER touching source files on the NAS
  const mediaRows = db.prepare('SELECT thumb_400, thumb_1600 FROM media WHERE mount_id = ?').all(id) as Array<{
    thumb_400: string | null;
    thumb_1600: string | null;
  }>;
  for (const row of mediaRows) {
    for (const thumb of [row.thumb_400, row.thumb_1600]) {
      if (!thumb) continue;
      try {
        const safeThumb = assertSafePathWithin(thumb, config.thumbsDir);
        if (fs.existsSync(safeThumb)) fs.unlinkSync(safeThumb);
      } catch {
        // ignore
      }
    }
  }
  db.prepare('DELETE FROM mounts WHERE id = ?').run(id);
  return { removed: true, id, preservedSourceFiles: true };
});

app.get('/api/sync-tokens', async () => {
  const rows = db.prepare('SELECT * FROM sync_tokens ORDER BY created_at DESC').all() as SyncTokenRow[];
  return {
    tokens: rows.map((t) => ({
      id: t.id,
      label: t.label,
      tokenPrefix: t.token_prefix,
      lastUsedAt: t.last_used_at,
      createdAt: t.created_at,
    })),
    hasEnvToken: Boolean(config.envSyncApiToken),
  };
});

app.post('/api/sync-tokens', async (req, reply) => {
  const body = (req.body || {}) as { label?: string };
  const label = (body.label || 'Mobile Sync Device').trim().slice(0, 80);
  const rawToken = `xpl_${generateOpaqueToken(24)}`;
  const id = crypto.randomUUID();
  const prefix = `${rawToken.slice(0, 10)}…`;
  const hash = sha256Hex(rawToken);
  const now = new Date().toISOString();

  db.prepare(
    'INSERT INTO sync_tokens (id, label, token_prefix, token_hash, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, label, prefix, hash, now);

  // Full token returned once upon creation
  return reply.code(201).send({
    id,
    label,
    tokenPrefix: prefix,
    token: rawToken,
    createdAt: now,
  });
});

app.delete('/api/sync-tokens/:id', async (req, reply) => {
  const { id } = req.params as { id: string };
  const res = db.prepare('DELETE FROM sync_tokens WHERE id = ?').run(id);
  if (res.changes === 0) return reply.code(404).send({ error: 'Token not found' });
  return { deleted: true, id };
});

// ============================================================================
// VITE DEV MIDDLEWARE / PRODUCTION STATIC HOSTING
// ============================================================================

if (!config.isProd) {
  await app.register(middie);
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: {
      middlewareMode: true,
      allowedHosts: true,
      hmr: process.env.DISABLE_HMR === 'true' ? false : true,
      ws: { server: app.server },
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    appType: 'custom',
  });
  app.use((req, res, next) => {
    const url = req.url || '';
    if (url.startsWith('/api/') || url === '/api' || url.startsWith('/share-target')) {
      next();
      return;
    }
    vite.middlewares(req, res, next);
  });

  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'API route not found' });
    }
    const indexPath = path.resolve(process.cwd(), 'index.html');
    const rawHtml = fs.readFileSync(indexPath, 'utf-8');
    const transformed = await vite.transformIndexHtml(req.url, rawHtml);
    reply.type('text/html').send(transformed);
  });
} else {
  const distDir = path.resolve(process.cwd(), 'dist');
  await app.register(fastifyStatic, {
    root: distDir,
    prefix: '/',
    wildcard: false,
  });

  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'API route not found' });
    }
    return reply.sendFile('index.html');
  });
}

// Seed sample media on fresh install (when enabled) & bootstrap configured external mounts
await seedInitialGalleryIfEmpty();
await bootstrapConfiguredMounts();

await app.listen({ port: config.port, host: config.host });
console.log(`xPhotoLabs server listening on http://${config.host}:${config.port} (DATA_DIR: ${config.dataDir})`);

let shuttingDown = false;
async function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}, shutting down xPhotoLabs cleanly...`);
  try {
    await stopAllMountWatchers();
    await app.close();
    db.close();
  } catch (err) {
    console.error('Error during shutdown:', err);
  }
  process.exit(0);
}

process.on('SIGTERM', () => {
  void gracefulShutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void gracefulShutdown('SIGINT');
});
