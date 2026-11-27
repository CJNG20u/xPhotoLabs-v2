import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  AlbumSummary,
  FolderSyncProgress,
  MediaItem,
  NavView,
  PlaceCluster,
  ShareLinkItem,
  StorageMount,
  StorageOverview,
  SyncTokenItem,
} from './types';
import {
  batchMediaAction,
  emptyTrash,
  fetchAlbums,
  fetchDuplicatesStatus,
  fetchMedia,
  fetchMounts,
  fetchPlaces,
  fetchShares,
  fetchStorageOverview,
  fetchSyncTokens,
  patchMedia,
  uploadFiles,
} from './lib/api';
import {
  clearSavedDirectoryHandle,
  ensureDirectoryPermission,
  getAutoSyncOnOpenPref,
  loadSavedDirectoryHandle,
  queryDirectoryPermission,
  runDeduplicatedFileSync,
  saveDirectoryHandle,
  setAutoSyncOnOpenPref,
  supportsDirectoryPicker,
  syncDirectoryHandle,
} from './lib/folderSync';
import { TopBar } from './components/TopBar';
import { NavRail } from './components/NavRail';
import { VirtualizedTimelineGrid } from './components/VirtualizedTimelineGrid';
import { Lightbox } from './components/Lightbox';
import { AlbumsView } from './components/AlbumsView';
import { PlacesView } from './components/PlacesView';
import { DuplicatesView } from './components/DuplicatesView';
import { StorageMountsView } from './components/StorageMountsView';
import { ShareModal } from './components/ShareModal';
import { AddToAlbumModal } from './components/AddToAlbumModal';
import { PublicSharePage } from './components/PublicSharePage';
import { OfflineIndicator } from './components/OfflineIndicator';
import { FloatingBulkActionBar } from './components/FloatingBulkActionBar';
import { ConfirmPermanentDeleteModal } from './components/ConfirmPermanentDeleteModal';
import { GridDensityToggle } from './components/GridDensityToggle';
import { useGridColumns } from './hooks/useGridColumns';

const IDLE_SYNC: FolderSyncProgress = {
  phase: 'idle',
  totalFiles: 0,
  processedFiles: 0,
  uploadedCount: 0,
  skippedCount: 0,
  errorCount: 0,
  message: '',
};

export default function App() {
  const sharePathMatch =
    typeof window !== 'undefined' ? window.location.pathname.match(/^\/s\/([^/]+)$/) : null;
  if (sharePathMatch) {
    return <PublicSharePage token={decodeURIComponent(sharePathMatch[1])} />;
  }

  return <GalleryWorkspace />;
}

