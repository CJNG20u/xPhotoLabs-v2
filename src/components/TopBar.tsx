import React from 'react';
import { FolderSync, Menu, Moon, Sun, Upload } from 'lucide-react';
import type { FolderSyncProgress } from '../types';
import { PWAInstallButton } from './PWAInstallButton';

interface TopBarProps {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onOpenMobileNav: () => void;
  onTriggerUpload: () => void;
  onTriggerFolderSync: () => void;
  savedFolderName: string | null;
  folderSyncProgress: FolderSyncProgress;
}

export const TopBar: React.FC<TopBarProps> = ({
  theme,
  onToggleTheme,
  onOpenMobileNav,
  onTriggerUpload,
  onTriggerFolderSync,
  savedFolderName,
  folderSyncProgress,
}) => {
  const isSyncing =
    folderSyncProgress.phase === 'scanning' ||
    folderSyncProgress.phase === 'hashing' ||
    folderSyncProgress.phase === 'checking' ||
    folderSyncProgress.phase === 'uploading';

  return (
    <header className="sticky top-0 z-30 h-16 bg-white dark:bg-[#131314] px-3 lg:px-5 flex items-center justify-between gap-4 shrink-0">
      {/* Left: Mobile Menu + Crisp xPhotoLabs Logo */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onOpenMobileNav}
          className="lg:hidden w-10 h-10 rounded-full flex items-center justify-center text-[#444746] dark:text-[#C4C7C5] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] transition-colors cursor-pointer"
          aria-label="Open navigation menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2.5 pl-1 whitespace-nowrap shrink-0 select-none">
          <img
            src="/icon.svg"
            alt="xPhotoLabs"
            className="w-7 h-7 shrink-0"
            referrerPolicy="no-referrer"
          />
          <span className="font-display text-[20px] font-medium tracking-tight text-[#1F1F1F] dark:text-[#E3E3E3]">
            xPhotoLabs
          </span>
        </div>
      </div>

      {/* Right: Clean Ghost Icon Buttons */}
      <div className="flex items-center justify-end gap-1 shrink-0">
        <button
          type="button"
          onClick={onTriggerUpload}
          className="w-10 h-10 rounded-full flex items-center justify-center text-[#444746] dark:text-[#C4C7C5] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] transition-colors cursor-pointer"
          title="Upload photos & videos"
          aria-label="Upload photos and videos"
        >
          <Upload className="w-5 h-5" />
        </button>

        <button
          type="button"
          onClick={onTriggerFolderSync}
          disabled={isSyncing}
          className={`relative w-10 h-10 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
            isSyncing
              ? 'bg-[#C2E7FF] dark:bg-[#004A77] text-[#001D35] dark:text-[#C2E7FF]'
              : 'text-[#444746] dark:text-[#C4C7C5] hover:bg-black/[0.06] dark:hover:bg-white/[0.08]'
          }`}
          title={
            isSyncing
              ? folderSyncProgress.message || 'Syncing folder…'
              : savedFolderName
                ? `Folder Auto-Sync linked to "${savedFolderName}" — click to sync`
                : 'Folder Auto-Sync (File System Access API)'
          }
          aria-label="Folder Auto-Sync"
        >
          <FolderSync className={`w-5 h-5 ${isSyncing ? 'animate-spin' : ''}`} />
        </button>

        <PWAInstallButton />

        <button
          type="button"
          onClick={onToggleTheme}
          className="w-10 h-10 rounded-full flex items-center justify-center text-[#444746] dark:text-[#C4C7C5] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] transition-colors cursor-pointer"
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>
      </div>
    </header>
  );
};
