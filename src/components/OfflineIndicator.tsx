import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-5 left-5 z-50 flex items-center gap-2.5 rounded-full bg-[#1F1F1F] dark:bg-[#E3E3E3] px-4 py-2.5 text-xs font-medium text-white dark:text-[#1F1F1F] shadow-lg"
    >
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>Offline — viewing cached thumbnails</span>
    </div>
  );
};
