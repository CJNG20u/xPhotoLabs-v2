import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { config } from './config.ts';
import { db } from './db.ts';
import type { MediaRow } from './db.ts';
import { assertSafePathWithin, sha256Hex } from './security.ts';

export type DuplicateSensitivity = 'strict' | 'similar' | 'loose';
export type DuplicateScanState = 'idle' | 'scanning' | 'ready' | 'error';

export const SENSITIVITY_THRESHOLDS: Record<DuplicateSensitivity, number> = {
  strict: 2,
  similar: 5,
  loose: 10,
};

const MAX_GROUP_SIZE = 20;
const ASPECT_RATIO_TOLERANCE = 0.05; // 5%
const BACKFILL_CONCURRENCY = 2;

export function parseSensitivity(raw: unknown): DuplicateSensitivity {
  if (raw === 'strict' || raw === 'similar' || raw === 'loose') return raw;
  return 'similar';
}

/**
 * Computes a 64-bit difference hash (dHash) as a 16-char lowercase hex string.
 * Resizes to 9x8 single-channel grayscale and compares adjacent horizontal pixels.
 */
export async function computeImageDHash(imagePath: string): Promise<string | null> {
  try {
    const { data, info } = await sharp(imagePath)
      .rotate()
      .removeAlpha()
      .grayscale()
      .resize(9, 8, { fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    if (info.channels !== 1 || data.length < 72) {
      return null;
    }

    let bits = 0n;
    for (let row = 0; row < 8; row++) {
      const offset = row * 9;
      for (let col = 0; col < 8; col++) {
        bits <<= 1n;
        if (data[offset + col] > data[offset + col + 1]) {
          bits |= 1n;
        }
      }
    }
    return bits.toString(16).padStart(16, '0');
  } catch (err) {
    console.warn(`dHash computation failed for ${imagePath}:`, err);
    return null;
  }
}

function parseHexHash64(hex: string): { hi: number; lo: number } | null {
  if (!/^[0-9a-f]{16}$/i.test(hex)) return null;
  const hi = Number.parseInt(hex.slice(0, 8), 16) >>> 0;
  const lo = Number.parseInt(hex.slice(8, 16), 16) >>> 0;
  return { hi, lo };
}

function popcount32(x: number): number {
  let v = x >>> 0;
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export function hammingDistance64(aHi: number, aLo: number, bHi: number, bLo: number): number {
  return popcount32(aHi ^ bHi) + popcount32(aLo ^ bLo);
}

function hasSimilarAspectRatio(w1: number, h1: number, w2: number, h2: number): boolean {
  if (w1 <= 0 || h1 <= 0 || w2 <= 0 || h2 <= 0) return true;
  const r1 = w1 / h1;
  const r2 = w2 / h2;
  const maxR = Math.max(r1, r2);
  const minR = Math.min(r1, r2);
  return (maxR - minR) / maxR <= ASPECT_RATIO_TOLERANCE;
}

/**
 * Metric-space BK-Tree for fast sub-quadratic Hamming distance range queries.
 */
interface BKNode {
  hi: number;
  lo: number;
  indices: number[];
  children: Map<number, BKNode>;
}

class BKTree {
  private root: BKNode | null = null;

  insert(hi: number, lo: number, itemIndex: number): void {
    if (!this.root) {
      this.root = { hi, lo, indices: [itemIndex], children: new Map() };
      return;
    }

    let node = this.root;
    while (true) {
      const dist = hammingDistance64(hi, lo, node.hi, node.lo);
      if (dist === 0) {
        node.indices.push(itemIndex);
        return;
      }
      const next = node.children.get(dist);
      if (!next) {
        node.children.set(dist, { hi, lo, indices: [itemIndex], children: new Map() });
        return;
      }
      node = next;
    }
  }

  query(hi: number, lo: number, maxDist: number): number[] {
    if (!this.root) return [];
    const matches: number[] = [];
    const stack: BKNode[] = [this.root];

    while (stack.length > 0) {
      const node = stack.pop()!;
      const dist = hammingDistance64(hi, lo, node.hi, node.lo);
      if (dist <= maxDist) {
        for (const idx of node.indices) {
          matches.push(idx);
        }
      }
      const low = Math.max(1, dist - maxDist);
      const high = dist + maxDist;
      for (const [edgeDist, child] of node.children.entries()) {
        if (edgeDist >= low && edgeDist <= high) {
          stack.push(child);
        }
      }
    }

    return matches;
  }
}

class UnionFind {
  private parent: Int32Array;
  private rank: Uint8Array;

  constructor(size: number) {
    this.parent = new Int32Array(size);
    this.rank = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      this.parent[i] = i;
    }
  }

  find(x: number): number {
    let root = x;
    while (this.parent[root] !== root) {
      root = this.parent[root];
    }
    let curr = x;
    while (curr !== root) {
      const next = this.parent[curr];
      this.parent[curr] = root;
      curr = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    if (this.rank[ra] < this.rank[rb]) {
      this.parent[ra] = rb;
    } else if (this.rank[ra] > this.rank[rb]) {
      this.parent[rb] = ra;
    } else {
      this.parent[rb] = ra;
      this.rank[ra]++;
    }
  }
}

export interface DuplicateGroupItem {
  id: string;
  sha256: string;
  filename: string;
  file_path: string;
  folderName: string;
  sourceType: 'upload' | 'mount';
  mountId: string | null;
  mountName: string;
  mediaType: 'image' | 'video';
  mimeType: string;
  width: number;
  height: number;
  size_bytes: number;
  durationSec: number | null;
  taken_at: string;
  created_at: string;
  camera: string | null;
  cameraMake: string | null;
  cameraModel: string | null;
  lensModel: string | null;
  focalLength: string | null;
  aperture: string | null;
  shutterSpeed: string | null;
  iso: number | null;
  gpsLat: number | null;
  gpsLng: number | null;
  locationName: string | null;
  is_favorite: boolean;
  isShared: boolean;
  albumCount: number;
  dominantColor: string;
  thumb400Url: string;
  thumb1600Url: string;
  originalUrl: string;
}

export interface DuplicateGroup {
  id: string;
  suggestedKeepId: string;
  items: DuplicateGroupItem[];
}

export interface DuplicateScanStatus {
  state: DuplicateScanState;
  processed: number;
  total: number;
  groupCount: number;
  removableCount: number;
  removableBytes: number;
  sensitivity: DuplicateSensitivity;
  lastScanAt: string | null;
  error: string | null;
}

function hasExifOrGps(row: MediaRow): boolean {
  return Boolean(
    row.camera_make ||
      row.camera_model ||
      row.lens_model ||
      row.focal_length ||
      row.aperture ||
      row.shutter_speed ||
      row.iso !== null ||
      (row.gps_lat !== null && row.gps_lng !== null)
  );
}

/**
 * Ranks copies in descending keeper priority:
 * 1. Actively shared copy (protects active public shares / shared albums)
 * 2. Highest resolution (width * height)
 * 3. Largest file size (size_bytes)
 * 4. Has EXIF / camera / GPS metadata
 * 5. Favorited
 * 6. Oldest created_at
 * 7. Deterministic id tie-breaker
 */
function compareKeeperPriority(
  a: { row: MediaRow; isShared: boolean },
  b: { row: MediaRow; isShared: boolean }
): number {
  if (a.isShared !== b.isShared) return a.isShared ? -1 : 1;

  const pixelsA = (a.row.width || 0) * (a.row.height || 0);
  const pixelsB = (b.row.width || 0) * (b.row.height || 0);
  if (pixelsA !== pixelsB) return pixelsB - pixelsA;

  if (a.row.size_bytes !== b.row.size_bytes) return b.row.size_bytes - a.row.size_bytes;

  const exifA = hasExifOrGps(a.row) ? 1 : 0;
  const exifB = hasExifOrGps(b.row) ? 1 : 0;
  if (exifA !== exifB) return exifB - exifA;

  if (a.row.is_favorite !== b.row.is_favorite) return b.row.is_favorite - a.row.is_favorite;

  const createdCmp = a.row.created_at.localeCompare(b.row.created_at);
  if (createdCmp !== 0) return createdCmp;

  return a.row.id.localeCompare(b.row.id);
}

function getActiveSharedMediaIds(): Set<string> {
  const nowMs = Date.now();
  const shares = db
    .prepare('SELECT target_type, target_id, expires_at FROM shares')
    .all() as Array<{ target_type: 'media' | 'album'; target_id: string; expires_at: string | null }>;

  const sharedMediaIds = new Set<string>();
  const sharedAlbumIds: string[] = [];

  for (const s of shares) {
    if (s.expires_at) {
      const exp = new Date(s.expires_at).getTime();
      if (Number.isFinite(exp) && exp <= nowMs) continue;
    }
    if (s.target_type === 'media') {
      sharedMediaIds.add(s.target_id);
    } else if (s.target_type === 'album') {
      sharedAlbumIds.push(s.target_id);
    }
  }

  if (sharedAlbumIds.length > 0) {
    const stmt = db.prepare('SELECT media_id FROM album_media WHERE album_id = ?');
    for (const albumId of sharedAlbumIds) {
      const rows = stmt.all(albumId) as Array<{ media_id: string }>;
      for (const r of rows) {
        sharedMediaIds.add(r.media_id);
      }
    }
  }

  return sharedMediaIds;
}

function getAlbumCountMap(): Map<string, number> {
  const rows = db
    .prepare('SELECT media_id, COUNT(*) as count FROM album_media GROUP BY media_id')
    .all() as Array<{ media_id: string; count: number }>;
  return new Map(rows.map((r) => [r.media_id, r.count]));
}

function getMountInfoMap(): Map<string, { name: string; path: string }> {
  const rows = db
    .prepare('SELECT id, name, path FROM mounts')
    .all() as Array<{ id: string; name: string; path: string }>;
  return new Map(rows.map((r) => [r.id, { name: r.name, path: r.path }]));
}

function deriveDisplayFolder(row: MediaRow, mountInfo?: { name: string; path: string }): string {
  if (row.source_type === 'mount' && mountInfo) {
    const relDir = path.dirname(path.relative(mountInfo.path, row.file_path));
    if (relDir && relDir !== '.' && !relDir.startsWith('..')) {
      return `${mountInfo.name} / ${relDir}`;
    }
    return mountInfo.name;
  }
  return 'Local Uploads';
}

export function computeDuplicateGroups(sensitivity: DuplicateSensitivity): DuplicateGroup[] {
  const threshold = SENSITIVITY_THRESHOLDS[sensitivity];
  const rows = db
    .prepare('SELECT * FROM media WHERE is_trashed = 0')
    .all() as MediaRow[];

  if (rows.length < 2) return [];

  const uf = new UnionFind(rows.length);

  // 1. Visual perceptual-hash grouping for images via BK-Tree
  const imageTree = new BKTree();
  const parsedImages: Array<{ index: number; hi: number; lo: number; row: MediaRow }> = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.media_type !== 'image' || !row.phash) continue;
    const parsed = parseHexHash64(row.phash);
    if (!parsed) continue;
    parsedImages.push({ index: i, hi: parsed.hi, lo: parsed.lo, row });
    imageTree.insert(parsed.hi, parsed.lo, i);
  }

  for (const entry of parsedImages) {
    const candidates = imageTree.query(entry.hi, entry.lo, threshold);
    for (const candidateIdx of candidates) {
      if (candidateIdx <= entry.index) continue;
      const other = rows[candidateIdx];
      if (!hasSimilarAspectRatio(entry.row.width, entry.row.height, other.width, other.height)) {
        continue;
      }
      uf.union(entry.index, candidateIdx);
    }
  }

  // 2. Exact-metadata grouping for videos: duration within 1s AND identical size_bytes AND identical taken_at
  const videoBuckets = new Map<string, number[]>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.media_type !== 'video') continue;
    if (row.duration_sec === null || row.size_bytes <= 0 || !row.taken_at) continue;
    const key = `${row.size_bytes}|${row.taken_at}`;
    const list = videoBuckets.get(key);
    if (list) list.push(i);
    else videoBuckets.set(key, [i]);
  }

  for (const indices of videoBuckets.values()) {
    if (indices.length < 2) continue;
    for (let a = 0; a < indices.length; a++) {
      const rowA = rows[indices[a]];
      for (let b = a + 1; b < indices.length; b++) {
        const rowB = rows[indices[b]];
        if (
          rowA.duration_sec !== null &&
          rowB.duration_sec !== null &&
          Math.abs(rowA.duration_sec - rowB.duration_sec) <= 1.0
        ) {
          uf.union(indices[a], indices[b]);
        }
      }
    }
  }

  // 3. Collect connected components with >= 2 items
  const components = new Map<number, MediaRow[]>();
  for (let i = 0; i < rows.length; i++) {
    const root = uf.find(i);
    const list = components.get(root);
    if (list) list.push(rows[i]);
    else components.set(root, [rows[i]]);
  }

  const sharedIds = getActiveSharedMediaIds();
  const albumCounts = getAlbumCountMap();
  const mountInfoMap = getMountInfoMap();

  const groups: DuplicateGroup[] = [];

  for (const componentRows of components.values()) {
    if (componentRows.length < 2) continue;

    const ranked = componentRows
      .map((row) => ({ row, isShared: sharedIds.has(row.id) }))
      .sort(compareKeeperPriority)
      .slice(0, MAX_GROUP_SIZE);

    const suggestedKeepId = ranked[0].row.id;
    const stableId = `dup-${sha256Hex(ranked.map((r) => r.row.id).sort().join(',')).slice(0, 12)}`;

    const items: DuplicateGroupItem[] = ranked.map(({ row, isShared }) => {
      const mountInfo = row.mount_id ? mountInfoMap.get(row.mount_id) : undefined;
      const camera = [row.camera_make, row.camera_model].filter(Boolean).join(' ').trim() || null;

      return {
        id: row.id,
        sha256: row.sha256,
        filename: row.filename,
        file_path: row.file_path,
        folderName: deriveDisplayFolder(row, mountInfo),
        sourceType: row.source_type,
        mountId: row.mount_id,
        mountName: mountInfo?.name ?? (row.mount_id ? 'External Mount' : 'Local Uploads'),
        mediaType: row.media_type,
        mimeType: row.mime_type,
        width: row.width,
        height: row.height,
        size_bytes: row.size_bytes,
        durationSec: row.duration_sec,
        taken_at: row.taken_at,
        created_at: row.created_at,
        camera,
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
        is_favorite: Boolean(row.is_favorite),
        isShared,
        albumCount: albumCounts.get(row.id) ?? 0,
        dominantColor: row.dominant_color || '#1e293b',
        thumb400Url: `/api/media/${row.id}/thumb/400`,
        thumb1600Url: `/api/media/${row.id}/thumb/1600`,
        originalUrl: `/api/media/${row.id}/original`,
      };
    });

    groups.push({ id: stableId, suggestedKeepId, items });
  }

  // Sort groups by recoverable bytes descending, then latest taken_at descending
  groups.sort((a, b) => {
    const bytesA = a.items.slice(1).reduce((sum, item) => sum + item.size_bytes, 0);
    const bytesB = b.items.slice(1).reduce((sum, item) => sum + item.size_bytes, 0);
    if (bytesA !== bytesB) return bytesB - bytesA;
    return b.items[0].taken_at.localeCompare(a.items[0].taken_at);
  });

  return groups;
}

