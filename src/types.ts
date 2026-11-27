export type NavView = 'photos' | 'favorites' | 'albums' | 'places' | 'duplicates' | 'trash' | 'mounts';

export interface MediaItem {
  id: string;
  sha256: string;
  filename: string;
  sourceType: 'upload' | 'mount';
  mountId: string | null;
  mountName: string;
  mimeType: string;
  mediaType: 'image' | 'video';
  sizeBytes: number;
  width: number;
  height: number;
  durationSec: number | null;
  takenAt: string;
  createdAt: string;
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
  isFavorite: boolean;
  isTrashed: boolean;
  trashedAt: string | null;
  dominantColor: string;
  thumb400Url: string;
  thumb1600Url: string;
  originalUrl: string;
  albums?: Array<{ id: string; title: string }>;
}

export interface AlbumSummary {
  id: string;
  title: string;
  description: string;
  coverMediaId: string | null;
  coverUrl: string | null;
  previewUrls: string[];
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlaceCluster {
  name: string;
  lat: number | null;
  lng: number | null;
  count: number;
  latestTakenAt: string;
  coverUrl: string | null;
}

export interface StorageMount {
  id: string;
  name: string;
  path: string;
  isReadonly: boolean;
  isWatching: boolean;
  fileCount: number;
  lastScanAt: string | null;
  createdAt: string;
  existsOnDisk: boolean;
}

export interface StorageOverview {
  dataDir: string;
  uploadDir: string;
  sqliteMode: string;
  dbSizeBytes: number;
  thumbsSizeBytes: number;
  uploadsSizeBytes: number;
  indexedTotalBytes: number;
  totalCount: number;
  photoCount: number;
  videoCount: number;
  trashCount: number;
  hasEnvSyncToken: boolean;
}

export interface ShareLinkItem {
  id: string;
  token: string;
  targetType: 'media' | 'album';
  targetId: string;
  title: string | null;
  hasPassword: boolean;
  expiresAt: string | null;
  allowDownload: boolean;
  viewCount: number;
  createdAt: string;
  sharePath: string;
}

export interface SyncTokenItem {
  id: string;
  label: string;
  tokenPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface FolderSyncProgress {
  phase: 'idle' | 'scanning' | 'hashing' | 'checking' | 'uploading' | 'done' | 'error';
  folderName?: string;
  totalFiles: number;
  processedFiles: number;
  uploadedCount: number;
  skippedCount: number;
  errorCount: number;
  message: string;
}

export type DuplicateSensitivity = 'strict' | 'similar' | 'loose';

export interface DuplicateScanStatus {
  state: 'idle' | 'scanning' | 'ready' | 'error';
  processed: number;
  total: number;
  groupCount: number;
  removableCount: number;
  removableBytes: number;
  sensitivity: DuplicateSensitivity;
  lastScanAt: string | null;
  error: string | null;
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

export interface DuplicatesResponse {
  sensitivity: DuplicateSensitivity;
  state: 'idle' | 'scanning' | 'ready' | 'error';
  processed: number;
  total: number;
  lastScanAt: string | null;
  groupCount: number;
  removableCount: number;
  removableBytes: number;
  groups: DuplicateGroup[];
}
