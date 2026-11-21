import React, { useState } from 'react';
import {
  Check,
  Copy,
  FolderSync,
  HardDrive,
  KeyRound,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  Unlink,
} from 'lucide-react';
import type { FolderSyncProgress, StorageMount, StorageOverview, SyncTokenItem } from '../types';
import { createMount, createSyncToken, removeMount, rescanMount, revokeSyncToken } from '../lib/api';
import { formatBytes, formatFullTimestamp } from '../lib/format';
import { supportsDirectoryPicker } from '../lib/folderSync';

interface StorageMountsViewProps {
  overview: StorageOverview | null;
  mounts: StorageMount[];
  tokens: SyncTokenItem[];
  hasEnvToken: boolean;
  savedFolderName: string | null;
  autoSyncOnOpen: boolean;
  folderSyncProgress: FolderSyncProgress;
  onToggleAutoSyncOnOpen: (enabled: boolean) => void;
  onPickSyncFolder: () => void;
  onSyncNow: () => void;
  onDisconnectSyncFolder: () => void;
  onRefreshAll: () => void;
}

export const StorageMountsView: React.FC<StorageMountsViewProps> = ({
  overview,
  mounts,
  tokens,
  hasEnvToken,
  savedFolderName,
  autoSyncOnOpen,
  folderSyncProgress,
  onToggleAutoSyncOnOpen,
  onPickSyncFolder,
  onSyncNow,
  onDisconnectSyncFolder,
  onRefreshAll,
}) => {
  const [mountName, setMountName] = useState('');
  const [mountPath, setMountPath] = useState('');
  const [mountWatch, setMountWatch] = useState(true);
  const [mountBusy, setMountBusy] = useState(false);
  const [mountFeedback, setMountFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [scanningId, setScanningId] = useState<string | null>(null);

  const [tokenLabel, setTokenLabel] = useState('');
  const [newTokenSecret, setNewTokenSecret] = useState<string | null>(null);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copiedCurl, setCopiedCurl] = useState(false);

  const handleAddMount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mountPath.trim()) return;
    setMountBusy(true);
    setMountFeedback(null);
    try {
      const res = await createMount({
        name: mountName.trim() || 'External NAS',
        path: mountPath.trim(),
        isWatching: mountWatch,
      });
      setMountName('');
      setMountPath('');
      setMountFeedback({
        type: 'ok',
        text: `Mounted "${res.mount.name}" read-only — indexed ${res.scanSummary.added} new files (${res.scanSummary.skipped} skipped).`,
      });
      onRefreshAll();
    } catch (err) {
      setMountFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to mount external directory',
      });
    } finally {
      setMountBusy(false);
    }
  };

  const handleRescan = async (id: string) => {
    setScanningId(id);
    setMountFeedback(null);
    try {
      const res = await rescanMount(id);
      setMountFeedback({
        type: 'ok',
        text: `Scan complete: ${res.added} added, ${res.skipped} already indexed (${res.scanned} total checked).`,
      });
      onRefreshAll();
    } catch (err) {
      setMountFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Scan failed',
      });
    } finally {
      setScanningId(null);
    }
  };

  const handleRemoveMount = async (mount: StorageMount) => {
    await removeMount(mount.id);
    setMountFeedback({
      type: 'ok',
      text: `Unmounted "${mount.name}" from gallery index. Source files on disk were not modified.`,
    });
    onRefreshAll();
  };

  const handleCreateToken = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await createSyncToken(tokenLabel.trim() || 'Mobile Sync Device');
    setTokenLabel('');
    setNewTokenSecret(res.token);
    onRefreshAll();
  };

  const handleRevokeToken = async (id: string) => {
    await revokeSyncToken(id);
    onRefreshAll();
  };

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://photos.example.com';
  const curlExample = `# 1. Deduplication check\ncurl -X POST ${origin}/api/sync/check \\\n  -H "Authorization: Bearer ${newTokenSecret || 'YOUR_SYNC_TOKEN'}" \\\n  -H "Content-Type: application/json" \\\n  -d '[{"sha256":"<file-sha256>","filename":"IMG_1024.JPG","size":4201930}]'\n\n# 2. Multipart streaming upload\ncurl -X POST ${origin}/api/upload \\\n  -H "Authorization: Bearer ${newTokenSecret || 'YOUR_SYNC_TOKEN'}" \\\n  -F "file=@/path/to/IMG_1024.JPG"`;

  return (
    <div className="flex-1 overflow-y-auto px-4 lg:px-8 py-6">
      <div className="max-w-4xl space-y-8 pb-12">
        <div>
          <h1 className="text-2xl font-normal tracking-tight text-[#1F1F1F] dark:text-[#E3E3E3]">
            Storage & Sync
          </h1>
          <p className="mt-1 text-sm text-[#747775] dark:text-[#8E918F]">
            Manage local NVMe SQLite & WebP thumbnail storage, read-only external NAS mounts, browser folder auto-sync, and mobile sync tokens.
          </p>
        </div>

        {/* 1. Local NVMe Storage Overview */}
        {overview && (
          <section className="rounded-3xl bg-[#F8FAFD] dark:bg-[#1E1F20] p-6 space-y-5">
            <div className="flex items-center gap-2.5 text-base font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
              <HardDrive className="w-5 h-5 text-[#0B57D0] dark:text-[#A8C7FA]" />
              <h2>Local NVMe Storage</h2>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
              <div>
                <div className="text-xs text-[#747775] dark:text-[#8E918F]">Indexed library</div>
                <div className="mt-1 text-xl font-medium tabular-nums text-[#1F1F1F] dark:text-[#E3E3E3]">
                  {formatBytes(overview.indexedTotalBytes)}
                </div>
                <div className="text-xs text-[#747775] dark:text-[#8E918F] tabular-nums">
                  {overview.photoCount} photos · {overview.videoCount} videos
                </div>
              </div>
              <div>
                <div className="text-xs text-[#747775] dark:text-[#8E918F]">WebP thumbnails</div>
                <div className="mt-1 text-xl font-medium tabular-nums text-[#1F1F1F] dark:text-[#E3E3E3]">
                  {formatBytes(overview.thumbsSizeBytes)}
                </div>
                <div className="text-xs text-[#747775] dark:text-[#8E918F]">400px & 1600px cache</div>
              </div>
              <div>
                <div className="text-xs text-[#747775] dark:text-[#8E918F]">SQLite database</div>
                <div className="mt-1 text-xl font-medium tabular-nums text-[#1F1F1F] dark:text-[#E3E3E3]">
                  {formatBytes(overview.dbSizeBytes)}
                </div>
                <div className="text-xs text-[#747775] dark:text-[#8E918F]">{overview.sqliteMode} journal mode</div>
              </div>
              <div>
                <div className="text-xs text-[#747775] dark:text-[#8E918F]">Direct uploads</div>
                <div className="mt-1 text-xl font-medium tabular-nums text-[#1F1F1F] dark:text-[#E3E3E3]">
                  {formatBytes(overview.uploadsSizeBytes)}
                </div>
                <div className="text-xs text-[#747775] dark:text-[#8E918F]">SHA-256 deduplicated</div>
              </div>
            </div>

            <div className="pt-4 border-t border-black/[0.06] dark:border-white/[0.08] grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-[#444746] dark:text-[#C4C7C5]">
              <div className="truncate">
                <span className="text-[#747775] dark:text-[#8E918F] mr-2">Data directory:</span>
                <span className="font-medium">{overview.dataDir}</span>
              </div>
              <div className="truncate">
                <span className="text-[#747775] dark:text-[#8E918F] mr-2">Upload directory:</span>
                <span className="font-medium">{overview.uploadDir}</span>
              </div>
            </div>
          </section>
        )}

        {/* 2. Read-Only External NAS Mounts */}
        <section className="rounded-3xl bg-[#F8FAFD] dark:bg-[#1E1F20] p-6 space-y-5">
          <div>
            <h2 className="text-base font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
              Read-Only External Mounts
            </h2>
            <p className="mt-1 text-xs text-[#747775] dark:text-[#8E918F]">
              Index existing NAS folders non-destructively via chokidar without moving, renaming, or modifying source files.
            </p>
          </div>

          <form onSubmit={handleAddMount} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-3">
              <label className="block text-xs font-medium text-[#444746] dark:text-[#C4C7C5] mb-1">
                Label
              </label>
              <input
                type="text"
                value={mountName}
                onChange={(e) => setMountName(e.target.value)}
                placeholder="Photo Library"
                className="w-full rounded-xl bg-white dark:bg-[#282A2C] px-3.5 py-2.5 text-sm text-[#1F1F1F] dark:text-[#E3E3E3] focus:outline-none focus:ring-2 focus:ring-[#0B57D0]/40 dark:focus:ring-[#A8C7FA]/40"
              />
            </div>
            <div className="md:col-span-5">
              <label className="block text-xs font-medium text-[#444746] dark:text-[#C4C7C5] mb-1">
                Absolute directory path
              </label>
              <input
                type="text"
                required
                value={mountPath}
                onChange={(e) => setMountPath(e.target.value)}
                placeholder="/photos"
                className="w-full rounded-xl bg-white dark:bg-[#282A2C] px-3.5 py-2.5 text-sm text-[#1F1F1F] dark:text-[#E3E3E3] focus:outline-none focus:ring-2 focus:ring-[#0B57D0]/40 dark:focus:ring-[#A8C7FA]/40"
              />
            </div>
            <div className="md:col-span-2 flex items-center h-10">
              <label className="flex items-center gap-2 text-xs text-[#444746] dark:text-[#C4C7C5] cursor-pointer whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={mountWatch}
                  onChange={(e) => setMountWatch(e.target.checked)}
                  className="rounded accent-[#0B57D0]"
                />
                Watch changes
              </label>
            </div>
            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={mountBusy || !mountPath.trim()}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-full bg-[#0B57D0] dark:bg-[#A8C7FA] disabled:opacity-50 px-4 py-2.5 text-xs font-medium text-white dark:text-[#062E6F] cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                {mountBusy ? 'Indexing…' : 'Add mount'}
              </button>
            </div>
          </form>

          {mountFeedback && (
            <p
              className={`text-xs ${
                mountFeedback.type === 'ok'
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              }`}
            >
              {mountFeedback.text}
            </p>
          )}

          {mounts.length === 0 ? (
            <p className="text-xs text-[#747775] dark:text-[#8E918F]">
              No external mounts configured yet. Add any readable folder path above or set EXTERNAL_MOUNTS in .env.
            </p>
          ) : (
            <div className="space-y-2">
              {mounts.map((m) => (
                <div
                  key={m.id}
                  className="p-4 rounded-2xl bg-white dark:bg-[#282A2C] flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">{m.name}</div>
                    <div className="text-xs text-[#444746] dark:text-[#C4C7C5] truncate">{m.path}</div>
                    <div className="mt-0.5 text-xs text-[#747775] dark:text-[#8E918F] tabular-nums">
                      Read-only · {m.fileCount} indexed files · {m.isWatching ? 'Watching' : 'Manual scan'}
                      {m.lastScanAt ? ` · Scanned ${formatFullTimestamp(m.lastScanAt)}` : ''}
                      {!m.existsOnDisk ? ' · Offline' : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleRescan(m.id)}
                      disabled={scanningId === m.id}
                      className="inline-flex items-center gap-1.5 rounded-full bg-[#E9EEF6] dark:bg-[#3C4043] px-3.5 py-1.5 text-xs font-medium text-[#1F1F1F] dark:text-[#E3E3E3] cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${scanningId === m.id ? 'animate-spin' : ''}`} />
                      Rescan
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveMount(m)}
                      className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Unmount
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 3. Browser Folder Auto-Sync */}
        <section className="rounded-3xl bg-[#F8FAFD] dark:bg-[#1E1F20] p-6 space-y-4">
          <div className="flex items-center gap-2.5 text-base font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
            <FolderSync className="w-5 h-5 text-[#0B57D0] dark:text-[#A8C7FA]" />
            <h2>Browser Folder Auto-Sync</h2>
          </div>
          <p className="text-xs text-[#747775] dark:text-[#8E918F] max-w-2xl leading-relaxed">
            Links a local camera folder via the File System Access API, persists the handle in IndexedDB, hashes files locally with SHA-256, checks /api/sync/check, and uploads only missing photos and videos automatically.
          </p>

          <div className="p-4 rounded-2xl bg-white dark:bg-[#282A2C] flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
                {savedFolderName ? `Linked folder: ${savedFolderName}` : 'No local folder linked'}
              </div>
              <div className="text-xs text-[#747775] dark:text-[#8E918F]">
                {folderSyncProgress.message ||
                  (supportsDirectoryPicker()
                    ? 'Directory handle stays remembered in IndexedDB across app sessions.'
                    : 'Uses browser folder upload fallback with full SHA-256 deduplication.')}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {savedFolderName && (
                <button
                  type="button"
                  onClick={onSyncNow}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#0B57D0] dark:bg-[#A8C7FA] px-4 py-2 text-xs font-medium text-white dark:text-[#062E6F] cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Sync now
                </button>
              )}
              <button
                type="button"
                onClick={onPickSyncFolder}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#C2E7FF] dark:bg-[#004A77] px-4 py-2 text-xs font-semibold text-[#001D35] dark:text-[#C2E7FF] cursor-pointer"
              >
                <FolderSync className="w-3.5 h-3.5" />
                {savedFolderName ? 'Change folder' : 'Select folder'}
              </button>
              {savedFolderName && (
                <button
                  type="button"
                  onClick={onDisconnectSyncFolder}
                  className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium text-[#747775] hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
                >
                  <Unlink className="w-3.5 h-3.5" />
                  Disconnect
                </button>
              )}
            </div>
          </div>

          <label className="inline-flex items-center gap-2.5 text-xs text-[#444746] dark:text-[#C4C7C5] cursor-pointer">
            <input
              type="checkbox"
              checked={autoSyncOnOpen}
              onChange={(e) => onToggleAutoSyncOnOpen(e.target.checked)}
              className="rounded accent-[#0B57D0]"
            />
            <span>Automatically sync remembered folder when opening xPhotoLabs</span>
          </label>
        </section>

        {/* 4. Mobile & Automated Sync API Tokens */}
        <section className="rounded-3xl bg-[#F8FAFD] dark:bg-[#1E1F20] p-6 space-y-4">
          <div className="flex items-center gap-2.5 text-base font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
            <KeyRound className="w-5 h-5 text-[#0B57D0] dark:text-[#A8C7FA]" />
            <h2>Mobile & Automated Sync API</h2>
          </div>
          <p className="text-xs text-[#747775] dark:text-[#8E918F]">
            Generate Bearer tokens to authenticate automated mobile backup tools against /api/sync/check and /api/upload.
            {hasEnvToken ? ' An environment SYNC_API_TOKEN is also configured.' : ''}
          </p>

          <form onSubmit={handleCreateToken} className="flex flex-wrap gap-2 max-w-md">
            <input
              type="text"
              value={tokenLabel}
              onChange={(e) => setTokenLabel(e.target.value)}
              placeholder="Device name (e.g., Pixel 9 Backup)"
              className="flex-1 min-w-48 rounded-full bg-white dark:bg-[#282A2C] px-4 py-2 text-sm text-[#1F1F1F] dark:text-[#E3E3E3] focus:outline-none"
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-full bg-[#0B57D0] dark:bg-[#A8C7FA] px-4 py-2 text-xs font-medium text-white dark:text-[#062E6F] cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              Generate token
            </button>
          </form>

          {newTokenSecret && (
            <div className="p-4 rounded-2xl bg-[#C2E7FF]/55 dark:bg-[#004A77]/40 space-y-2">
              <div className="text-xs font-medium text-[#001D35] dark:text-[#C2E7FF]">
                Copy your new Bearer token now — it is stored hashed on the server and will not be shown again.
              </div>
              <div className="flex items-center gap-2">
                <span className="flex-1 text-xs bg-white dark:bg-[#1E1F20] px-3.5 py-2 rounded-full text-[#1F1F1F] dark:text-[#E3E3E3] break-all select-all">
                  {newTokenSecret}
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(newTokenSecret);
                    setCopiedSecret(true);
                    setTimeout(() => setCopiedSecret(false), 1800);
                  }}
                  className="inline-flex items-center gap-1 rounded-full bg-[#0B57D0] dark:bg-[#A8C7FA] px-3.5 py-2 text-xs font-medium text-white dark:text-[#062E6F] cursor-pointer whitespace-nowrap"
                >
                  {copiedSecret ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedSecret ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          )}

          {tokens.length > 0 && (
            <div className="space-y-2">
              {tokens.map((t) => (
                <div
                  key={t.id}
                  className="px-4 py-3 rounded-2xl bg-white dark:bg-[#282A2C] flex items-center justify-between gap-3"
                >
                  <div>
                    <div className="text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">{t.label}</div>
                    <div className="text-xs text-[#747775] dark:text-[#8E918F] tabular-nums">
                      {t.tokenPrefix} · Created {new Date(t.createdAt).toLocaleDateString()}
                      {t.lastUsedAt ? ` · Last used ${formatFullTimestamp(t.lastUsedAt)}` : ' · Unused'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRevokeToken(t.id)}
                    className="px-3 py-1.5 rounded-full text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 cursor-pointer"
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-2xl bg-white dark:bg-[#282A2C] p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-[#444746] dark:text-[#C4C7C5]">
                Sync API example
              </span>
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(curlExample);
                  setCopiedCurl(true);
                  setTimeout(() => setCopiedCurl(false), 1800);
                }}
                className="inline-flex items-center gap-1 text-xs text-[#0B57D0] dark:text-[#A8C7FA] hover:underline cursor-pointer"
              >
                {copiedCurl ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedCurl ? 'Copied' : 'Copy snippet'}
              </button>
            </div>
            <pre className="text-xs font-sans text-[#444746] dark:text-[#C4C7C5] overflow-x-auto leading-relaxed whitespace-pre-wrap">
              {curlExample}
            </pre>
          </div>
        </section>

        {/* 5. Self-Hosted Deployment Configuration */}
        <section className="rounded-3xl bg-[#F8FAFD] dark:bg-[#1E1F20] p-6 space-y-1.5">
          <div className="flex items-center gap-2.5 text-base font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
            <Server className="w-5 h-5 text-[#0B57D0] dark:text-[#A8C7FA]" />
            <h2>Self-Hosted Deployment</h2>
          </div>
          <p className="text-xs text-[#747775] dark:text-[#8E918F] leading-relaxed">
            Configure persistent storage, external NAS mounts, and sync tokens via environment variables (DATA_DIR, UPLOAD_DIR, EXTERNAL_MOUNTS, SYNC_API_TOKEN) in Docker Compose or your local .env file.
          </p>
        </section>
      </div>
    </div>
  );
};