export function summarizeGroups(groups: DuplicateGroup[]): {
  groupCount: number;
  removableCount: number;
  removableBytes: number;
} {
  let removableCount = 0;
  let removableBytes = 0;
  for (const g of groups) {
    for (const item of g.items) {
      if (item.id !== g.suggestedKeepId) {
        removableCount++;
        removableBytes += item.size_bytes;
      }
    }
  }
  return {
    groupCount: groups.length,
    removableCount,
    removableBytes,
  };
}

// ============================================================================
// BACKGROUND BACKFILL JOB (Concurrency = 2, Non-Blocking)
// ============================================================================

interface BackfillRow {
  id: string;
  file_path: string;
  source_type: 'upload' | 'mount';
  mount_id: string | null;
  thumb_400: string | null;
}

let scanState: DuplicateScanState = 'idle';
let scanProcessed = 0;
let scanTotal = 0;
let scanSensitivity: DuplicateSensitivity = 'similar';
let lastScanAt: string | null = null;
let lastScanError: string | null = null;
let activeScanPromise: Promise<void> | null = null;

function resolveReadableImagePath(row: BackfillRow, mountPathMap: Map<string, string>): string | null {
  // Prefer existing 400px thumbnail for fast, low-I/O perceptual hashing
  if (row.thumb_400) {
    try {
      const safeThumb = assertSafePathWithin(row.thumb_400, config.thumbsDir);
      if (fs.existsSync(safeThumb)) return safeThumb;
    } catch {
      // Fall through to original
    }
  }

  // Fall back to permitted original image if thumbnail is missing
  try {
    if (row.source_type === 'upload') {
      const safeOrig = assertSafePathWithin(row.file_path, config.uploadDir);
      if (fs.existsSync(safeOrig)) return safeOrig;
    } else if (row.mount_id) {
      const mountPath = mountPathMap.get(row.mount_id);
      if (mountPath) {
        const safeOrig = assertSafePathWithin(row.file_path, mountPath);
        if (fs.existsSync(safeOrig)) return safeOrig;
      }
    }
  } catch {
    return null;
  }

  return null;
}

