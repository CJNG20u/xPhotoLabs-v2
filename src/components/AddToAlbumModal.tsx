import React, { useState } from 'react';
import { FolderPlus, Plus, X } from 'lucide-react';
import { addMediaToAlbum, createAlbum } from '../lib/api';
import type { AlbumSummary } from '../types';

interface AddToAlbumModalProps {
  mediaIds: string[];
  albums: AlbumSummary[];
  onClose: () => void;
  onUpdated: () => void;
}

export const AddToAlbumModal: React.FC<AddToAlbumModalProps> = ({
  mediaIds,
  albums,
  onClose,
  onUpdated,
}) => {
  const [newTitle, setNewTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleSelectAlbum = async (albumId: string) => {
    setBusy(true);
    setError('');
    try {
      await addMediaToAlbum(albumId, mediaIds);
      onUpdated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add to album');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateAndAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setBusy(true);
    setError('');
    try {
      await createAlbum({ title: newTitle.trim(), mediaIds });
      onUpdated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create album');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
      <div className="w-full max-w-md rounded-3xl bg-white dark:bg-[#1E1F20] p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
              Add to album
            </h2>
            <p className="text-xs text-[#747775] dark:text-[#8E918F] tabular-nums">
              {mediaIds.length} {mediaIds.length === 1 ? 'item' : 'items'} selected
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full flex items-center justify-center text-[#444746] dark:text-[#C4C7C5] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] cursor-pointer"
            aria-label="Close album modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleCreateAndAdd} className="mt-4 flex gap-2">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="New album title"
            className="flex-1 rounded-full bg-[#E9EEF6] dark:bg-[#282A2C] px-4 py-2 text-sm text-[#1F1F1F] dark:text-[#E3E3E3] placeholder:text-[#747775] focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy || !newTitle.trim()}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#0B57D0] dark:bg-[#A8C7FA] disabled:opacity-50 px-4 py-2 text-xs font-medium text-white dark:text-[#062E6F] cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Create
          </button>
        </form>

        <div className="mt-4 max-h-64 overflow-y-auto space-y-1">
          {albums.length === 0 ? (
            <p className="py-6 text-center text-xs text-[#747775] dark:text-[#8E918F]">
              No albums yet. Create one above.
            </p>
          ) : (
            albums.map((album) => (
              <button
                key={album.id}
                type="button"
                disabled={busy}
                onClick={() => handleSelectAlbum(album.id)}
                className="w-full py-2 px-2.5 flex items-center gap-3.5 text-left hover:bg-black/[0.04] dark:hover:bg-white/[0.06] rounded-2xl transition-colors cursor-pointer"
              >
                <div className="w-12 h-12 rounded-xl bg-[#F1F3F4] dark:bg-[#282A2C] overflow-hidden shrink-0 flex items-center justify-center">
                  {album.coverUrl ? (
                    <img
                      src={album.coverUrl}
                      alt={album.title}
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <FolderPlus className="w-4 h-4 text-[#747775]" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3] truncate">
                    {album.title}
                  </div>
                  <div className="text-xs text-[#747775] dark:text-[#8E918F] tabular-nums">
                    {album.itemCount} {album.itemCount === 1 ? 'item' : 'items'}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        {error && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </div>
  );
};
