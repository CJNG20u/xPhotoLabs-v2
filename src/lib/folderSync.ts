import type { FolderSyncProgress } from '../types';
import { syncCheckHashes, uploadFiles } from './api';

const IDB_NAME = 'xphotolabs-sync-db';
const IDB_STORE = 'handles';
const HANDLE_KEY = 'primary-sync-dir';
const AUTO_SYNC_PREF_KEY = 'xphotolabs_auto_sync_on_open';

const SUPPORTED_EXT = /\.(jpe?g|png|webp|gif|heic|heif|avif|tiff?|bmp|mp4|mov|webm|mkv|m4v|avi|3gp)$/i;

interface DirectoryHandleWithPermission extends FileSystemDirectoryHandle {
  queryPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<'granted' | 'denied' | 'prompt'>;
}

declare global {
  interface Window {
    showDirectoryPicker?: (options?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
  }
}

export function supportsDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export function getAutoSyncOnOpenPref(): boolean {
  try {
    return localStorage.getItem(AUTO_SYNC_PREF_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function setAutoSyncOnOpenPref(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_SYNC_PREF_KEY, enabled ? 'true' : 'false');
  } catch {
    // ignore storage errors
  }
}

function openSyncDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openSyncDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadSavedDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const db = await openSyncDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(HANDLE_KEY);
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function clearSavedDirectoryHandle(): Promise<void> {
  const db = await openSyncDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function queryDirectoryPermission(
  handle: FileSystemDirectoryHandle
): Promise<'granted' | 'denied' | 'prompt'> {
  const h = handle as DirectoryHandleWithPermission;
  if (typeof h.queryPermission === 'function') {
    return h.queryPermission({ mode: 'read' });
  }
  return 'granted';
}

export async function ensureDirectoryPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const h = handle as DirectoryHandleWithPermission;
  if (typeof h.queryPermission === 'function') {
    const status = await h.queryPermission({ mode: 'read' });
    if (status === 'granted') return true;
  }
  if (typeof h.requestPermission === 'function') {
    const status = await h.requestPermission({ mode: 'read' });
    return status === 'granted';
  }
  return true;
}

export async function hashFileSha256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function collectFilesFromDirectory(
  dirHandle: FileSystemDirectoryHandle,
  maxDepth = 5,
  depth = 0,
  out: File[] = []
): Promise<File[]> {
  if (depth > maxDepth) return out;
  const h = dirHandle as DirectoryHandleWithPermission;
  if (typeof h.values !== 'function') return out;

  for await (const entry of h.values()) {
    if (entry.name.startsWith('.')) continue;
    if (entry.kind === 'file') {
      if (SUPPORTED_EXT.test(entry.name)) {
        const fileHandle = entry as FileSystemFileHandle;
        try {
          out.push(await fileHandle.getFile());
        } catch {
          // skip unreadable file
        }
      }
    } else if (entry.kind === 'directory') {
      await collectFilesFromDirectory(entry as FileSystemDirectoryHandle, maxDepth, depth + 1, out);
    }
  }
  return out;
}

export async function runDeduplicatedFileSync(
  files: File[],
  folderName: string,
  onProgress: (progress: FolderSyncProgress) => void
): Promise<FolderSyncProgress> {
  const supported = files.filter((f) => SUPPORTED_EXT.test(f.name));
  if (supported.length === 0) {
    const done: FolderSyncProgress = {
      phase: 'done',
      folderName,
      totalFiles: 0,
      processedFiles: 0,
      uploadedCount: 0,
      skippedCount: 0,
      errorCount: 0,
      message: `No supported photos or videos found in "${folderName}".`,
    };
    onProgress(done);
    return done;
  }

  onProgress({
    phase: 'hashing',
    folderName,
    totalFiles: supported.length,
    processedFiles: 0,
    uploadedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    message: `Computing SHA-256 fingerprints for ${supported.length} files…`,
  });

  const hashedFiles: Array<{ file: File; sha256: string }> = [];
  for (let i = 0; i < supported.length; i++) {
    const file = supported[i];
    const sha256 = await hashFileSha256(file);
    hashedFiles.push({ file, sha256 });
    if (i % 4 === 0 || i === supported.length - 1) {
      onProgress({
        phase: 'hashing',
        folderName,
        totalFiles: supported.length,
        processedFiles: i + 1,
        uploadedCount: 0,
        skippedCount: 0,
        errorCount: 0,
        message: `Hashing ${i + 1} of ${supported.length} files…`,
      });
    }
  }

  onProgress({
    phase: 'checking',
    folderName,
    totalFiles: supported.length,
    processedFiles: supported.length,
    uploadedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    message: 'Checking server for existing hashes…',
  });

  const checkResult = await syncCheckHashes(
    hashedFiles.map((item) => ({
      sha256: item.sha256,
      filename: item.file.name,
      size: item.file.size,
    }))
  );

  const missingHashSet = new Set(checkResult.missingHashes);
  const toUpload = hashedFiles.filter((item) => missingHashSet.has(item.sha256)).map((item) => item.file);
  const skippedCount = supported.length - toUpload.length;

  let uploadedCount = 0;
  let errorCount = 0;

  if (toUpload.length > 0) {
    const BATCH_SIZE = 5;
    for (let i = 0; i < toUpload.length; i += BATCH_SIZE) {
      const batch = toUpload.slice(i, i + BATCH_SIZE);
      onProgress({
        phase: 'uploading',
        folderName,
        totalFiles: toUpload.length,
        processedFiles: i,
        uploadedCount,
        skippedCount,
        errorCount,
        message: `Uploading ${i + 1}–${Math.min(i + batch.length, toUpload.length)} of ${toUpload.length} new files…`,
      });
      try {
        const res = await uploadFiles(batch);
        uploadedCount += res.uploaded.length;
        errorCount += res.errors.length;
      } catch {
        errorCount += batch.length;
      }
    }
  }

  const finalProgress: FolderSyncProgress = {
    phase: 'done',
    folderName,
    totalFiles: supported.length,
    processedFiles: supported.length,
    uploadedCount,
    skippedCount,
    errorCount,
    message:
      uploadedCount > 0
        ? `Synced ${uploadedCount} new ${uploadedCount === 1 ? 'file' : 'files'} (${skippedCount} already backed up).`
        : `All ${skippedCount} files in "${folderName}" are already synced.`,
  };
  onProgress(finalProgress);
  return finalProgress;
}

export async function syncDirectoryHandle(
  handle: FileSystemDirectoryHandle,
  onProgress: (progress: FolderSyncProgress) => void
): Promise<FolderSyncProgress> {
  onProgress({
    phase: 'scanning',
    folderName: handle.name,
    totalFiles: 0,
    processedFiles: 0,
    uploadedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    message: `Scanning "${handle.name}"…`,
  });

  const files = await collectFilesFromDirectory(handle);
  return runDeduplicatedFileSync(files, handle.name, onProgress);
}
