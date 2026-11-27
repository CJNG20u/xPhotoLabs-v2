import React from 'react';
import { CopyCheck, LogOut, X } from 'lucide-react';
import type { NavView, StorageOverview } from '../types';
import { formatBytes } from '../lib/format';
import { useAuth } from './AuthGate';

interface NavRailProps {
  activeView: NavView;
  onSelectView: (view: NavView) => void;
  storageOverview: StorageOverview | null;
  duplicatesCount?: number;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const NavIcon: React.FC<{ id: NavView; active: boolean }> = ({ id, active }) => {
  switch (id) {
    case 'photos':
      return active ? (
        <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm-9.5 6.5A1.5 1.5 0 1 1 11 8a1.5 1.5 0 0 1-1.5 1.5ZM6 17l3.5-4.5 2.5 3.01L15.5 11l4.5 6H6Z" />
        </svg>
      ) : (
        <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2.5" />
          <circle cx="9" cy="9" r="1.5" />
          <path d="m21 15-4.5-4.5L7 21" />
        </svg>
      );
    case 'favorites':
      return active ? (
        <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="m12 2.5 2.9 6.03 6.6.91-4.8 4.62 1.16 6.56L12 17.47 6.14 20.62 7.3 14.06 2.5 9.44l6.6-.91L12 2.5Z" />
        </svg>
      ) : (
        <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polygon points="12 2.5 14.9 8.5 21.5 9.4 16.7 14 17.9 20.6 12 17.5 6.1 20.6 7.3 14 2.5 9.4 9.1 8.5 12 2.5" />
        </svg>
      );
    case 'albums':
      return active ? (
        <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Zm4 3v6h8V9H8Z" />
          <path d="M8 2h8v1.5H8V2Z" opacity="0.6" />
        </svg>
      ) : (
        <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="4" y="4" width="16" height="16" rx="2.5" />
          <path d="M9 9h6v6H9z" />
        </svg>
      );
    case 'places':
      return active ? (
        <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2a7 7 0 0 0-7 7c0 4.86 6.18 11.74 6.44 12.03a.75.75 0 0 0 1.12 0C12.82 20.74 19 13.86 19 9a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 14.5 9 2.5 2.5 0 0 1 12 11.5Z" />
        </svg>
      ) : (
        <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 21s-7-6.6-7-12a7 7 0 1 1 14 0c0 5.4-7 12-7 12Z" />
          <circle cx="12" cy="9" r="2.5" />
        </svg>
      );
    case 'duplicates':
      return <CopyCheck className="w-5 h-5 shrink-0" strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />;
    case 'trash':
      return active ? (
        <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-.85 10.2A2 2 0 0 1 15.16 21H8.84a2 2 0 0 1-1.99-1.8L6 9Z" />
        </svg>
      ) : (
        <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 6h18" />
          <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
          <path d="M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" />
        </svg>
      );
    case 'mounts':
      return active ? (
        <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5Zm3.5 3A1 1 0 1 0 7.5 6a1 1 0 0 0 0 2ZM4 15a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4Zm3.5 3A1 1 0 1 0 7.5 16a1 1 0 0 0 0 2Z" />
        </svg>
      ) : (
        <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="7" rx="2" />
          <rect x="3" y="13" width="18" height="7" rx="2" />
          <circle cx="7.5" cy="7.5" r="0.8" fill="currentColor" />
          <circle cx="7.5" cy="16.5" r="0.8" fill="currentColor" />
        </svg>
      );
  }
};

const NAV_ITEMS: Array<{ id: NavView; label: string }> = [
  { id: 'photos', label: 'Photos' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'albums', label: 'Albums' },
  { id: 'places', label: 'Places' },
  { id: 'duplicates', label: 'Duplicates' },
  { id: 'trash', label: 'Trash' },
  { id: 'mounts', label: 'Storage Mounts' },
];

export const NavRail: React.FC<NavRailProps> = ({
  activeView,
  onSelectView,
  storageOverview,
  duplicatesCount = 0,
  mobileOpen,
  onCloseMobile,
}) => {
  const { authEnabled, username, signOut } = useAuth();
  const railContent = (
    <div className="flex flex-col h-full justify-between py-3 px-3">
      <nav className="space-y-0.5" aria-label="Primary gallery navigation">
        {NAV_ITEMS.map((item) => {
          const active = activeView === item.id;
          const badgeCount =
            item.id === 'trash' && storageOverview && storageOverview.trashCount > 0
              ? storageOverview.trashCount
              : item.id === 'duplicates' && duplicatesCount > 0
                ? duplicatesCount
                : null;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelectView(item.id);
                onCloseMobile();
              }}
              className={`w-full flex items-center justify-between px-4 py-2.5 rounded-full text-sm transition-colors cursor-pointer whitespace-nowrap ${
                active
                  ? 'bg-[#C2E7FF] text-[#001D35] font-semibold dark:bg-[#004A77] dark:text-[#C2E7FF]'
                  : 'text-[#444746] dark:text-[#C4C7C5] font-medium hover:bg-black/[0.05] dark:hover:bg-white/[0.06]'
              }`}
            >
              <span className="flex items-center gap-3.5">
                <NavIcon id={item.id} active={active} />
                <span>{item.label}</span>
              </span>
              {badgeCount !== null && (
                <span className="text-xs tabular-nums opacity-75">{badgeCount}</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Bottom group: storage indicator + sign out stay together at the bottom */}
      <div>
      {/* Google Photos style soft tonal storage indicator */}
      {storageOverview && (
        <div className="mt-6 px-4 py-4">
          <div className="flex items-center justify-between text-xs text-[#444746] dark:text-[#C4C7C5]">
            <span className="font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">Storage</span>
            <span className="tabular-nums">{formatBytes(storageOverview.indexedTotalBytes)}</span>
          </div>
          <div className="mt-2 h-1.5 w-full rounded-full bg-[#DDE3EA] dark:bg-[#3C4043] overflow-hidden">
            <div
              className="h-full rounded-full bg-[#0B57D0] dark:bg-[#A8C7FA] transition-all"
              style={{
                width: `${Math.min(100, Math.max(10, Math.round((storageOverview.totalCount / 40) * 100)))}%`,
              }}
            />
          </div>
          <p className="mt-2 text-xs text-[#747775] dark:text-[#8E918F] tabular-nums leading-relaxed">
            {storageOverview.photoCount} photos · {storageOverview.videoCount} videos
            <br />
            {formatBytes(storageOverview.thumbsSizeBytes)} WebP cache
          </p>
        </div>
      )}

      {authEnabled && (
        <button
          type="button"
          onClick={() => void signOut()}
          title={username ? `Signed in as ${username}` : 'Sign out'}
          className="mt-2 w-full flex items-center gap-3.5 px-4 py-2.5 rounded-full text-sm font-medium text-[#444746] dark:text-[#C4C7C5] hover:bg-black/[0.05] dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
        >
          <LogOut className="w-5 h-5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
          <span className="truncate">Sign out</span>
        </button>
      )}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Material You tonal left sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 bg-[#F8FAFD] dark:bg-[#1E1F20]">
        {railContent}
      </aside>

      {/* Mobile slide-over drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/45 backdrop-blur-xs"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="relative z-10 w-72 max-w-[82vw] bg-[#F8FAFD] dark:bg-[#1E1F20] flex flex-col h-full shadow-2xl">
            <div className="h-16 px-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <img src="/icon.svg" alt="xPhotoLabs" className="w-6 h-6" referrerPolicy="no-referrer" />
                <span className="font-display text-lg font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
                  xPhotoLabs
                </span>
              </div>
              <button
                type="button"
                onClick={onCloseMobile}
                className="w-9 h-9 rounded-full flex items-center justify-center text-[#444746] dark:text-[#C4C7C5] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] cursor-pointer"
                aria-label="Close navigation menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">{railContent}</div>
          </aside>
        </div>
      )}
    </>
  );
};
