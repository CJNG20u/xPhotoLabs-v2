import React, { useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="w-10 h-10 rounded-full flex items-center justify-center text-[#444746] dark:text-[#C4C7C5] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] transition-colors cursor-pointer shrink-0"
        title="Install xPhotoLabs app"
        aria-label="Install xPhotoLabs app"
      >
        <Download className="w-5 h-5" />
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="w-10 h-10 rounded-full flex items-center justify-center text-[#444746] dark:text-[#C4C7C5] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] transition-colors cursor-pointer shrink-0"
          title="Install xPhotoLabs on iOS"
          aria-label="Install xPhotoLabs on iOS"
        >
          <Download className="w-5 h-5" />
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
            <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-[#1E1F20] p-6 shadow-2xl">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
                  Install xPhotoLabs
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="w-9 h-9 rounded-full flex items-center justify-center text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                  aria-label="Close install instructions"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <ol className="mt-4 space-y-3 text-sm text-[#444746] dark:text-[#C4C7C5]">
                <li className="flex items-start gap-2.5">
                  <span className="font-semibold text-[#0B57D0] dark:text-[#A8C7FA]">1.</span>
                  <span>
                    Tap the <Share className="inline w-4 h-4 mx-0.5 -mt-0.5" /> <strong>Share</strong> button in Safari.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="font-semibold text-[#0B57D0] dark:text-[#A8C7FA]">2.</span>
                  <span>
                    Scroll down and tap <strong>Add to Home Screen</strong>.
                  </span>
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-6 w-full rounded-full bg-[#0B57D0] dark:bg-[#A8C7FA] py-2.5 text-sm font-medium text-white dark:text-[#062E6F] hover:opacity-95 transition-opacity cursor-pointer"
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
