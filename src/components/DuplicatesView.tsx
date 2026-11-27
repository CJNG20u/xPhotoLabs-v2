import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  CopyCheck,
  Folder,
  FolderOpen,
  HardDrive,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Trash2,
  WifiOff,
  X,
} from 'lucide-react';
import type {
  DuplicateGroup,
  DuplicateGroupItem,
  DuplicateScanStatus,
  DuplicateSensitivity,
  MediaItem,
} from '../types';
import {
  fetchDuplicates,
  fetchDuplicatesStatus,
  resolveAllDuplicates,
  resolveDuplicatesGroup,
  startDuplicatesScan,
} from '../lib/api';
import { formatBytes, formatFullTimestamp } from '../lib/format';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

interface DuplicatesViewProps {
  refreshTrigger: number;
  onGroupCountChange: (count: number) => void;
  onRefreshAfterChange: () => Promise<void>;
  onShowUndoToast: (message: string, trashedIds: string[]) => void;
  onShowToast: (message: string) => void;
  onOpenCompareLightbox: (items: MediaItem[], startIndex: number) => void;
}

interface PendingConfirmAction {
  mode: 'all' | 'group';
  title: string;
  trashCount: number;
  freedBytes: number;
  groupCount: number;
  sharedTrashCount: number;
  keepFilename?: string;
  onConfirm: () => Promise<void>;
}

const SENSITIVITY_OPTIONS: Array<{
  id: DuplicateSensitivity;
  label: string;
  hint: string;
}> = [
  { id: 'strict', label: 'Strict', hint: 'Distance ≤ 2' },
  { id: 'similar', label: 'Similar', hint: 'Distance ≤ 5' },
  { id: 'loose', label: 'Loose', hint: 'Distance ≤ 10' },
];

function toLightboxMediaItem(item: DuplicateGroupItem): MediaItem {
  return {
    id: item.id,
    sha256: item.sha256,
    filename: item.filename,
    sourceType: item.sourceType,
    mountId: item.mountId,
    mountName: item.mountName,
    mimeType: item.mimeType,
    mediaType: item.mediaType,
    sizeBytes: item.size_bytes,
    width: item.width,
    height: item.height,
    durationSec: item.durationSec,
    takenAt: item.taken_at,
    createdAt: item.created_at,
    cameraMake: item.cameraMake,
    cameraModel: item.cameraModel,
    lensModel: item.lensModel,
    focalLength: item.focalLength,
    aperture: item.aperture,
    shutterSpeed: item.shutterSpeed,
    iso: item.iso,
    gpsLat: item.gpsLat,
    gpsLng: item.gpsLng,
    locationName: item.locationName,
    isFavorite: item.is_favorite,
    isTrashed: false,
    trashedAt: null,
    dominantColor: item.dominantColor,
    thumb400Url: item.thumb400Url,
    thumb1600Url: item.thumb1600Url,
    originalUrl: item.originalUrl,
  };
}

