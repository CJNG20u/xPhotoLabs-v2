import type {
  AlbumSummary,
  DuplicateScanStatus,
  DuplicateSensitivity,
  DuplicatesResponse,
  MediaItem,
  PlaceCluster,
  ShareLinkItem,
  StorageMount,
  StorageOverview,
  SyncTokenItem,
} from '../types';

export const AUTH_REQUIRED_EVENT = 'xphotolabs-auth-required';

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    // An expired or revoked session returns AUTH_REQUIRED: send the user back to the sign-in screen.
    // (Wrong-password answers use a different code and are shown by their own form.)
    if (res.status === 401 && errBody.code === 'AUTH_REQUIRED' && typeof window !== 'undefined') {
      window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
    }
    throw new Error(errBody.error || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/** Removes cached thumbnails so a signed-out shared device doesn't keep showing your photos offline. */
export async function clearPrivateCaches(): Promise<void> {
  try {
    if (typeof caches === 'undefined') return;
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('xphotolabs-thumbs')).map((k) => caches.delete(k)));
  } catch {
    // best effort
  }
}

export interface AuthStatus {
  authEnabled: boolean;
  setupRequired: boolean;
  authenticated: boolean;
  username: string | null;
  minPasswordLength: number;
}

export function fetchAuthStatus(): Promise<AuthStatus> {
  return apiJson<AuthStatus>('/api/auth/status');
}

