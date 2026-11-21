import React, { useEffect, useState } from 'react';
import { ArrowLeft, Lock } from 'lucide-react';
import type { MediaItem } from '../types';
import { Lightbox } from './Lightbox';
import { VirtualizedTimelineGrid } from './VirtualizedTimelineGrid';

interface PublicShareResponse {
  requiresPassword: boolean;
  title: string;
  targetType: 'media' | 'album';
  expiresAt: string | null;
  allowDownload?: boolean;
  viewCount?: number;
  items?: MediaItem[];
}

interface PublicSharePageProps {
  token: string;
}

export const PublicSharePage: React.FC<PublicSharePageProps> = ({ token }) => {
  const [data, setData] = useState<PublicShareResponse | null>(null);
  const [password, setPassword] = useState('');
  const [unlockedPassword, setUnlockedPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unlockError, setUnlockError] = useState('');
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/public/share/${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || 'Share link unavailable');
        }
        return res.json() as Promise<PublicShareResponse>;
      })
      .then((res) => {
        if (!active) return;
        setData(res);
        setError('');
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Unable to load shared gallery');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setUnlockError('');
    try {
      const res = await fetch(`/api/public/share/${encodeURIComponent(token)}/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || 'Incorrect password');
      }
      const unlocked = (await res.json()) as PublicShareResponse;
      setUnlockedPassword('yes');
      setPassword('');
      setData(unlocked);
    } catch (err) {
      setUnlockError(err instanceof Error ? err.message : 'Incorrect password');
    }
  };

  const items = data?.items || [];

  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-[#131314] text-[#1F1F1F] dark:text-[#E3E3E3]">
      <header className="h-16 px-6 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <img src="/icon.svg" alt="xPhotoLabs" className="w-7 h-7" referrerPolicy="no-referrer" />
          <span className="font-display text-xl font-medium tracking-tight">xPhotoLabs</span>
        </div>
        <a
          href="/"
          className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium text-[#444746] dark:text-[#C4C7C5] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
        >
          <ArrowLeft className="w-4 h-4" />
          Open gallery
        </a>
      </header>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-sm text-[#747775]">
          Loading shared link…
        </div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <h1 className="text-lg font-medium">{error}</h1>
          <p className="mt-1.5 text-sm text-[#747775] dark:text-[#8E918F]">
            The share link may have expired or been revoked.
          </p>
        </div>
      ) : data?.requiresPassword ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <form
            onSubmit={handleUnlock}
            className="w-full max-w-sm rounded-3xl bg-[#F8FAFD] dark:bg-[#1E1F20] p-6 space-y-4"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#C2E7FF] dark:bg-[#004A77] flex items-center justify-center text-[#001D35] dark:text-[#C2E7FF]">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-base font-medium">{data.title}</h1>
                <p className="text-xs text-[#747775] dark:text-[#8E918F]">Password required</p>
              </div>
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              autoFocus
              className="w-full rounded-full bg-white dark:bg-[#282A2C] px-4 py-2.5 text-sm focus:outline-none"
            />
            {unlockError && <p className="text-xs text-red-600 dark:text-red-400">{unlockError}</p>}
            <button
              type="submit"
              className="w-full rounded-full bg-[#0B57D0] dark:bg-[#A8C7FA] py-2.5 text-sm font-medium text-white dark:text-[#062E6F] cursor-pointer"
            >
              Unlock
            </button>
          </form>
        </div>
      ) : (
        <main className="flex-1 flex flex-col min-h-0">
          <div className="px-6 py-4">
            <h1 className="text-2xl font-normal tracking-tight">{data?.title}</h1>
            <p className="mt-1 text-xs text-[#747775] dark:text-[#8E918F] tabular-nums">
              {items.length} {items.length === 1 ? 'item' : 'items'}
              {data?.expiresAt ? ` · Expires ${new Date(data.expiresAt).toLocaleDateString()}` : ''}
              {unlockedPassword ? ' · Unlocked' : ''}
            </p>
          </div>

          <VirtualizedTimelineGrid
            items={items}
            selectedIds={new Set()}
            onToggleSelect={() => {}}
            onOpenLightbox={(idx) => setLightboxIdx(idx)}
            emptyTitle="Nothing in this share"
            emptyDescription="No active items remain in this shared link."
            readOnly
          />
        </main>
      )}

      {lightboxIdx !== null && (
        <Lightbox
          items={items}
          currentIndex={lightboxIdx}
          onChangeIndex={setLightboxIdx}
          onClose={() => setLightboxIdx(null)}
          readOnly
          allowDownload={data?.allowDownload !== false}
        />
      )}
    </div>
  );
};
