import React, { useState } from 'react';
import { Check, Copy, Link2, Lock, X } from 'lucide-react';
import { createShareLink } from '../lib/api';
import type { ShareLinkItem } from '../types';

interface ShareModalProps {
  targetType: 'media' | 'album';
  targetId: string;
  targetTitle: string;
  onClose: () => void;
  onCreated?: (share: ShareLinkItem) => void;
}

export const ShareModal: React.FC<ShareModalProps> = ({
  targetType,
  targetId,
  targetTitle,
  onClose,
  onCreated,
}) => {
  const [title, setTitle] = useState(targetTitle);
  const [password, setPassword] = useState('');
  const [expiresInHours, setExpiresInHours] = useState<string>('168');
  const [allowDownload, setAllowDownload] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [createdShare, setCreatedShare] = useState<ShareLinkItem | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const share = await createShareLink({
        targetType,
        targetId,
        title: title.trim() || targetTitle,
        password: password.trim() || undefined,
        expiresInHours: expiresInHours === 'never' ? null : Number(expiresInHours),
        allowDownload,
      });
      setCreatedShare(share);
      onCreated?.(share);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create share link');
    } finally {
      setLoading(false);
    }
  };

  const fullUrl = createdShare ? `${window.location.origin}${createdShare.sharePath}` : '';

  const handleCopy = async () => {
    if (!fullUrl) return;
    await navigator.clipboard.writeText(fullUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
      <div className="w-full max-w-md rounded-3xl bg-white dark:bg-[#1E1F20] p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
            Share {targetType === 'album' ? 'album' : 'photo'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full flex items-center justify-center text-[#444746] dark:text-[#C4C7C5] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] cursor-pointer"
            aria-label="Close share dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {createdShare ? (
          <div className="mt-5 space-y-4">
            <p className="text-sm text-[#444746] dark:text-[#C4C7C5]">
              Link created. Anyone with this link{createdShare.hasPassword ? ' and the password' : ''} can view it.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={fullUrl}
                className="flex-1 rounded-full bg-[#E9EEF6] dark:bg-[#282A2C] px-4 py-2.5 text-xs text-[#1F1F1F] dark:text-[#E3E3E3] focus:outline-none"
              />
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#0B57D0] dark:bg-[#A8C7FA] px-4 py-2.5 text-xs font-medium text-white dark:text-[#062E6F] hover:opacity-95 cursor-pointer whitespace-nowrap"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className="text-xs text-[#747775] dark:text-[#8E918F]">
              {createdShare.hasPassword ? 'Password protected' : 'No password'}
              {' · '}
              {createdShare.expiresAt
                ? `Expires ${new Date(createdShare.expiresAt).toLocaleDateString()}`
                : 'Never expires'}
              {' · '}
              {createdShare.allowDownload ? 'Downloads allowed' : 'View only'}
            </div>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full bg-[#C2E7FF] dark:bg-[#004A77] px-5 py-2 text-xs font-semibold text-[#001D35] dark:text-[#C2E7FF] cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#444746] dark:text-[#C4C7C5] mb-1.5">
                Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-xl bg-[#F8FAFD] dark:bg-[#282A2C] border border-black/10 dark:border-white/10 px-3.5 py-2.5 text-sm text-[#1F1F1F] dark:text-[#E3E3E3] focus:border-[#0B57D0] dark:focus:border-[#A8C7FA] focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#444746] dark:text-[#C4C7C5] mb-1.5">
                  Expiration
                </label>
                <select
                  value={expiresInHours}
                  onChange={(e) => setExpiresInHours(e.target.value)}
                  className="w-full rounded-xl bg-[#F8FAFD] dark:bg-[#282A2C] border border-black/10 dark:border-white/10 px-3 py-2.5 text-sm text-[#1F1F1F] dark:text-[#E3E3E3] focus:border-[#0B57D0] dark:focus:border-[#A8C7FA] focus:outline-none"
                >
                  <option value="1">1 hour</option>
                  <option value="24">24 hours</option>
                  <option value="168">7 days</option>
                  <option value="720">30 days</option>
                  <option value="never">Never expires</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#444746] dark:text-[#C4C7C5] mb-1.5">
                  Password (optional)
                </label>
                <div className="relative">
                  <Lock className="w-3.5 h-3.5 text-[#747775] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="None"
                    className="w-full rounded-xl bg-[#F8FAFD] dark:bg-[#282A2C] border border-black/10 dark:border-white/10 pl-8 pr-3 py-2.5 text-sm text-[#1F1F1F] dark:text-[#E3E3E3] focus:border-[#0B57D0] dark:focus:border-[#A8C7FA] focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <label className="flex items-center gap-2.5 text-sm text-[#444746] dark:text-[#C4C7C5] cursor-pointer">
              <input
                type="checkbox"
                checked={allowDownload}
                onChange={(e) => setAllowDownload(e.target.checked)}
                className="rounded accent-[#0B57D0]"
              />
              <span>Allow recipients to download originals</span>
            </label>

            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full px-4 py-2 text-xs font-medium text-[#444746] dark:text-[#C4C7C5] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#0B57D0] dark:bg-[#A8C7FA] disabled:opacity-60 px-5 py-2 text-xs font-medium text-white dark:text-[#062E6F] hover:opacity-95 cursor-pointer"
              >
                <Link2 className="w-3.5 h-3.5" />
                {loading ? 'Creating…' : 'Create link'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