const updatePhashStmt = db.prepare('UPDATE media SET phash = ? WHERE id = ?');

async function runBackfillAndScan(sensitivity: DuplicateSensitivity): Promise<void> {
  scanState = 'scanning';
  scanSensitivity = sensitivity;
  lastScanError = null;

  try {
    const totalImagesRow = db
      .prepare("SELECT COUNT(*) as count FROM media WHERE is_trashed = 0 AND media_type = 'image'")
      .get() as { count: number };
    const missingRows = db
      .prepare(
        "SELECT id, file_path, source_type, mount_id, thumb_400 FROM media WHERE is_trashed = 0 AND media_type = 'image' AND phash IS NULL"
      )
      .all() as BackfillRow[];

    scanTotal = totalImagesRow.count;
    scanProcessed = Math.max(0, totalImagesRow.count - missingRows.length);

    if (missingRows.length > 0) {
      const mountRows = db.prepare('SELECT id, path FROM mounts').all() as Array<{ id: string; path: string }>;
      const mountPathMap = new Map(mountRows.map((m) => [m.id, m.path]));

      let cursor = 0;
      const worker = async () => {
        while (cursor < missingRows.length) {
          const idx = cursor++;
          const row = missingRows[idx];
          try {
            const targetPath = resolveReadableImagePath(row, mountPathMap);
            if (targetPath) {
              const hash = await computeImageDHash(targetPath);
              if (hash) {
                updatePhashStmt.run(hash, row.id);
              }
            }
          } catch (err) {
            console.warn(`Duplicate backfill skipped media ${row.id}:`, err);
          } finally {
            scanProcessed = Math.min(scanTotal, scanProcessed + 1);
          }
          // Yield to event loop so API/UI requests stay responsive
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      };

      const workerCount = Math.min(BACKFILL_CONCURRENCY, missingRows.length);
      await Promise.all(Array.from({ length: workerCount }, () => worker()));
    }

    lastScanAt = new Date().toISOString();
    scanState = 'ready';
  } catch (err) {
    console.error('Duplicate scan failed:', err);
    lastScanError = err instanceof Error ? err.message : 'Duplicate scan failed';
    scanState = 'error';
  }
}

export function startDuplicateScan(sensitivity: DuplicateSensitivity): DuplicateScanStatus {
  scanSensitivity = sensitivity;
  if (!activeScanPromise) {
    const promise = runBackfillAndScan(sensitivity);
    activeScanPromise = promise;
    void promise.finally(() => {
      if (activeScanPromise === promise) {
        activeScanPromise = null;
      }
    });
  }
  return getDuplicateScanStatus(sensitivity);
}

export function getDuplicateScanStatus(requestedSensitivity?: DuplicateSensitivity): DuplicateScanStatus {
  const effectiveSensitivity = requestedSensitivity ?? scanSensitivity;

  if (scanState === 'scanning') {
    const groups = computeDuplicateGroups(effectiveSensitivity);
    const summary = summarizeGroups(groups);
    return {
      state: 'scanning',
      processed: scanProcessed,
      total: scanTotal,
      groupCount: summary.groupCount,
      removableCount: summary.removableCount,
      removableBytes: summary.removableBytes,
      sensitivity: effectiveSensitivity,
      lastScanAt,
      error: null,
    };
  }

  const totalImagesRow = db
    .prepare("SELECT COUNT(*) as count FROM media WHERE is_trashed = 0 AND media_type = 'image'")
    .get() as { count: number };
  const hashedImagesRow = db
    .prepare("SELECT COUNT(*) as count FROM media WHERE is_trashed = 0 AND media_type = 'image' AND phash IS NOT NULL")
    .get() as { count: number };

  const groups = computeDuplicateGroups(effectiveSensitivity);
  const summary = summarizeGroups(groups);

  return {
    state: scanState,
    processed: hashedImagesRow.count,
    total: totalImagesRow.count,
    groupCount: summary.groupCount,
    removableCount: summary.removableCount,
    removableBytes: summary.removableBytes,
    sensitivity: effectiveSensitivity,
    lastScanAt,
    error: lastScanError,
  };
}

// ============================================================================
// SAFE TRASH RESOLUTION (Transfer Albums + Favorite, Soft-Trash Only)
// ============================================================================

const transferAlbumsStmt = db.prepare(`
  INSERT OR IGNORE INTO album_media (album_id, media_id, added_at)
  SELECT album_id, ?, ? FROM album_media WHERE media_id = ?
`);
const findAlbumsForMediaStmt = db.prepare('SELECT album_id FROM album_media WHERE media_id = ?');
const touchAlbumStmt = db.prepare('UPDATE albums SET updated_at = ? WHERE id = ?');
const markFavoriteStmt = db.prepare('UPDATE media SET is_favorite = 1 WHERE id = ?');
const softTrashStmt = db.prepare('UPDATE media SET is_trashed = 1, trashed_at = ? WHERE id = ?');

export function resolveDuplicateGroup(params: {
  keepId: string;
  trashIds: string[];
  sensitivity: DuplicateSensitivity;
}): {
  keepId: string;
  trashedIds: string[];
  trashedCount: number;
  freedBytes: number;
} {
  const { keepId, sensitivity } = params;
  const uniqueTrashIds = Array.from(new Set(params.trashIds.filter((id) => typeof id === 'string' && id.trim() !== '')));

  if (!keepId || typeof keepId !== 'string') {
    throw new Error('keepId is required');
  }
  if (uniqueTrashIds.length === 0) {
    throw new Error('At least one trashId is required');
  }
  if (uniqueTrashIds.includes(keepId)) {
    throw new Error('keepId cannot be included in trashIds');
  }

  // Validate that keepId and all trashIds belong to the exact same active duplicate group
  const groups = computeDuplicateGroups(sensitivity);
  const matchingGroup = groups.find((g) => g.items.some((item) => item.id === keepId));
  if (!matchingGroup) {
    throw new Error('keepId does not belong to any active duplicate group');
  }

  const groupItemMap = new Map(matchingGroup.items.map((item) => [item.id, item]));
  for (const tid of uniqueTrashIds) {
    if (!groupItemMap.has(tid)) {
      throw new Error('All trashIds must belong to the same duplicate group as keepId');
    }
  }

  // Safety guarantee: at least one item in the group must remain un-trashed
  if (uniqueTrashIds.length >= matchingGroup.items.length) {
    throw new Error('Cannot move every copy in a duplicate group to Trash');
  }

  const now = new Date().toISOString();
  let freedBytes = 0;

  const runTx = db.transaction(() => {
    for (const tid of uniqueTrashIds) {
      const item = groupItemMap.get(tid)!;

      // Transfer album memberships to keepId before trashing
      const affectedAlbums = findAlbumsForMediaStmt.all(tid) as Array<{ album_id: string }>;
      if (affectedAlbums.length > 0) {
        transferAlbumsStmt.run(keepId, now, tid);
        for (const a of affectedAlbums) {
          touchAlbumStmt.run(now, a.album_id);
        }
      }

      // Preserve favorite status on the kept copy
      if (item.is_favorite) {
        markFavoriteStmt.run(keepId);
      }

      // Soft-trash only (never delete files from disk)
      softTrashStmt.run(now, tid);
      freedBytes += item.size_bytes;
    }
  });

  runTx();

  return {
    keepId,
    trashedIds: uniqueTrashIds,
    trashedCount: uniqueTrashIds.length,
    freedBytes,
  };
}

export function resolveAllDuplicateGroups(sensitivity: DuplicateSensitivity): {
  groups: number;
  trashedCount: number;
  freedBytes: number;
  trashedIds: string[];
} {
  const groups = computeDuplicateGroups(sensitivity);
  const now = new Date().toISOString();
  let resolvedGroups = 0;
  let freedBytes = 0;
  const trashedIds: string[] = [];

  const runTx = db.transaction(() => {
    for (const group of groups) {
      if (group.items.length < 2) continue;
      const keepId = group.suggestedKeepId;
      if (!group.items.some((i) => i.id === keepId)) continue;

      const toTrash = group.items.filter((i) => i.id !== keepId);
      if (toTrash.length === 0 || toTrash.length >= group.items.length) continue;

      resolvedGroups++;
      for (const item of toTrash) {
        const affectedAlbums = findAlbumsForMediaStmt.all(item.id) as Array<{ album_id: string }>;
        if (affectedAlbums.length > 0) {
          transferAlbumsStmt.run(keepId, now, item.id);
          for (const a of affectedAlbums) {
            touchAlbumStmt.run(now, a.album_id);
          }
        }
        if (item.is_favorite) {
          markFavoriteStmt.run(keepId);
        }
        softTrashStmt.run(now, item.id);
        trashedIds.push(item.id);
        freedBytes += item.size_bytes;
      }
    }
  });

  runTx();

  return {
    groups: resolvedGroups,
    trashedCount: trashedIds.length,
    freedBytes,
    trashedIds,
  };
}
