import React from 'react';
import {
  CheckCheck,
  FolderPlus,
  RotateCcw,
  Star,
  Trash2,
  X,
} from 'lucide-react';

interface FloatingBulkActionBarProps {
  selectedCount: number;
  totalCount: number;
  isTrashView: boolean;
  allSelectedFavorited: boolean;
  onClearSelection: () => void;
  onToggleSelectAll: () => void;
  onToggleFavoriteSelected: () => void;
  onAddToAlbum: () => void;
  onTrashSelected: () => void;
  onRestoreSelected: () => void;
  onDeletePermanentlySelected: () => void;
}

export const FloatingBulkActionBar: React.FC<FloatingBulkActionBarProps> = ({
  selectedCount,
  totalCount,
  isTrashView,
  allSelectedFavorited,
  onClearSelection,
  onToggleSelectAll,
  onToggleFavoriteSelected,
  onAddToAlbum,
  onTrashSelected,
  onRestoreSelected,
  onDeletePermanentlySelected,
}) => {
  if (selectedCount <= 0) return null;

  const allSelected = totalCount > 0 && selectedCount >= totalCount;

  return (
    <div
      role="toolbar"
      aria-label="Selected items bulk actions"
      className="fixed bottom-4 left-3 right-3 sm:left-1/2 sm:right-auto sm:bottom-auto sm:top-2.5 sm:-translate-x-1/2 z-40 flex items-center justify-between sm:justify-start gap-1.5 sm:gap-2 rounded-full bg-white/95 dark:bg-[#282A2C]/95 backdrop-blur-md border border-black/[0.08] dark:border-white/[0.12] shadow-xl px-2.5 sm:px-3 py-1.5 max-w-[calc(100vw-24px)]"
    >
      {/* Left: Clear (X) + Selected Count + Select All */}
      <div className="flex items-center gap-1 sm:gap-1.5 min-w-0">
        <button
          type="button"
          onClick={onClearSelection}
          className="w-9 h-9 rounded-full flex items-center justify-center text-[#444746] dark:text-[#C4C7C5] hover:bg-black/[0.06] dark:hover:bg-white/[0.1] transition-colors cursor-pointer shrink-0"
          title="Clear selection (Esc)"
          aria-label="Clear selection"
        >
          <X className="w-5 h-5" />
        </button>

        <span className="text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3] tabular-nums whitespace-nowrap pr-1">
          {selectedCount} selected
        </span>

        {totalCount > 0 && (
          <button
            type="button"
            onClick={onToggleSelectAll}
            className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              allSelected
                ? 'bg-[#C2E7FF] text-[#001D35] dark:bg-[#004A77] dark:text-[#C2E7FF]'
                : 'text-[#0B57D0] dark:text-[#A8C7FA] hover:bg-[#0B57D0]/10 dark:hover:bg-[#A8C7FA]/10'
            }`}
            title={allSelected ? 'Deselect all visible items' : `Select all ${totalCount} items`}
          >
            <CheckCheck className="w-3.5 h-3.5 shrink-0" />
            <span>{allSelected ? 'Deselect all' : 'Select all'}</span>
          </button>
        )}
      </div>

      {/* Subtle Divider */}
      <div className="w-px h-5 bg-black/[0.1] dark:bg-white/[0.12] mx-0.5 shrink-0" />

      {/* Right: Context-Aware Bulk Actions */}
      <div className="flex items-center gap-1 shrink-0">
        {isTrashView ? (
          <>
            <button
              type="button"
              onClick={onRestoreSelected}
              className="inline-flex items-center gap-1.5 h-9 px-3 sm:px-3.5 rounded-full text-xs font-medium text-[#0B57D0] dark:text-[#A8C7FA] hover:bg-[#0B57D0]/10 dark:hover:bg-[#A8C7FA]/10 transition-colors cursor-pointer whitespace-nowrap"
              title="Restore selected items"
            >
              <RotateCcw className="w-4 h-4 shrink-0" />
              <span className="hidden xs:inline sm:inline">Restore</span>
            </button>

            <button
              type="button"
              onClick={onDeletePermanentlySelected}
              className="inline-flex items-center gap-1.5 h-9 px-3 sm:px-3.5 rounded-full text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer whitespace-nowrap"
              title="Delete selected items permanently"
            >
              <Trash2 className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline">Delete</span>
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onToggleFavoriteSelected}
              className={`inline-flex items-center gap-1.5 h-9 px-2.5 sm:px-3.5 rounded-full text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                allSelectedFavorited
                  ? 'bg-[#C2E7FF]/70 dark:bg-[#004A77]/70 text-[#001D35] dark:text-[#C2E7FF]'
                  : 'text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-black/[0.06] dark:hover:bg-white/[0.08]'
              }`}
              title={allSelectedFavorited ? 'Remove selected from Favorites' : 'Add selected to Favorites'}
              aria-label={allSelectedFavorited ? 'Remove selected from favorites' : 'Add selected to favorites'}
            >
              <Star
                className={`w-4 h-4 shrink-0 ${
                  allSelectedFavorited
                    ? 'fill-[#0B57D0] text-[#0B57D0] dark:fill-[#A8C7FA] dark:text-[#A8C7FA]'
                    : 'text-[#444746] dark:text-[#C4C7C5]'
                }`}
              />
              <span className="hidden md:inline">
                {allSelectedFavorited ? 'Unfavorite' : 'Favorite'}
              </span>
            </button>

            <button
              type="button"
              onClick={onAddToAlbum}
              className="inline-flex items-center gap-1.5 h-9 px-2.5 sm:px-3.5 rounded-full text-xs font-medium text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] transition-colors cursor-pointer whitespace-nowrap"
              title="Add selected items to album"
              aria-label="Add selected items to album"
            >
              <FolderPlus className="w-4 h-4 text-[#444746] dark:text-[#C4C7C5] shrink-0" />
              <span className="hidden md:inline">Add to album</span>
            </button>

            <button
              type="button"
              onClick={onTrashSelected}
              className="inline-flex items-center gap-1.5 h-9 px-2.5 sm:px-3.5 rounded-full text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer whitespace-nowrap"
              title="Move selected items to Trash"
              aria-label="Move selected items to trash"
            >
              <Trash2 className="w-4 h-4 shrink-0" />
              <span className="hidden md:inline">Move to trash</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
};
