import Database from 'better-sqlite3';
import { config, ensureStorageDirectories } from './config.ts';

ensureStorageDirectories();

export const db = new Database(config.dbPath);

// Configure high-concurrency local NVMe SQLite WAL mode
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS mounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    is_readonly INTEGER NOT NULL DEFAULT 1,
    is_watching INTEGER NOT NULL DEFAULT 1,
    file_count INTEGER NOT NULL DEFAULT 0,
    last_scan_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY,
    sha256 TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK(source_type IN ('upload', 'mount')),
    mount_id TEXT REFERENCES mounts(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    media_type TEXT NOT NULL CHECK(media_type IN ('image', 'video')),
    size_bytes INTEGER NOT NULL DEFAULT 0,
    width INTEGER NOT NULL DEFAULT 1600,
    height INTEGER NOT NULL DEFAULT 1200,
    duration_sec REAL,
    taken_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    camera_make TEXT,
    camera_model TEXT,
    lens_model TEXT,
    focal_length TEXT,
    aperture TEXT,
    shutter_speed TEXT,
    iso INTEGER,
    gps_lat REAL,
    gps_lng REAL,
    location_name TEXT,
    is_favorite INTEGER NOT NULL DEFAULT 0,
    is_trashed INTEGER NOT NULL DEFAULT 0,
    trashed_at TEXT,
    thumb_400 TEXT,
    thumb_1600 TEXT,
    dominant_color TEXT DEFAULT '#1e293b'
  );

  CREATE TABLE IF NOT EXISTS albums (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    cover_media_id TEXT REFERENCES media(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS album_media (
    album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    added_at TEXT NOT NULL,
    PRIMARY KEY (album_id, media_id)
  );

  CREATE TABLE IF NOT EXISTS shares (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    target_type TEXT NOT NULL CHECK(target_type IN ('media', 'album')),
    target_id TEXT NOT NULL,
    title TEXT,
    password_hash TEXT,
    password_salt TEXT,
    expires_at TEXT,
    allow_download INTEGER NOT NULL DEFAULT 1,
    view_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sync_tokens (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    token_prefix TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    last_used_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS deleted_hashes (
    sha256 TEXT PRIMARY KEY,
    deleted_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_media_taken_at ON media(taken_at DESC);
  CREATE INDEX IF NOT EXISTS idx_media_trashed ON media(is_trashed, taken_at DESC);
  CREATE INDEX IF NOT EXISTS idx_media_favorite ON media(is_favorite, is_trashed, taken_at DESC);
  CREATE INDEX IF NOT EXISTS idx_media_mount ON media(mount_id);
  CREATE INDEX IF NOT EXISTS idx_media_location ON media(location_name);
`);

// Safe, idempotent migration for perceptual hash column on existing databases
const mediaColumns = db.prepare('PRAGMA table_info(media)').all() as Array<{ name: string }>;
if (!mediaColumns.some((col) => col.name === 'phash')) {
  db.exec('ALTER TABLE media ADD COLUMN phash TEXT');
}
db.exec('CREATE INDEX IF NOT EXISTS idx_media_phash ON media(phash)');

export interface MediaRow {
  id: string;
  sha256: string;
  filename: string;
  source_type: 'upload' | 'mount';
  mount_id: string | null;
  file_path: string;
  mime_type: string;
  media_type: 'image' | 'video';
  size_bytes: number;
  width: number;
  height: number;
  duration_sec: number | null;
  taken_at: string;
  created_at: string;
  camera_make: string | null;
  camera_model: string | null;
  lens_model: string | null;
  focal_length: string | null;
  aperture: string | null;
  shutter_speed: string | null;
  iso: number | null;
  gps_lat: number | null;
  gps_lng: number | null;
  location_name: string | null;
  is_favorite: number;
  is_trashed: number;
  trashed_at: string | null;
  thumb_400: string | null;
  thumb_1600: string | null;
  dominant_color: string | null;
  phash: string | null;
}

export interface MountRow {
  id: string;
  name: string;
  path: string;
  is_readonly: number;
  is_watching: number;
  file_count: number;
  last_scan_at: string | null;
  created_at: string;
}

export interface AlbumRow {
  id: string;
  title: string;
  description: string;
  cover_media_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShareRow {
  id: string;
  token: string;
  target_type: 'media' | 'album';
  target_id: string;
  title: string | null;
  password_hash: string | null;
  password_salt: string | null;
  expires_at: string | null;
  allow_download: number;
  view_count: number;
  created_at: string;
}

export interface SyncTokenRow {
  id: string;
  label: string;
  token_prefix: string;
  token_hash: string;
  last_used_at: string | null;
  created_at: string;
}
