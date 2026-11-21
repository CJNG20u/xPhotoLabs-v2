import React, { useEffect } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';

interface ConfirmPermanentDeleteModalProps {
  mode: 'selected' | 'emptyTrash';
  itemCount: number;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const ConfirmPermanentDeleteModal: React.FC<ConfirmPermanentDeleteModalProps> = ({
  mode,
  itemCount,
  busy = false,
  onCancel,
  onConfirm,
}) => {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        onCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onCancel]);

  const title =
    mode === 'emptyTrash'
      ? `Empty Trash (${itemCount} ${itemCount === 1 ? 'item' : 'items'})?`
      : `Permanently delete ${itemCount} ${itemCount === 1 ? 'item' : 'items'}?`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
      onClick={() => {
        if (!busy) onCancel();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-permanent-delete-title"
    >
      <div
        className="w-full max-w-md rounded-3xl bg-white dark:bg-[#1E1F20] p-6 shadow-2xl border border-black/[0.06] dark:border-white/[0.08]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-red-500/12 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <h2
              id="confirm-permanent-delete-title"
              className="text-lg font-medium text-[#1F1F1F] dark:text-[#E3E3E3]"
            >
              {title}
            </h2>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="w-9 h-9 rounded-full flex items-center justify-center text-[#444746] dark:text-[#C4C7C5] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] disabled:opacity-50 cursor-pointer shrink-0"
            aria-label="Cancel"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="mt-3.5 text-sm leading-relaxed text-[#444746] dark:text-[#C4C7C5]">
          {itemCount === 1
            ? 'The original file and its thumbnails will be permanently deleted from storage (including mounted NAS folders). This action cannot be undone.'
            : `All ${itemCount} original files and their thumbnails will be permanently deleted from storage (including mounted NAS folders). This action cannot be undone.`}
        </p>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-full px-4 py-2 text-xs font-medium text-[#444746] dark:text-[#C4C7C5] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] disabled:opacity-50 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="inline-flex items-center gap-1.5 rounded-full bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 disabled:opacity-50 px-5 py-2 text-xs font-medium text-white shadow-xs transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{busy ? 'Deleting…' : 'Delete permanently'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