export const DuplicatesView: React.FC<DuplicatesViewProps> = ({
  refreshTrigger,
  onGroupCountChange,
  onRefreshAfterChange,
  onShowUndoToast,
  onShowToast,
  onOpenCompareLightbox,
}) => {
  const isOnline = useOnlineStatus();
  const [sensitivity, setSensitivity] = useState<DuplicateSensitivity>('similar');
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [status, setStatus] = useState<DuplicateScanStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyGroupId, setBusyGroupId] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState(false);
  const [confirmAction, setConfirmAction] = useState<PendingConfirmAction | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const loadDuplicates = useCallback(
    async (targetSensitivity: DuplicateSensitivity, showSpinner = false) => {
      if (showSpinner) setLoading(true);
      setError(null);
      try {
        const res = await fetchDuplicates(targetSensitivity);
        setGroups(res.groups);
        setStatus({
          state: res.state,
          processed: res.processed,
          total: res.total,
          groupCount: res.groupCount,
          removableCount: res.removableCount,
          removableBytes: res.removableBytes,
          sensitivity: res.sensitivity,
          lastScanAt: res.lastScanAt,
          error: null,
        });
        onGroupCountChange(res.groupCount);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load duplicate groups');
      } finally {
        setLoading(false);
      }
    },
    [onGroupCountChange]
  );

  const startPollingStatus = useCallback(
    (targetSensitivity: DuplicateSensitivity) => {
      stopPolling();
      pollTimerRef.current = window.setInterval(async () => {
        try {
          const next = await fetchDuplicatesStatus(targetSensitivity);
          setStatus(next);
          onGroupCountChange(next.groupCount);
          if (next.state !== 'scanning') {
            stopPolling();
            await loadDuplicates(targetSensitivity, false);
          }
        } catch {
          stopPolling();
        }
      }, 600);
    },
    [loadDuplicates, onGroupCountChange, stopPolling]
  );

  useEffect(() => {
    loadDuplicates(sensitivity, true);
  }, [sensitivity, refreshTrigger, loadDuplicates]);

  useEffect(() => {
    if (status?.state === 'scanning' && pollTimerRef.current === null) {
      startPollingStatus(sensitivity);
    }
  }, [status?.state, sensitivity, startPollingStatus]);

  useEffect(() => stopPolling, [stopPolling]);

  useEffect(() => {
    if (!confirmAction) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busyAll && !busyGroupId) {
        setConfirmAction(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [confirmAction, busyAll, busyGroupId]);

  const handleStartScan = async () => {
    if (!isOnline) {
      onShowToast('You are offline. Reconnect to scan for duplicates.');
      return;
    }
    setError(null);
    try {
      const next = await startDuplicatesScan(sensitivity);
      setStatus(next);
      onGroupCountChange(next.groupCount);
      if (next.state === 'scanning') {
        startPollingStatus(sensitivity);
      } else {
        await loadDuplicates(sensitivity, false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start duplicate scan');
    }
  };

  const summary = useMemo(() => {
    let removableCount = 0;
    let removableBytes = 0;
    let sharedRemovableCount = 0;
    for (const g of groups) {
      for (const item of g.items) {
        if (item.id !== g.suggestedKeepId) {
          removableCount++;
          removableBytes += item.size_bytes;
          if (item.isShared) sharedRemovableCount++;
        }
      }
    }
    return {
      groupCount: groups.length,
      removableCount,
      removableBytes,
      sharedRemovableCount,
    };
  }, [groups]);

  const executeResolveGroup = async (
    group: DuplicateGroup,
    keepId: string,
    trashIds: string[],
    description: string
  ) => {
    setBusyGroupId(group.id);
    setError(null);
    try {
      const res = await resolveDuplicatesGroup({ keepId, trashIds, sensitivity });
      onShowUndoToast(description, res.trashedIds);
      await Promise.all([loadDuplicates(sensitivity, false), onRefreshAfterChange()]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not move duplicates to Trash';
      setError(msg);
      onShowToast(msg);
    } finally {
      setBusyGroupId(null);
    }
  };

  const requestResolveGroup = (
    group: DuplicateGroup,
    keepId: string,
    trashIds: string[],
    description: string
  ) => {
    if (!isOnline) {
      onShowToast('You are offline. Reconnect to manage duplicates.');
      return;
    }
    const trashedItems = group.items.filter((i) => trashIds.includes(i.id));
    const sharedTrashCount = trashedItems.filter((i) => i.isShared).length;
    const freedBytes = trashedItems.reduce((sum, i) => sum + i.size_bytes, 0);
    const keepItem = group.items.find((i) => i.id === keepId);

    // If any copy being trashed is actively shared, require explicit confirmation with warning
    if (sharedTrashCount > 0) {
      setConfirmAction({
        mode: 'group',
        title: `Move ${trashedItems.length} ${trashedItems.length === 1 ? 'copy' : 'copies'} to Trash?`,
        trashCount: trashedItems.length,
        freedBytes,
        groupCount: 1,
        sharedTrashCount,
        keepFilename: keepItem?.filename,
        onConfirm: async () => {
          await executeResolveGroup(group, keepId, trashIds, description);
          setConfirmAction(null);
        },
      });
      return;
    }

    void executeResolveGroup(group, keepId, trashIds, description);
  };

  const handleKeepThisOne = (group: DuplicateGroup, keepItem: DuplicateGroupItem) => {
    const trashIds = group.items.filter((i) => i.id !== keepItem.id).map((i) => i.id);
    if (trashIds.length === 0) return;
    const count = trashIds.length;
    requestResolveGroup(
      group,
      keepItem.id,
      trashIds,
      `Kept "${keepItem.filename}" and moved ${count} ${count === 1 ? 'copy' : 'copies'} to Trash.`
    );
  };

  const handleTrashSingleCopy = (group: DuplicateGroup, itemToTrash: DuplicateGroupItem) => {
    // Keep the suggested keeper unless the user explicitly trashes the suggested keeper,
    // in which case promote the next best remaining copy in the group.
    const keeper =
      itemToTrash.id === group.suggestedKeepId
        ? group.items.find((i) => i.id !== itemToTrash.id)
        : group.items.find((i) => i.id === group.suggestedKeepId) ||
          group.items.find((i) => i.id !== itemToTrash.id);
    if (!keeper) return;

    requestResolveGroup(
      group,
      keeper.id,
      [itemToTrash.id],
      `Moved "${itemToTrash.filename}" to Trash.`
    );
  };

  const handleKeepBestForGroup = (group: DuplicateGroup) => {
    const keeper = group.items.find((i) => i.id === group.suggestedKeepId) || group.items[0];
    if (!keeper) return;
    handleKeepThisOne(group, keeper);
  };

  const handleOpenMoveAllConfirm = () => {
    if (!isOnline) {
      onShowToast('You are offline. Reconnect to manage duplicates.');
      return;
    }
    if (summary.removableCount === 0) return;
    setConfirmAction({
      mode: 'all',
      title: `Move ${summary.removableCount} duplicate ${summary.removableCount === 1 ? 'photo' : 'photos'} to Trash?`,
      trashCount: summary.removableCount,
      freedBytes: summary.removableBytes,
      groupCount: summary.groupCount,
      sharedTrashCount: summary.sharedRemovableCount,
      onConfirm: async () => {
        setBusyAll(true);
        setError(null);
        try {
          const res = await resolveAllDuplicates(sensitivity);
          setConfirmAction(null);
          onShowUndoToast(
            `Moved ${res.trashedCount} duplicate ${res.trashedCount === 1 ? 'copy' : 'copies'} (${formatBytes(res.freedBytes)}) to Trash.`,
            res.trashedIds
          );
          await Promise.all([loadDuplicates(sensitivity, false), onRefreshAfterChange()]);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to move duplicates to Trash';
          setError(msg);
          onShowToast(msg);
        } finally {
          setBusyAll(false);
        }
      },
    });
  };

  const isScanning = status?.state === 'scanning';
  const progressPct =
    status && status.total > 0 ? Math.min(100, Math.round((status.processed / status.total) * 100)) : 0;

  return (
    <div className="flex-1 overflow-y-auto px-4 lg:px-8 py-5 sm:py-6">
      <div className="max-w-6xl mx-auto space-y-6 pb-16">
        {/* Top Bar */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-normal tracking-tight text-[#1F1F1F] dark:text-[#E3E3E3]">
                Duplicates
              </h1>
              <p className="mt-1 text-xs sm:text-sm text-[#747775] dark:text-[#8E918F] tabular-nums">
                {isScanning && status
                  ? `Analyzing ${status.processed.toLocaleString()} / ${status.total.toLocaleString()} photos…`
                  : summary.groupCount > 0
                    ? `${summary.groupCount} ${summary.groupCount === 1 ? 'group' : 'groups'} · ${summary.removableCount} extra ${summary.removableCount === 1 ? 'copy' : 'copies'} · ${formatBytes(summary.removableBytes)}`
                    : 'Find visually identical or near-duplicate photos across uploads and mounts.'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={handleStartScan}
                disabled={isScanning || !isOnline}
                className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-[38px] px-4 rounded-full border border-neutral-300 dark:border-neutral-700 text-xs sm:text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap"
              >
                {isScanning ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[#0B57D0] dark:text-[#A8C7FA]" />
                ) : (
                  <Search className="w-4 h-4 text-[#0B57D0] dark:text-[#A8C7FA]" />
                )}
                <span>
                  {isScanning && status
                    ? `Analyzing ${status.processed.toLocaleString()} / ${status.total.toLocaleString()} photos`
                    : 'Find duplicates'}
                </span>
              </button>

              {summary.groupCount > 0 && (
                <button
                  type="button"
                  onClick={handleOpenMoveAllConfirm}
                  disabled={isScanning || busyAll || !isOnline}
                  className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-[38px] px-5 rounded-full bg-[#0B57D0] dark:bg-[#A8C7FA] text-white dark:text-[#062E6F] text-xs sm:text-sm font-medium hover:opacity-95 disabled:opacity-50 transition-opacity cursor-pointer whitespace-nowrap"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Move all duplicates to Trash</span>
                </button>
              )}
            </div>
          </div>

          {/* Sensitivity Selector + Last Scan Metadata */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-[#5F6368] dark:text-[#9AA0A6]">
                Sensitivity
              </span>
              <div
                role="group"
                aria-label="Duplicate match sensitivity"
                className="inline-flex items-center rounded-xl border border-neutral-300 dark:border-neutral-700 p-0.5 bg-white dark:bg-[#131314]"
              >
                {SENSITIVITY_OPTIONS.map((opt) => {
                  const active = sensitivity === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setSensitivity(opt.id)}
                      aria-pressed={active}
                      title={opt.hint}
                      className={`inline-flex items-center justify-center gap-1 min-h-[40px] sm:min-h-[32px] px-3.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                        active
                          ? 'bg-[#C2E7FF] text-[#001D35] dark:bg-[#004A77] dark:text-[#C2E7FF]'
                          : 'text-[#444746] dark:text-[#C4C7C5] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                      }`}
                    >
                      {active && <Check className="w-3.5 h-3.5 stroke-[2.4]" />}
                      <span>{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {status?.lastScanAt && !isScanning && (
              <span className="text-xs text-[#747775] dark:text-[#8E918F] tabular-nums">
                Last scan: {formatFullTimestamp(status.lastScanAt)}
              </span>
            )}
          </div>

          {/* Live Backfill Progress Bar */}
          {isScanning && status && (
            <div className="rounded-2xl bg-[#F8FAFD] dark:bg-[#1E1F20] p-4 space-y-2 border border-black/[0.05] dark:border-white/[0.06]">
              <div className="flex items-center justify-between text-xs text-[#444746] dark:text-[#C4C7C5] tabular-nums">
                <span className="font-medium">
                  Analyzing {status.processed.toLocaleString()} / {status.total.toLocaleString()} photos
                </span>
                <span>{progressPct}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-[#DDE3EA] dark:bg-[#3C4043] overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#0B57D0] dark:bg-[#A8C7FA] transition-all duration-300"
                  style={{ width: `${Math.max(4, progressPct)}%` }}
                />
              </div>
            </div>
          )}

          {/* Offline Banner */}
          {!isOnline && (
            <div className="rounded-2xl bg-amber-500/10 border border-amber-500/25 px-4 py-3 flex items-center gap-3 text-xs text-amber-800 dark:text-amber-300">
              <WifiOff className="w-4 h-4 shrink-0" />
              <span>You are currently offline. Reconnect to scan or move duplicates to Trash.</span>
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div className="rounded-2xl bg-red-500/10 border border-red-500/25 px-4 py-3 flex items-center justify-between gap-3 text-xs text-red-700 dark:text-red-300">
              <div className="flex items-center gap-2.5 min-w-0">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="truncate">{error}</span>
              </div>
              <button
                type="button"
                onClick={() => loadDuplicates(sensitivity, true)}
                className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 font-medium bg-white/80 dark:bg-[#282A2C] text-[#1F1F1F] dark:text-[#E3E3E3] cursor-pointer shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Retry
              </button>
            </div>
          )}
        </div>

        {/* Loading State */}
        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="rounded-3xl bg-[#F8FAFD] dark:bg-[#1E1F20] p-5 space-y-4 animate-pulse"
              >
                <div className="h-5 w-48 rounded-lg bg-neutral-200 dark:bg-neutral-800" />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div className="h-64 rounded-2xl bg-neutral-200 dark:bg-neutral-800" />
                  <div className="h-64 rounded-2xl bg-neutral-200 dark:bg-neutral-800" />
                </div>
              </div>
            ))}
          </div>
        ) : groups.length === 0 ? (
          /* Empty State */
          <div className="rounded-3xl bg-[#F8FAFD] dark:bg-[#1E1F20] px-6 py-16 text-center space-y-3">
            <div className="w-14 h-14 rounded-full bg-[#E9EEF6] dark:bg-[#282A2C] flex items-center justify-center text-[#0B57D0] dark:text-[#A8C7FA] mx-auto">
              <CopyCheck className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
              No duplicates found
            </h2>
            <p className="text-sm text-[#747775] dark:text-[#8E918F] max-w-md mx-auto">
              {status?.lastScanAt
                ? `Last scanned ${formatFullTimestamp(status.lastScanAt)} at ${sensitivity} sensitivity.`
                : status && status.total > status.processed
                  ? `${(status.total - status.processed).toLocaleString()} photos have not been fingerprinted yet. Run "Find duplicates" to analyze your library.`
                  : 'Run a scan to visually compare your library and catch resized or re-encoded copies.'}
            </p>
            <div className="pt-2">
              <button
                type="button"
                onClick={handleStartScan}
                disabled={isScanning || !isOnline}
                className="inline-flex items-center gap-2 min-h-[44px] px-5 rounded-full bg-[#0B57D0] dark:bg-[#A8C7FA] text-white dark:text-[#062E6F] text-sm font-medium hover:opacity-95 disabled:opacity-50 cursor-pointer"
              >
                <Search className="w-4 h-4" />
                <span>{isScanning ? 'Scanning…' : 'Find duplicates'}</span>
              </button>
            </div>
          </div>
        ) : (
          /* Duplicate Group Cards */
          <div className="space-y-5">
            {groups.map((group, groupIdx) => {
              const isGroupBusy = busyGroupId === group.id || busyAll;
              const groupRecoverableBytes = group.items
                .filter((i) => i.id !== group.suggestedKeepId)
                .reduce((sum, i) => sum + i.size_bytes, 0);
              const lightboxItems = group.items.map(toLightboxMediaItem);

              return (
                <section
                  key={group.id}
                  className="rounded-3xl bg-[#F8FAFD] dark:bg-[#1E1F20] border border-black/[0.05] dark:border-white/[0.06] p-4 sm:p-5 space-y-4"
                >
                  {/* Group Card Header */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-sm sm:text-base font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
                        Group {groupIdx + 1}{' '}
                        <span className="text-xs font-normal text-[#747775] dark:text-[#8E918F] tabular-nums">
                          · {group.items.length} copies · {formatBytes(groupRecoverableBytes)} extra
                        </span>
                      </h2>
                    </div>

                    <button
                      type="button"
                      disabled={isGroupBusy || !isOnline}
                      onClick={() => handleKeepBestForGroup(group)}
                      className="inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-[36px] px-4 rounded-full bg-[#C2E7FF] dark:bg-[#004A77] text-[#001D35] dark:text-[#C2E7FF] text-xs font-semibold hover:opacity-95 disabled:opacity-50 transition-opacity cursor-pointer whitespace-nowrap"
                    >
                      {isGroupBusy ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                      <span>Keep best, trash the rest</span>
                    </button>
                  </div>

                  {/* Copies Side by Side (Horizontal Scroll on Mobile, Multi-Column on Desktop) */}
                  <div className="flex gap-3.5 overflow-x-auto pb-2 snap-x snap-mandatory sm:grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 sm:overflow-visible sm:pb-0">
                    {group.items.map((item, itemIdx) => {
                      const isBest = item.id === group.suggestedKeepId;
                      return (
                        <article
                          key={item.id}
                          className={`snap-start w-[272px] shrink-0 sm:w-auto rounded-2xl bg-white dark:bg-[#282A2C] overflow-hidden flex flex-col transition-shadow ${
                            isBest
                              ? 'ring-2 ring-emerald-500 dark:ring-emerald-400 shadow-sm'
                              : 'border border-black/[0.07] dark:border-white/[0.08]'
                          }`}
                        >
                          {/* Clickable Thumbnail -> Opens Lightbox to Compare */}
                          <button
                            type="button"
                            onClick={() => onOpenCompareLightbox(lightboxItems, itemIdx)}
                            style={{ backgroundColor: item.dominantColor }}
                            className="group relative aspect-[4/3] w-full overflow-hidden text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-[#0B57D0]"
                            aria-label={`Inspect ${item.filename} in lightbox`}
                          >
                            <img
                              src={item.thumb400Url}
                              alt={item.filename}
                              loading="lazy"
                              decoding="async"
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                            />

                            {/* Top-left Status Badges */}
                            <div className="absolute top-2 left-2 right-2 flex flex-wrap gap-1.5 pointer-events-none">
                              {isBest && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 text-white px-2.5 py-0.5 text-[11px] font-semibold shadow-sm">
                                  <CheckCircle2 className="w-3 h-3" />
                                  Best
                                </span>
                              )}
                              {item.is_favorite && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-black/70 text-amber-300 px-2 py-0.5 text-[11px] font-medium backdrop-blur-xs">
                                  <Star className="w-3 h-3 fill-amber-300" />
                                  Favorite
                                </span>
                              )}
                              {item.albumCount > 0 && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-black/70 text-white px-2 py-0.5 text-[11px] font-medium backdrop-blur-xs tabular-nums">
                                  <FolderOpen className="w-3 h-3" />
                                  In {item.albumCount} {item.albumCount === 1 ? 'album' : 'albums'}
                                </span>
                              )}
                              {item.isShared && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-[#0B57D0] text-white px-2 py-0.5 text-[11px] font-medium shadow-xs">
                                  <Link2 className="w-3 h-3" />
                                  Shared
                                </span>
                              )}
                            </div>

                            {/* Subtle compare hint */}
                            <div className="pointer-events-none absolute bottom-2 right-2 rounded-full bg-black/60 text-white/90 px-2.5 py-0.5 text-[11px] opacity-0 group-hover:opacity-100 transition-opacity">
                              Compare
                            </div>
                          </button>

                          {/* Copy Metadata */}
                          <div className="p-3.5 flex-1 flex flex-col justify-between gap-3">
                            <div className="space-y-1.5 min-w-0">
                              <div
                                className="text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3] truncate"
                                title={item.filename}
                              >
                                {item.filename}
                              </div>

                              <div className="text-xs text-[#444746] dark:text-[#C4C7C5] tabular-nums">
                                {item.width} × {item.height} · {formatBytes(item.size_bytes)}
                              </div>

                              <div className="text-xs text-[#747775] dark:text-[#8E918F] tabular-nums">
                                {formatFullTimestamp(item.taken_at)}
                              </div>

                              <div
                                className="flex items-center gap-1.5 text-xs text-[#747775] dark:text-[#8E918F] truncate"
                                title={item.file_path}
                              >
                                {item.sourceType === 'mount' ? (
                                  <HardDrive className="w-3.5 h-3.5 shrink-0" />
                                ) : (
                                  <Folder className="w-3.5 h-3.5 shrink-0" />
                                )}
                                <span className="truncate">{item.folderName}</span>
                              </div>

                              {item.camera && (
                                <div className="flex items-center gap-1.5 text-xs text-[#747775] dark:text-[#8E918F] truncate">
                                  <Camera className="w-3.5 h-3.5 shrink-0" />
                                  <span className="truncate">{item.camera}</span>
                                </div>
                              )}
                            </div>

                            {/* Per-Copy Actions (44px touch targets on mobile) */}
                            <div className="flex flex-col gap-1.5 pt-1">
                              <button
                                type="button"
                                disabled={isGroupBusy || !isOnline}
                                onClick={() => handleKeepThisOne(group, item)}
                                className={`w-full inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-[36px] px-3 rounded-full text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer ${
                                  isBest
                                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                    : 'bg-[#E9EEF6] dark:bg-[#3C4043] text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-[#DCE4F2] dark:hover:bg-[#4A4E51]'
                                }`}
                              >
                                <Check className="w-3.5 h-3.5" />
                                <span>Keep this one</span>
                              </button>

                              <button
                                type="button"
                                disabled={isGroupBusy || !isOnline}
                                onClick={() => handleTrashSingleCopy(group, item)}
                                className="w-full inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-[36px] px-3 rounded-full text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 disabled:opacity-50 transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>Move to Trash</span>
                              </button>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>

      {/* Confirmation Modal ("Move all duplicates to Trash" or Shared-Item Warning) */}
      {confirmAction && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
          onClick={() => {
            if (!busyAll && !busyGroupId) setConfirmAction(null);
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-duplicates-modal-title"
        >
          <div
            className="w-full max-w-md rounded-3xl bg-white dark:bg-[#1E1F20] p-6 shadow-2xl border border-black/[0.06] dark:border-white/[0.08]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#C2E7FF] dark:bg-[#004A77] text-[#001D35] dark:text-[#C2E7FF] flex items-center justify-center shrink-0">
                  <Trash2 className="w-5 h-5" />
                </div>
                <h2
                  id="confirm-duplicates-modal-title"
                  className="text-lg font-medium text-[#1F1F1F] dark:text-[#E3E3E3]"
                >
                  {confirmAction.title}
                </h2>
              </div>
              <button
                type="button"
                disabled={busyAll || Boolean(busyGroupId)}
                onClick={() => setConfirmAction(null)}
                className="w-10 h-10 rounded-full flex items-center justify-center text-[#444746] dark:text-[#C4C7C5] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] disabled:opacity-50 cursor-pointer shrink-0"
                aria-label="Cancel"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4 space-y-2.5 text-sm leading-relaxed text-[#444746] dark:text-[#C4C7C5]">
              <p>
                <strong className="font-medium text-[#1F1F1F] dark:text-[#E3E3E3] tabular-nums">
                  {confirmAction.trashCount} {confirmAction.trashCount === 1 ? 'photo' : 'photos'} (
                  {formatBytes(confirmAction.freedBytes)})
                </strong>{' '}
                will be moved to Trash
                {confirmAction.mode === 'all'
                  ? ` across ${confirmAction.groupCount} ${confirmAction.groupCount === 1 ? 'group' : 'groups'}.`
                  : '.'}
              </p>

              <ul className="space-y-1.5 text-xs text-[#5F6368] dark:text-[#9AA0A6] list-disc pl-4">
                <li>
                  {confirmAction.mode === 'all'
                    ? 'The suggested best copy in each group is kept, and album memberships & favorites from trashed copies are transferred to it.'
                    : `"${confirmAction.keepFilename || 'The kept copy'}" will be kept with any albums and favorite status preserved.`}
                </li>
                <li>Moved items can be restored from Trash at any time.</li>
                <li>On read-only NAS storage, original files stay untouched on the NAS.</li>
              </ul>

              {confirmAction.sharedTrashCount > 0 && (
                <div className="mt-3 rounded-2xl bg-amber-500/12 border border-amber-500/30 p-3 flex items-start gap-2.5 text-xs text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    Warning: {confirmAction.sharedTrashCount}{' '}
                    {confirmAction.sharedTrashCount === 1 ? 'copy being moved to Trash is' : 'copies being moved to Trash are'}{' '}
                    currently part of an active public share or shared album. Moving a directly shared item to Trash will hide it from its share link.
                  </span>
                </div>
              )}
            </div>

            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={busyAll || Boolean(busyGroupId)}
                onClick={() => setConfirmAction(null)}
                className="min-h-[44px] sm:min-h-[38px] rounded-full px-4 text-xs sm:text-sm font-medium text-[#444746] dark:text-[#C4C7C5] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] disabled:opacity-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busyAll || Boolean(busyGroupId)}
                onClick={() => {
                  void confirmAction.onConfirm();
                }}
                className="inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-[38px] rounded-full bg-[#0B57D0] dark:bg-[#A8C7FA] hover:opacity-95 disabled:opacity-50 px-5 text-xs sm:text-sm font-medium text-white dark:text-[#062E6F] shadow-xs transition-opacity cursor-pointer"
              >
                {busyAll || Boolean(busyGroupId) ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                <span>{busyAll || Boolean(busyGroupId) ? 'Moving…' : 'Move to Trash'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