function GalleryWorkspace() {
  // Default to Google Photos Light Mode unless user explicitly chose Dark Mode
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('xphotolabs_theme');
      if (saved === 'dark' || saved === 'light') return saved;
      return 'light';
    } catch {
      return 'light';
    }
  });

  const [activeView, setActiveView] = useState<NavView>('photos');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mediaTypeFilter, setMediaTypeFilter] = useState<'' | 'image' | 'video'>('');
  const {
    columns: gridColumns,
    options: gridColumnOptions,
    setColumns: setGridColumns,
  } = useGridColumns();

  // Data state
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(true);
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [activeAlbum, setActiveAlbum] = useState<AlbumSummary | null>(null);
  const [albumItems, setAlbumItems] = useState<MediaItem[]>([]);
  const [places, setPlaces] = useState<PlaceCluster[]>([]);
  const [activePlace, setActivePlace] = useState<string | null>(null);
  const [placeItems, setPlaceItems] = useState<MediaItem[]>([]);
  const [storageOverview, setStorageOverview] = useState<StorageOverview | null>(null);
  const [mounts, setMounts] = useState<StorageMount[]>([]);
  const [shares, setShares] = useState<ShareLinkItem[]>([]);
  const [syncTokens, setSyncTokens] = useState<SyncTokenItem[]>([]);
  const [hasEnvToken, setHasEnvToken] = useState(false);

  // Interactive UI state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [shareTarget, setShareTarget] = useState<{
    targetType: 'media' | 'album';
    targetId: string;
    title: string;
  } | null>(null);
  const [albumModalMediaIds, setAlbumModalMediaIds] = useState<string[] | null>(null);
  const [pendingPermanentDelete, setPendingPermanentDelete] = useState<{
    mode: 'selected' | 'emptyTrash';
    count: number;
  } | null>(null);
  const [deletingPermanently, setDeletingPermanently] = useState(false);
  const [duplicatesCount, setDuplicatesCount] = useState(0);
  const [duplicatesRefreshKey, setDuplicatesRefreshKey] = useState(0);
  const [compareLightboxItems, setCompareLightboxItems] = useState<MediaItem[] | null>(null);
  const [toastState, setToastState] = useState<{
    message: string;
    undoIds?: string[];
  } | null>(null);
  const [isDraggingUpload, setIsDraggingUpload] = useState(false);

  // Folder Auto-Sync (File System Access API + IndexedDB)
  const [savedFolderHandle, setSavedFolderHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [autoSyncOnOpen, setAutoSyncOnOpen] = useState<boolean>(() => getAutoSyncOnOpenPref());
  const [folderSyncProgress, setFolderSyncProgress] = useState<FolderSyncProgress>(IDLE_SYNC);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderFallbackInputRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback((msg: string) => {
    setToastState({ message: msg });
  }, []);

  const showUndoTrashToast = useCallback((msg: string, undoIds: string[]) => {
    setToastState({ message: msg, undoIds });
  }, []);

  useEffect(() => {
    if (!toastState) return;
    const timeoutMs = toastState.undoIds && toastState.undoIds.length > 0 ? 8000 : 4500;
    const t = setTimeout(() => setToastState(null), timeoutMs);
    return () => clearTimeout(t);
  }, [toastState]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem('xphotolabs_theme', theme);
    } catch {
      // ignore
    }
  }, [theme]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shared = params.get('shared');
    if (shared) {
      showToast(`Received ${shared} shared ${Number(shared) === 1 ? 'file' : 'files'} into your library.`);
      window.history.replaceState({}, '', '/');
    }
  }, [showToast]);

  const loadOverviewAndMeta = useCallback(async () => {
    const [ov, alb, plc, sh, dup] = await Promise.all([
      fetchStorageOverview(),
      fetchAlbums(),
      fetchPlaces(),
      fetchShares(),
      fetchDuplicatesStatus().catch(() => null),
    ]);
    setStorageOverview(ov);
    setAlbums(alb.albums);
    setPlaces(plc.places);
    setShares(sh.shares);
    if (dup) setDuplicatesCount(dup.groupCount);
  }, []);

  const loadMountsAndTokens = useCallback(async () => {
    const [m, t] = await Promise.all([fetchMounts(), fetchSyncTokens()]);
    setMounts(m.mounts);
    setSyncTokens(t.tokens);
    setHasEnvToken(t.hasEnvToken);
  }, []);

  const loadCurrentTimeline = useCallback(async () => {
    setLoadingMedia(true);
    try {
      const viewParam =
        activeView === 'favorites' ? 'favorites' : activeView === 'trash' ? 'trash' : 'photos';
      const res = await fetchMedia({
        view: viewParam,
        type: mediaTypeFilter || undefined,
      });
      setMediaItems(res.items);
    } finally {
      setLoadingMedia(false);
    }
  }, [activeView, mediaTypeFilter]);

  const refreshEverything = useCallback(async () => {
    await Promise.all([loadCurrentTimeline(), loadOverviewAndMeta(), loadMountsAndTokens()]);
    if (activeAlbum) {
      const res = await fetchMedia({ albumId: activeAlbum.id });
      setAlbumItems(res.items);
    }
    if (activePlace) {
      const res = await fetchMedia({ place: activePlace });
      setPlaceItems(res.items);
    }
  }, [loadCurrentTimeline, loadOverviewAndMeta, loadMountsAndTokens, activeAlbum, activePlace]);

  useEffect(() => {
    loadCurrentTimeline();
  }, [loadCurrentTimeline]);

  useEffect(() => {
    loadOverviewAndMeta();
    loadMountsAndTokens();
  }, [loadOverviewAndMeta, loadMountsAndTokens]);

  useEffect(() => {
    if (!activeAlbum) {
      setAlbumItems([]);
      return;
    }
    fetchMedia({
      albumId: activeAlbum.id,
      type: mediaTypeFilter || undefined,
    }).then((res) => setAlbumItems(res.items));
  }, [activeAlbum, mediaTypeFilter]);

  useEffect(() => {
    if (!activePlace) {
      setPlaceItems([]);
      return;
    }
    fetchMedia({
      place: activePlace,
      type: mediaTypeFilter || undefined,
    }).then((res) => setPlaceItems(res.items));
  }, [activePlace, mediaTypeFilter]);

  useEffect(() => {
    let active = true;
    loadSavedDirectoryHandle().then(async (handle) => {
      if (!active || !handle) return;
      setSavedFolderHandle(handle);
      if (!getAutoSyncOnOpenPref()) return;
      try {
        const perm = await queryDirectoryPermission(handle);
        if (perm === 'granted' && active) {
          const result = await syncDirectoryHandle(handle, (p) => {
            if (active) setFolderSyncProgress(p);
          });
          if (active && result.uploadedCount > 0) {
            showToast(result.message);
            refreshEverything();
          }
        }
      } catch {
        // Defer until explicit click if user gesture required
      }
    });
    return () => {
      active = false;
    };
  }, [refreshEverything, showToast]);

  const handleSyncWithHandle = useCallback(
    async (handle: FileSystemDirectoryHandle) => {
      try {
        const granted = await ensureDirectoryPermission(handle);
        if (!granted) {
          showToast('Read permission is required to sync that folder.');
          return;
        }
        const summary = await syncDirectoryHandle(handle, setFolderSyncProgress);
        showToast(summary.message);
        if (summary.uploadedCount > 0) {
          await refreshEverything();
        }
      } catch (err) {
        setFolderSyncProgress({
          ...IDLE_SYNC,
          phase: 'error',
          message: err instanceof Error ? err.message : 'Folder sync failed',
        });
        showToast(err instanceof Error ? err.message : 'Folder sync failed');
      }
    },
    [refreshEverything, showToast]
  );

  const handlePickSyncFolder = useCallback(async () => {
    if (supportsDirectoryPicker() && window.showDirectoryPicker) {
      try {
        const handle = await window.showDirectoryPicker({ id: 'xphotolabs-sync', mode: 'read' });
        await saveDirectoryHandle(handle);
        setSavedFolderHandle(handle);
        await handleSyncWithHandle(handle);
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }
    folderFallbackInputRef.current?.click();
  }, [handleSyncWithHandle]);

  const handleTopBarFolderSync = useCallback(async () => {
    if (savedFolderHandle) {
      await handleSyncWithHandle(savedFolderHandle);
    } else {
      await handlePickSyncFolder();
    }
  }, [savedFolderHandle, handleSyncWithHandle, handlePickSyncFolder]);

  const handleFallbackFolderInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    const firstRel = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath || '';
    const folderName = firstRel.split('/')[0] || 'Selected Folder';
    try {
      const summary = await runDeduplicatedFileSync(files, folderName, setFolderSyncProgress);
      showToast(summary.message);
      if (summary.uploadedCount > 0) await refreshEverything();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Folder sync failed');
    } finally {
      e.target.value = '';
    }
  };

  const handleDisconnectSyncFolder = async () => {
    await clearSavedDirectoryHandle();
    setSavedFolderHandle(null);
    setFolderSyncProgress(IDLE_SYNC);
    showToast('Disconnected remembered sync folder.');
  };

  const handleDirectUploadFiles = async (files: File[]) => {
    if (files.length === 0) return;
    showToast(`Uploading ${files.length} ${files.length === 1 ? 'file' : 'files'}…`);
    try {
      const res = await uploadFiles(files);
      const parts: string[] = [];
      if (res.uploaded.length > 0) parts.push(`${res.uploaded.length} uploaded`);
      if (res.duplicates.length > 0) parts.push(`${res.duplicates.length} duplicate skipped`);
      if (res.errors.length > 0) parts.push(`${res.errors.length} unsupported`);
      showToast(parts.join(' · ') || 'Upload finished');
      await refreshEverything();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Upload failed');
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    await handleDirectUploadFiles(files);
  };

  const activeLightboxList = compareLightboxItems
    ? compareLightboxItems
    : activeView === 'albums' && activeAlbum
      ? albumItems
      : activeView === 'places' && activePlace
        ? placeItems
        : mediaItems;

  const handleToggleFavorite = async (item: MediaItem) => {
    const nextVal = !item.isFavorite;
    const patchList = (list: MediaItem[]) =>
      list.map((m) => (m.id === item.id ? { ...m, isFavorite: nextVal } : m));
    setMediaItems(patchList);
    setAlbumItems(patchList);
    setPlaceItems(patchList);
    await patchMedia(item.id, { isFavorite: nextVal });
    if (activeView === 'favorites' && !nextVal) {
      await loadCurrentTimeline();
    }
  };

  const handleTrashSingle = async (item: MediaItem) => {
    await patchMedia(item.id, { isTrashed: true });
    setLightboxIndex(null);
    showToast(`Moved "${item.filename}" to Trash.`);
    await refreshEverything();
  };

  const selectModeActive = isSelectMode || selectedIds.size > 0;

  const allSelectedFavorited = useMemo(() => {
    if (selectedIds.size === 0) return false;
    const selectedItems = activeLightboxList.filter((m) => selectedIds.has(m.id));
    return selectedItems.length > 0 && selectedItems.every((m) => m.isFavorite);
  }, [activeLightboxList, selectedIds]);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setIsSelectMode(false);
  }, []);

  const handleToggleSelectMode = useCallback(() => {
    if (isSelectMode || selectedIds.size > 0) {
      setSelectedIds(new Set());
      setIsSelectMode(false);
    } else {
      setIsSelectMode(true);
    }
  }, [isSelectMode, selectedIds.size]);

  useEffect(() => {
    if (
      !selectModeActive ||
      lightboxIndex !== null ||
      shareTarget ||
      albumModalMediaIds ||
      pendingPermanentDelete
    ) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClearSelection();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    selectModeActive,
    lightboxIndex,
    shareTarget,
    albumModalMediaIds,
    pendingPermanentDelete,
    handleClearSelection,
  ]);

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleSelectAll = () => {
    const visibleIds = activeLightboxList.map((m) => m.id);
    if (visibleIds.length === 0) return;
    const allVisibleSelected = visibleIds.every((id) => selectedIds.has(id));
    if (allVisibleSelected) {
      setSelectedIds(new Set());
    } else {
      setIsSelectMode(true);
      setSelectedIds(new Set(visibleIds));
    }
  };

  const handleBatchAction = async (
    action: 'favorite' | 'unfavorite' | 'trash' | 'restore' | 'delete'
  ) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const res = await batchMediaAction({ ids, action });
    setSelectedIds(new Set());
    setIsSelectMode(false);
    const count = res.affected || ids.length;
    const labelMap = {
      favorite: `Added ${count} to Favorites.`,
      unfavorite: `Removed ${count} from Favorites.`,
      trash: `Moved ${count} to Trash.`,
      restore: `Restored ${count} from Trash.`,
      delete: `Permanently deleted ${count} ${count === 1 ? 'file' : 'files'} from disk.`,
    };
    showToast(labelMap[action]);
    await refreshEverything();
  };

  const handleEmptyTrash = async () => {
    const res = await emptyTrash();
    setSelectedIds(new Set());
    setIsSelectMode(false);
    showToast(
      `Emptied Trash — permanently deleted ${res.emptied} ${res.emptied === 1 ? 'file' : 'files'} from disk.`
    );
    await refreshEverything();
  };

  const handleConfirmPermanentDelete = async () => {
    if (!pendingPermanentDelete) return;
    setDeletingPermanently(true);
    try {
      if (pendingPermanentDelete.mode === 'emptyTrash') {
        await handleEmptyTrash();
      } else {
        await handleBatchAction('delete');
      }
      setPendingPermanentDelete(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Permanent delete failed');
    } finally {
      setDeletingPermanently(false);
    }
  };

  const handleSelectView = (view: NavView) => {
    setActiveView(view);
    setSelectedIds(new Set());
    setIsSelectMode(false);
    setCompareLightboxItems(null);
    if (view !== 'albums') setActiveAlbum(null);
    if (view !== 'places') setActivePlace(null);
  };

  const handleUndoTrash = async (ids: string[]) => {
    if (ids.length === 0) return;
    try {
      await batchMediaAction({ ids, action: 'restore' });
      setToastState({
        message: `Restored ${ids.length} ${ids.length === 1 ? 'item' : 'items'} from Trash.`,
      });
      setDuplicatesRefreshKey((k) => k + 1);
      await refreshEverything();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Undo failed');
    }
  };

  const gridDensityControl = (
    <GridDensityToggle
      columns={gridColumns}
      options={gridColumnOptions}
      onChange={setGridColumns}
    />
  );

  // Compact Material 3 Filter Chips + Select Toggle + Grid Density Toggle for Photos & Favorites
  const timelineTopContent =
    activeView === 'photos' || activeView === 'favorites' ? (
      <div className="pt-1 pb-2">
        <div className="flex items-center gap-1.5 sm:gap-2 py-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0" role="group" aria-label="Filter media type">
            {(
              [
                { id: '', label: 'All' },
                { id: 'image', label: 'Photos' },
                { id: 'video', label: 'Videos' },
              ] as const
            ).map((chip) => {
              const active = mediaTypeFilter === chip.id;
              return (
                <button
                  key={chip.id || 'all'}
                  type="button"
                  onClick={() => setMediaTypeFilter(chip.id)}
                  className={`inline-flex items-center gap-1.5 h-8 px-2.5 sm:px-3.5 rounded-lg text-[13px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-[#C2E7FF] text-[#001D35] dark:bg-[#004A77] dark:text-[#C2E7FF]'
                      : 'border border-neutral-300 dark:border-neutral-700 text-[#444746] dark:text-[#C4C7C5] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                  }`}
                >
                  {active && <Check className="w-3.5 h-3.5 stroke-[2.4]" />}
                  <span>{chip.label}</span>
                </button>
              );
            })}
          </div>

          <span
            aria-hidden="true"
            className="w-px h-5 bg-neutral-200 dark:bg-neutral-800 mx-0.5 shrink-0"
          />

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {mediaItems.length > 0 && (
              <button
                type="button"
                onClick={handleToggleSelectMode}
                aria-pressed={selectModeActive}
                className={`inline-flex items-center gap-1.5 h-8 px-2.5 sm:px-3.5 rounded-lg text-[13px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  selectModeActive
                    ? 'bg-[#C2E7FF] text-[#001D35] dark:bg-[#004A77] dark:text-[#C2E7FF]'
                    : 'border border-neutral-300 dark:border-neutral-700 text-[#444746] dark:text-[#C4C7C5] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{selectModeActive ? 'Done' : 'Select'}</span>
              </button>
            )}

            {gridDensityControl}
          </div>
        </div>
      </div>
    ) : undefined;

  return (
    <div
      className="h-screen flex flex-col bg-white dark:bg-[#131314] text-[#1F1F1F] dark:text-[#E3E3E3] overflow-hidden"
      onDragOver={(e) => {
        e.preventDefault();
        if (!isDraggingUpload) setIsDraggingUpload(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setIsDraggingUpload(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDraggingUpload(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) handleDirectUploadFiles(files);
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/*"
        onChange={handleFileInputChange}
        className="hidden"
      />
      <input
        ref={folderFallbackInputRef}
        type="file"
        multiple
        // @ts-expect-error webkitdirectory supported by browsers for folder fallback
        webkitdirectory=""
        onChange={handleFallbackFolderInput}
        className="hidden"
      />

      {/* Top 64px Borderless Material App Bar */}
      <TopBar
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        onOpenMobileNav={() => setMobileNavOpen(true)}
        onTriggerUpload={() => fileInputRef.current?.click()}
        onTriggerFolderSync={handleTopBarFolderSync}
        savedFolderName={savedFolderHandle?.name ?? null}
        folderSyncProgress={folderSyncProgress}
      />

      {/* Sleek Floating Multi-Select Bulk Action Bar */}
      <FloatingBulkActionBar
        selectedCount={selectedIds.size}
        totalCount={activeLightboxList.length}
        isTrashView={activeView === 'trash'}
        allSelectedFavorited={allSelectedFavorited}
        onClearSelection={handleClearSelection}
        onToggleSelectAll={handleToggleSelectAll}
        onToggleFavoriteSelected={() =>
          handleBatchAction(allSelectedFavorited ? 'unfavorite' : 'favorite')
        }
        onAddToAlbum={() => setAlbumModalMediaIds(Array.from(selectedIds))}
        onTrashSelected={() => handleBatchAction('trash')}
        onRestoreSelected={() => handleBatchAction('restore')}
        onDeletePermanentlySelected={() =>
          setPendingPermanentDelete({ mode: 'selected', count: selectedIds.size })
        }
      />

      {/* Main Material Workspace Split */}
      <div className="flex-1 flex min-h-0">
        <NavRail
          activeView={activeView}
          onSelectView={handleSelectView}
          storageOverview={storageOverview}
          duplicatesCount={duplicatesCount}
          mobileOpen={mobileNavOpen}
          onCloseMobile={() => setMobileNavOpen(false)}
        />

        <main className="flex-1 flex flex-col min-w-0 min-h-0 bg-white dark:bg-[#131314]">
          {activeView === 'albums' ? (
            <AlbumsView
              albums={albums}
              shares={shares}
              activeAlbum={activeAlbum}
              albumItems={albumItems}
              selectedIds={selectedIds}
              selectMode={selectModeActive}
              columns={gridColumns}
              gridDensityControl={gridDensityControl}
              onToggleSelectMode={handleToggleSelectMode}
              onSelectAlbum={(alb) => {
                setSelectedIds(new Set());
                setIsSelectMode(false);
                setActiveAlbum(alb);
              }}
              onToggleSelect={handleToggleSelect}
              onOpenLightbox={(idx) => setLightboxIndex(idx)}
              onToggleFavorite={handleToggleFavorite}
              onOpenShareAlbum={(alb) =>
                setShareTarget({ targetType: 'album', targetId: alb.id, title: alb.title })
              }
              onRefreshAlbumsAndShares={loadOverviewAndMeta}
            />
          ) : activeView === 'places' ? (
            <PlacesView
              places={places}
              activePlace={activePlace}
              placeItems={placeItems}
              selectedIds={selectedIds}
              selectMode={selectModeActive}
              columns={gridColumns}
              gridDensityControl={gridDensityControl}
              onToggleSelectMode={handleToggleSelectMode}
              onSelectPlace={(p) => {
                setSelectedIds(new Set());
                setIsSelectMode(false);
                setActivePlace(p);
              }}
              onToggleSelect={handleToggleSelect}
              onOpenLightbox={(idx) => setLightboxIndex(idx)}
              onToggleFavorite={handleToggleFavorite}
            />
          ) : activeView === 'duplicates' ? (
            <DuplicatesView
              refreshTrigger={duplicatesRefreshKey}
              onGroupCountChange={setDuplicatesCount}
              onRefreshAfterChange={refreshEverything}
              onShowUndoToast={showUndoTrashToast}
              onShowToast={showToast}
              onOpenCompareLightbox={(items, startIdx) => {
                setCompareLightboxItems(items);
                setLightboxIndex(startIdx);
              }}
            />
          ) : activeView === 'mounts' ? (
            <StorageMountsView
              overview={storageOverview}
              mounts={mounts}
              tokens={syncTokens}
              hasEnvToken={hasEnvToken}
              savedFolderName={savedFolderHandle?.name ?? null}
              autoSyncOnOpen={autoSyncOnOpen}
              folderSyncProgress={folderSyncProgress}
              onToggleAutoSyncOnOpen={(val) => {
                setAutoSyncOnOpen(val);
                setAutoSyncOnOpenPref(val);
              }}
              onPickSyncFolder={handlePickSyncFolder}
              onSyncNow={handleTopBarFolderSync}
              onDisconnectSyncFolder={handleDisconnectSyncFolder}
              onRefreshAll={refreshEverything}
            />
          ) : (
            <>
              {activeView === 'trash' && (
                <div className="px-4 lg:px-7 py-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h1 className="text-2xl font-normal tracking-tight text-[#1F1F1F] dark:text-[#E3E3E3]">
                      Trash
                    </h1>
                    <p className="mt-0.5 text-xs text-[#747775] dark:text-[#8E918F]">
                      Permanently deleting items removes their original files from storage and cannot be undone.
                    </p>
                  </div>
                  {mediaItems.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={handleToggleSelectMode}
                        aria-pressed={selectModeActive}
                        className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                          selectModeActive
                            ? 'bg-[#C2E7FF] text-[#001D35] dark:bg-[#004A77] dark:text-[#C2E7FF]'
                            : 'border border-neutral-300 dark:border-neutral-700 text-[#444746] dark:text-[#C4C7C5] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                        }`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{selectModeActive ? 'Done' : 'Select'}</span>
                      </button>
                      {gridDensityControl}
                      <button
                        type="button"
                        onClick={() =>
                          setPendingPermanentDelete({ mode: 'emptyTrash', count: mediaItems.length })
                        }
                        className="inline-flex items-center gap-1.5 rounded-full bg-[#F8FAFD] dark:bg-[#282A2C] px-4 py-2 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Empty trash
                      </button>
                    </div>
                  )}
                </div>
              )}

              {loadingMedia && mediaItems.length === 0 ? (
                <div className="flex-1 px-4 lg:px-7 py-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1 content-start">
                  {Array.from({ length: 8 }).map((_, idx) => (
                    <div
                      key={idx}
                      className="h-52 bg-neutral-100 dark:bg-[#1E1F20] animate-pulse"
                    />
                  ))}
                </div>
              ) : (
                <VirtualizedTimelineGrid
                  items={mediaItems}
                  selectedIds={selectedIds}
                  selectMode={selectModeActive}
                  columns={gridColumns}
                  onToggleSelect={handleToggleSelect}
                  onOpenLightbox={(idx) => setLightboxIndex(idx)}
                  onToggleFavorite={activeView === 'trash' ? undefined : handleToggleFavorite}
                  topContent={timelineTopContent}
                  emptyTitle={
                    activeView === 'favorites'
                      ? 'No favorites yet'
                      : activeView === 'trash'
                        ? 'Trash is empty'
                        : 'Your gallery is empty'
                  }
                  emptyDescription={
                    activeView === 'favorites'
                      ? 'Star your favorite moments to collect them here.'
                      : activeView === 'trash'
                        ? 'Items moved to Trash appear here until restored or emptied.'
                        : 'Upload photos and videos, link a folder for auto-sync, or add a read-only NAS mount.'
                  }
                  emptyAction={
                    activeView === 'photos' ? (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="inline-flex items-center gap-2 rounded-full bg-[#0B57D0] dark:bg-[#A8C7FA] px-5 py-2.5 text-sm font-medium text-white dark:text-[#062E6F] cursor-pointer"
                      >
                        <Upload className="w-4 h-4" />
                        Upload photos
                      </button>
                    ) : undefined
                  }
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Drag-and-drop full-window upload overlay */}
      {isDraggingUpload && (
        <div className="pointer-events-none fixed inset-0 z-50 bg-[#0B57D0]/12 backdrop-blur-xs border-2 border-dashed border-[#0B57D0] dark:border-[#A8C7FA] flex items-center justify-center">
          <div className="rounded-3xl bg-white dark:bg-[#1E1F20] px-8 py-6 shadow-2xl text-center">
            <Upload className="w-7 h-7 text-[#0B57D0] dark:text-[#A8C7FA] mx-auto mb-2" />
            <div className="text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
              Drop photos or videos to upload
            </div>
            <div className="mt-1 text-xs text-[#747775] dark:text-[#8E918F]">
              SHA-256 deduplication runs automatically on ingest
            </div>
          </div>
        </div>
      )}

      {/* Full-screen Lightbox Viewer */}
      {lightboxIndex !== null && (
        <Lightbox
          items={activeLightboxList}
          currentIndex={lightboxIndex}
          onChangeIndex={setLightboxIndex}
          onClose={() => {
            setLightboxIndex(null);
            setCompareLightboxItems(null);
          }}
          readOnly={Boolean(compareLightboxItems)}
          onToggleFavorite={activeView === 'trash' || compareLightboxItems ? undefined : handleToggleFavorite}
          onTrash={activeView === 'trash' || compareLightboxItems ? undefined : handleTrashSingle}
          onOpenAddToAlbum={
            activeView === 'trash' || compareLightboxItems
              ? undefined
              : (item) => setAlbumModalMediaIds([item.id])
          }
          onOpenShare={
            activeView === 'trash' || compareLightboxItems
              ? undefined
              : (item) =>
                  setShareTarget({ targetType: 'media', targetId: item.id, title: item.filename })
          }
        />
      )}

      {/* Share Link Modal */}
      {shareTarget && (
        <ShareModal
          targetType={shareTarget.targetType}
          targetId={shareTarget.targetId}
          targetTitle={shareTarget.title}
          onClose={() => setShareTarget(null)}
          onCreated={() => {
            loadOverviewAndMeta();
          }}
        />
      )}

      {/* Add to Album Modal */}
      {albumModalMediaIds && (
        <AddToAlbumModal
          mediaIds={albumModalMediaIds}
          albums={albums}
          onClose={() => setAlbumModalMediaIds(null)}
          onUpdated={() => {
            setSelectedIds(new Set());
            setIsSelectMode(false);
            showToast('Added to album.');
            refreshEverything();
          }}
        />
      )}

      {/* Confirm Permanent Delete Modal */}
      {pendingPermanentDelete && (
        <ConfirmPermanentDeleteModal
          mode={pendingPermanentDelete.mode}
          itemCount={pendingPermanentDelete.count}
          busy={deletingPermanently}
          onCancel={() => setPendingPermanentDelete(null)}
          onConfirm={handleConfirmPermanentDelete}
        />
      )}

      {/* Material 3 Snackbar Toast (with optional Undo action) */}
      {toastState && (
        <div
          role="status"
          className="fixed bottom-5 right-5 z-40 max-w-md rounded-full bg-[#1F1F1F] dark:bg-[#E3E3E3] text-white dark:text-[#1F1F1F] px-4 py-2.5 text-xs font-medium shadow-xl flex items-center gap-2.5"
        >
          <CheckCircle2 className="w-4 h-4 text-[#A8C7FA] dark:text-[#0B57D0] shrink-0" />
          <span>{toastState.message}</span>
          {toastState.undoIds && toastState.undoIds.length > 0 && (
            <button
              type="button"
              onClick={() => {
                const ids = toastState.undoIds!;
                void handleUndoTrash(ids);
              }}
              className="ml-1 px-2.5 py-1 rounded-full bg-white/15 dark:bg-black/10 text-[#A8C7FA] dark:text-[#0B57D0] font-semibold hover:bg-white/25 dark:hover:bg-black/15 transition-colors cursor-pointer whitespace-nowrap"
            >
              Undo
            </button>
          )}
        </div>
      )}

      <OfflineIndicator />
    </div>
  );
}
