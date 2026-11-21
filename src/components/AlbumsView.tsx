import React, { useState } from 'react';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  FolderPlus,
  Image as ImageIcon,
  Link2,
  Plus,
  Share2,
  Trash2,
  X,
} from 'lucide-react';
import type { AlbumSummary, MediaItem, ShareLinkItem } from '../types';
import { createAlbum, deleteAlbum, revokeShareLink } from '../lib/api';
import { VirtualizedTimelineGrid } from './VirtualizedTimelineGrid';

interface AlbumsViewProps {
  albums: AlbumSummary[];
  shares: ShareLinkItem[];
  activeAlbum: AlbumSummary | null;
  albumItems: MediaItem[];
  selectedIds: Set<string>;
  selectMode: boolean;
  columns: number;
  gridDensityControl?: React.ReactNode;
  onToggleSelectMode: () => void;
  onSelectAlbum: (album: AlbumSummary | null) => void;
  onToggleSelect: (id: string) => void;
  onOpenLightbox: (index: number) => void;
  onToggleFavorite: (item: MediaItem) => void;
  onOpenShareAlbum: (album: AlbumSummary) => void;
  onRefreshAlbumsAndShares: () => void;
}

export const AlbumsView: React.FC<AlbumsViewProps> = ({
  albums,
  shares,
  activeAlbum,
  albumItems,
  selectedIds,
  selectMode,
  columns,
  gridDensityControl,
  onToggleSelectMode,
  onSelectAlbum,
  onToggleSelect,
  onOpenLightbox,
  onToggleFavorite,
  onOpenShareAlbum,
  onRefreshAlbumsAndShares,
}) => {
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    try {
      await createAlbum({ title: title.trim(), description: description.trim() });
      setTitle('');
      setDescription('');
      setShowCreate(false);
      onRefreshAlbumsAndShares();
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteAlbum = async (album: AlbumSummary) => {
    await deleteAlbum(album.id);
    if (activeAlbum?.id === album.id) onSelectAlbum(null);
    onRefreshAlbumsAndShares();
  };

  const handleRevokeShare = async (shareId: string) => {
    await revokeShareLink(shareId);
    onRefreshAlbumsAndShares();
  };

  const handleCopyShare = async (share: ShareLinkItem) => {
    await navigator.clipboard.writeText(`${window.location.origin}${share.sharePath}`);
    setCopiedId(share.id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  if (activeAlbum) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-4 lg:px-7 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => onSelectAlbum(null)}
              className="w-10 h-10 -ml-2 rounded-full flex items-center justify-center text-[#444746] dark:text-[#C4C7C5] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] cursor-pointer"
              aria-label="Back to albums"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h1 className="text-2xl font-normal tracking-tight text-[#1F1F1F] dark:text-[#E3E3E3] truncate">
                {activeAlbum.title}
              </h1>
              <p className="text-xs text-[#747775] dark:text-[#8E918F] tabular-nums truncate">
                {albumItems.length} {albumItems.length === 1 ? 'item' : 'items'}
                {activeAlbum.description ? ` · ${activeAlbum.description}` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {albumItems.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={onToggleSelectMode}
                  aria-pressed={selectMode}
                  className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    selectMode
                      ? 'bg-[#C2E7FF] text-[#001D35] dark:bg-[#004A77] dark:text-[#C2E7FF]'
                      : 'border border-neutral-300 dark:border-neutral-700 text-[#444746] dark:text-[#C4C7C5] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{selectMode ? 'Done' : 'Select'}</span>
                </button>
                {gridDensityControl}
              </>
            )}
            <button
              type="button"
              onClick={() => onOpenShareAlbum(activeAlbum)}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#C2E7FF] dark:bg-[#004A77] px-4 py-2 text-xs font-semibold text-[#001D35] dark:text-[#C2E7FF] hover:opacity-95 cursor-pointer"
            >
              <Share2 className="w-3.5 h-3.5" />
              Share
            </button>
            <button
              type="button"
              onClick={() => handleDeleteAlbum(activeAlbum)}
              className="w-9 h-9 rounded-full flex items-center justify-center text-[#444746] dark:text-[#C4C7C5] hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
              title="Delete album"
              aria-label="Delete album"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        <VirtualizedTimelineGrid
          items={albumItems}
          selectedIds={selectedIds}
          selectMode={selectMode}
          columns={columns}
          onToggleSelect={onToggleSelect}
          onOpenLightbox={onOpenLightbox}
          onToggleFavorite={onToggleFavorite}
          emptyTitle="This album is empty"
          emptyDescription="Select photos from your timeline and use Add to album to organize them here."
        />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 lg:px-8 py-6 space-y-10">
      {/* Albums Header */}
      <section>
        <div className="flex items-center justify-between gap-4 mb-6">
          <h1 className="text-2xl font-normal tracking-tight text-[#1F1F1F] dark:text-[#E3E3E3]">
            Albums
          </h1>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 rounded-full bg-[#C2E7FF] dark:bg-[#004A77] px-4 py-2.5 text-sm font-semibold text-[#001D35] dark:text-[#C2E7FF] hover:shadow-xs transition-all whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Create album
          </button>
        </div>

        {albums.length === 0 ? (
          <div className="py-16 text-center rounded-3xl bg-[#F8FAFD] dark:bg-[#1E1F20]">
            <FolderPlus className="w-8 h-8 text-[#747775] mx-auto mb-3" />
            <p className="text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">No albums yet</p>
            <p className="mt-1 text-xs text-[#747775] dark:text-[#8E918F]">
              Create virtual albums to organize trips and collections without duplicating files.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-6">
            {albums.map((album) => (
              <div key={album.id} className="group flex flex-col">
                <button
                  type="button"
                  onClick={() => onSelectAlbum(album)}
                  className="relative aspect-square w-full rounded-2xl overflow-hidden bg-[#F1F3F4] dark:bg-[#282A2C] text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-[#0B57D0]"
                >
                  {album.previewUrls.length >= 4 ? (
                    <div className="grid grid-cols-2 grid-rows-2 w-full h-full gap-0.5 bg-white dark:bg-[#131314]">
                      {album.previewUrls.slice(0, 4).map((url, idx) => (
                        <img
                          key={idx}
                          src={url}
                          alt=""
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                        />
                      ))}
                    </div>
                  ) : album.coverUrl ? (
                    <img
                      src={album.coverUrl}
                      alt={album.title}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[#747775]">
                      <ImageIcon className="w-8 h-8" />
                    </div>
                  )}
                </button>

                <div className="mt-2.5 flex items-start justify-between gap-2 px-0.5">
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => onSelectAlbum(album)}
                      className="text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3] hover:text-[#0B57D0] dark:hover:text-[#A8C7FA] truncate block cursor-pointer"
                    >
                      {album.title}
                    </button>
                    <div className="text-xs text-[#747775] dark:text-[#8E918F] tabular-nums mt-0.5">
                      {album.itemCount} {album.itemCount === 1 ? 'item' : 'items'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenShareAlbum(album)}
                    className="w-8 h-8 rounded-full flex items-center justify-center text-[#747775] hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3] hover:bg-black/[0.05] dark:hover:bg-white/[0.08] cursor-pointer shrink-0"
                    title="Share album"
                    aria-label={`Share ${album.title}`}
                  >
                    <Share2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Active Shared Links */}
      <section className="pt-6 border-t border-black/[0.08] dark:border-white/[0.08]">
        <div className="mb-4">
          <h2 className="text-lg font-normal text-[#1F1F1F] dark:text-[#E3E3E3]">
            Shared links
          </h2>
          <p className="mt-0.5 text-xs text-[#747775] dark:text-[#8E918F]">
            Public links with optional expiration and password protection.
          </p>
        </div>

        {shares.length === 0 ? (
          <p className="text-sm text-[#747775] dark:text-[#8E918F] py-3">
            No active share links yet. Open any photo or album and click Share to create one.
          </p>
        ) : (
          <div className="space-y-2">
            {shares.map((share) => (
              <div
                key={share.id}
                className="px-4 py-3 rounded-2xl bg-[#F8FAFD] dark:bg-[#1E1F20] flex flex-wrap items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
                    <Link2 className="w-4 h-4 text-[#0B57D0] dark:text-[#A8C7FA] shrink-0" />
                    <a href={share.sharePath} className="hover:underline truncate">
                      {share.title || share.token}
                    </a>
                  </div>
                  <div className="mt-0.5 text-xs text-[#747775] dark:text-[#8E918F] tabular-nums">
                    {share.targetType === 'album' ? 'Album' : 'Photo'}
                    {' · '}
                    {share.hasPassword ? 'Password protected' : 'Public link'}
                    {' · '}
                    {share.expiresAt ? `Expires ${new Date(share.expiresAt).toLocaleDateString()}` : 'No expiry'}
                    {' · '}
                    {share.viewCount} {share.viewCount === 1 ? 'view' : 'views'}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleCopyShare(share)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-white dark:bg-[#282A2C] px-3.5 py-1.5 text-xs font-medium text-[#1F1F1F] dark:text-[#E3E3E3] hover:opacity-90 cursor-pointer"
                  >
                    {copiedId === share.id ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    {copiedId === share.id ? 'Copied' : 'Copy link'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRevokeShare(share.id)}
                    className="px-3 py-1.5 rounded-full text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 cursor-pointer"
                  >
                    Revoke
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Create Album Dialog */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-[#1E1F20] p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">Create album</h2>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="w-9 h-9 rounded-full flex items-center justify-center text-[#444746] dark:text-[#C4C7C5] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] cursor-pointer"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#444746] dark:text-[#C4C7C5] mb-1.5">
                  Title
                </label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Autumn in Kyoto"
                  className="w-full rounded-xl bg-[#F8FAFD] dark:bg-[#282A2C] border border-black/10 dark:border-white/10 px-3.5 py-2.5 text-sm text-[#1F1F1F] dark:text-[#E3E3E3] focus:border-[#0B57D0] dark:focus:border-[#A8C7FA] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#444746] dark:text-[#C4C7C5] mb-1.5">
                  Description (optional)
                </label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Short note about this collection"
                  className="w-full rounded-xl bg-[#F8FAFD] dark:bg-[#282A2C] border border-black/10 dark:border-white/10 px-3.5 py-2.5 text-sm text-[#1F1F1F] dark:text-[#E3E3E3] focus:border-[#0B57D0] dark:focus:border-[#A8C7FA] focus:outline-none"
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="rounded-full px-4 py-2 text-xs font-medium text-[#444746] dark:text-[#C4C7C5] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || !title.trim()}
                  className="rounded-full bg-[#0B57D0] dark:bg-[#A8C7FA] disabled:opacity-50 px-5 py-2 text-xs font-medium text-white dark:text-[#062E6F] cursor-pointer"
                >
                  {creating ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