export function loginRequest(username: string, password: string): Promise<AuthStatus> {
  return apiJson<AuthStatus>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

export function setupAccountRequest(username: string, password: string): Promise<AuthStatus> {
  return apiJson<AuthStatus>('/api/auth/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

export function logoutRequest(): Promise<{ ok: boolean }> {
  return apiJson<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
}

export function logoutAllRequest(): Promise<{ ok: boolean; revoked: number }> {
  return apiJson<{ ok: boolean; revoked: number }>('/api/auth/logout-all', { method: 'POST' });
}

export function changePasswordRequest(
  currentPassword: string,
  newPassword: string
): Promise<{ ok: boolean; otherSessionsSignedOut: number }> {
  return apiJson('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export async function fetchMedia(params: {
  view?: 'photos' | 'favorites' | 'trash';
  q?: string;
  albumId?: string;
  place?: string;
  type?: '' | 'image' | 'video';
  mountId?: string;
}): Promise<{ items: MediaItem[]; total: number }> {
  const qs = new URLSearchParams();
  if (params.view) qs.set('view', params.view);
  if (params.q) qs.set('q', params.q);
  if (params.albumId) qs.set('albumId', params.albumId);
  if (params.place) qs.set('place', params.place);
  if (params.type) qs.set('type', params.type);
  if (params.mountId) qs.set('mountId', params.mountId);
  return apiJson(`/api/media?${qs.toString()}`);
}

export async function patchMedia(
  id: string,
  payload: { isFavorite?: boolean; isTrashed?: boolean; locationName?: string | null }
): Promise<MediaItem> {
  return apiJson(`/api/media/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function deleteMediaPermanently(
  id: string
): Promise<{ deleted: boolean; id: string; deletedFromDisk: boolean }> {
  return apiJson(`/api/media/${id}`, { method: 'DELETE' });
}

export async function batchMediaAction(payload: {
  ids: string[];
  action: 'favorite' | 'unfavorite' | 'trash' | 'restore' | 'delete' | 'addToAlbum';
  albumId?: string;
}): Promise<{ action: string; affected: number; deletedFromDiskCount?: number }> {
  return apiJson('/api/media/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function emptyTrash(): Promise<{ emptied: number; deletedFromDiskCount: number }> {
  return apiJson('/api/trash', { method: 'DELETE' });
}

export async function syncCheckHashes(
  files: Array<{ sha256: string; filename: string; size: number }>
): Promise<{
  checked: number;
  missing: Array<{ sha256: string; filename: string; size: number }>;
  existing: Array<{ sha256: string; filename: string; size: number }>;
  missingHashes: string[];
}> {
  return apiJson('/api/sync/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
  });
}

export async function uploadFiles(
  files: File[]
): Promise<{
  uploaded: MediaItem[];
  duplicates: Array<{ filename: string; sha256: string; mediaId: string }>;
  errors: Array<{ filename: string; error: string }>;
}> {
  const form = new FormData();
  for (const file of files) {
    form.append('file', file, file.name);
  }
  return apiJson('/api/upload', {
    method: 'POST',
    body: form,
  });
}

export async function fetchAlbums(): Promise<{ albums: AlbumSummary[] }> {
  return apiJson('/api/albums');
}

export async function createAlbum(payload: {
  title: string;
  description?: string;
  mediaIds?: string[];
}): Promise<AlbumSummary> {
  return apiJson('/api/albums', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function deleteAlbum(id: string): Promise<{ deleted: boolean }> {
  return apiJson(`/api/albums/${id}`, { method: 'DELETE' });
}

export async function addMediaToAlbum(albumId: string, mediaIds: string[]): Promise<{ added: number }> {
  return apiJson(`/api/albums/${albumId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mediaIds }),
  });
}

export async function removeMediaFromAlbum(albumId: string, mediaId: string): Promise<{ removed: boolean }> {
  return apiJson(`/api/albums/${albumId}/media/${mediaId}`, { method: 'DELETE' });
}

export async function fetchPlaces(): Promise<{ places: PlaceCluster[] }> {
  return apiJson('/api/places');
}

export async function fetchStorageOverview(): Promise<StorageOverview> {
  return apiJson('/api/storage/overview');
}

export async function fetchMounts(): Promise<{ mounts: StorageMount[] }> {
  return apiJson('/api/mounts');
}

export async function createMount(payload: {
  name: string;
  path: string;
  isWatching: boolean;
}): Promise<{
  mount: StorageMount;
  scanSummary: { scanned: number; added: number; skipped: number; errors: number };
}> {
  return apiJson('/api/mounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function rescanMount(
  id: string
): Promise<{ mountId: string; scanned: number; added: number; skipped: number; errors: number }> {
  return apiJson(`/api/mounts/${id}/scan`, { method: 'POST' });
}

export async function removeMount(id: string): Promise<{ removed: boolean; preservedSourceFiles: boolean }> {
  return apiJson(`/api/mounts/${id}`, { method: 'DELETE' });
}

export async function fetchShares(): Promise<{ shares: ShareLinkItem[] }> {
  return apiJson('/api/shares');
}

export async function createShareLink(payload: {
  targetType: 'media' | 'album';
  targetId: string;
  title?: string;
  password?: string;
  expiresInHours?: number | null;
  allowDownload?: boolean;
}): Promise<ShareLinkItem> {
  return apiJson('/api/shares', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function revokeShareLink(id: string): Promise<{ deleted: boolean }> {
  return apiJson(`/api/shares/${id}`, { method: 'DELETE' });
}

export async function fetchSyncTokens(): Promise<{ tokens: SyncTokenItem[]; hasEnvToken: boolean }> {
  return apiJson('/api/sync-tokens');
}

export async function createSyncToken(label: string): Promise<SyncTokenItem & { token: string }> {
  return apiJson('/api/sync-tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label }),
  });
}

export async function revokeSyncToken(id: string): Promise<{ deleted: boolean }> {
  return apiJson(`/api/sync-tokens/${id}`, { method: 'DELETE' });
}

export async function startDuplicatesScan(
  sensitivity: DuplicateSensitivity = 'similar'
): Promise<DuplicateScanStatus> {
  return apiJson('/api/duplicates/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sensitivity }),
  });
}

export async function fetchDuplicatesStatus(
  sensitivity?: DuplicateSensitivity
): Promise<DuplicateScanStatus> {
  const qs = sensitivity ? `?sensitivity=${encodeURIComponent(sensitivity)}` : '';
  return apiJson(`/api/duplicates/status${qs}`);
}

export async function fetchDuplicates(
  sensitivity: DuplicateSensitivity = 'similar'
): Promise<DuplicatesResponse> {
  return apiJson(`/api/duplicates?sensitivity=${encodeURIComponent(sensitivity)}`);
}

export async function resolveDuplicatesGroup(payload: {
  keepId: string;
  trashIds: string[];
  sensitivity: DuplicateSensitivity;
}): Promise<{ keepId: string; trashedIds: string[]; trashedCount: number; freedBytes: number }> {
  return apiJson('/api/duplicates/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function resolveAllDuplicates(
  sensitivity: DuplicateSensitivity
): Promise<{ groups: number; trashedCount: number; freedBytes: number; trashedIds: string[] }> {
  return apiJson('/api/duplicates/resolve-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sensitivity }),
  });
}
