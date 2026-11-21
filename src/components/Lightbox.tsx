import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Download,
  FolderPlus,
  HardDrive,
  Info,
  MapPin,
  RotateCcw,
  Share2,
  Star,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { MediaItem } from '../types';
import { formatBytes, formatDuration, formatFullTimestamp, formatMegapixels } from '../lib/format';

interface LightboxProps {
  items: MediaItem[];
  currentIndex: number;
  onChangeIndex: (index: number) => void;
  onClose: () => void;
  onToggleFavorite?: (item: MediaItem) => void;
  onTrash?: (item: MediaItem) => void;
  onOpenAddToAlbum?: (item: MediaItem) => void;
  onOpenShare?: (item: MediaItem) => void;
  readOnly?: boolean;
  allowDownload?: boolean;
}

export const Lightbox: React.FC<LightboxProps> = ({
  items,
  currentIndex,
  onChangeIndex,
  onClose,
  onToggleFavorite,
  onTrash,
  onOpenAddToAlbum,
  onOpenShare,
  readOnly = false,
  allowDownload = true,
}) => {
  const item = items[currentIndex];
  const [showInfo, setShowInfo] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [currentIndex]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) onChangeIndex(currentIndex - 1);
  }, [currentIndex, onChangeIndex]);

  const goNext = useCallback(() => {
    if (currentIndex < items.length - 1) onChangeIndex(currentIndex + 1);
  }, [currentIndex, items.length, onChangeIndex]);

  const adjustZoom = useCallback((delta: number) => {
    setZoom((prev) => {
      const next = Math.min(4, Math.max(1, Number((prev + delta).toFixed(2))));
      if (next === 1) setPan({ x: 0, y: 0 });
      return next;
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'i' || e.key === 'I') setShowInfo((s) => !s);
      else if ((e.key === 'f' || e.key === 'F') && item && onToggleFavorite && !readOnly) {
        onToggleFavorite(item);
      } else if (e.key === '+' || e.key === '=') adjustZoom(0.5);
      else if (e.key === '-') adjustZoom(-0.5);
      else if (e.key === '0') {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, goPrev, goNext, item, onToggleFavorite, readOnly, adjustZoom]);

  if (!item) return null;

  const handleWheel = (e: React.WheelEvent) => {
    if (item.mediaType !== 'image') return;
    if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > 10) {
      e.preventDefault();
      adjustZoom(e.deltaY < 0 ? 0.25 : -0.25);
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (item.mediaType !== 'image' || zoom <= 1) return;
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setPan({
      x: dragStartRef.current.panX + (e.clientX - dragStartRef.current.x),
      y: dragStartRef.current.panY + (e.clientY - dragStartRef.current.y),
    });
  };

  const handlePointerUp = () => setIsDragging(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (zoom > 1 || e.touches.length !== 1) return;
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current || zoom > 1) return;
    const dx = e.changedTouches[0].clientX - touchStartRef.current.x;
    const dy = e.changedTouches[0].clientY - touchStartRef.current.y;
    touchStartRef.current = null;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      if (dx > 0) goPrev();
      else goNext();
    }
  };

  const downloadHref = item.originalUrl.includes('?')
    ? `${item.originalUrl}&download=1`
    : `${item.originalUrl}?download=1`;

  const mapMarkerX = item.gpsLng !== null ? ((item.gpsLng + 180) / 360) * 100 : null;
  const mapMarkerY = item.gpsLat !== null ? ((90 - item.gpsLat) / 180) * 100 : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Media viewer: ${item.filename}`}
      className="fixed inset-0 z-50 bg-black text-white flex overflow-hidden"
    >
      {/* Main Media Stage */}
      <div className="relative flex-1 flex flex-col min-w-0">
        {/* Top Overlay Toolbar */}
        <div className="relative z-20 h-16 px-4 flex items-center justify-between bg-gradient-to-b from-black/75 via-black/30 to-transparent">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onClose}
              className="w-10 h-10 rounded-full flex items-center justify-center text-white/90 hover:bg-white/10 transition-colors cursor-pointer"
              aria-label="Close lightbox"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <div className="text-sm font-medium text-white truncate">{item.filename}</div>
              <div className="text-xs text-neutral-300 tabular-nums truncate">
                {formatFullTimestamp(item.takenAt)}
                {item.locationName ? ` · ${item.locationName}` : ''}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {item.mediaType === 'image' && (
              <div className="hidden sm:flex items-center gap-0.5 mr-2 pr-2 border-r border-white/15">
                <button
                  type="button"
                  onClick={() => adjustZoom(-0.5)}
                  disabled={zoom <= 1}
                  className="w-9 h-9 rounded-full flex items-center justify-center text-white/90 hover:bg-white/10 disabled:opacity-35 transition-colors cursor-pointer"
                  aria-label="Zoom out"
                >
                  <ZoomOut className="w-[18px] h-[18px]" />
                </button>
                <span className="text-xs tabular-nums text-neutral-300 w-10 text-center">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => adjustZoom(0.5)}
                  disabled={zoom >= 4}
                  className="w-9 h-9 rounded-full flex items-center justify-center text-white/90 hover:bg-white/10 disabled:opacity-35 transition-colors cursor-pointer"
                  aria-label="Zoom in"
                >
                  <ZoomIn className="w-[18px] h-[18px]" />
                </button>
                {zoom > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      setZoom(1);
                      setPan({ x: 0, y: 0 });
                    }}
                    className="w-9 h-9 rounded-full flex items-center justify-center text-white/90 hover:bg-white/10 transition-colors cursor-pointer"
                    aria-label="Reset zoom"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}

            {!readOnly && onOpenShare && (
              <button
                type="button"
                onClick={() => onOpenShare(item)}
                className="w-10 h-10 rounded-full flex items-center justify-center text-white/90 hover:bg-white/10 transition-colors cursor-pointer"
                aria-label="Share"
                title="Share"
              >
                <Share2 className="w-[18px] h-[18px]" />
              </button>
            )}

            {!readOnly && onOpenAddToAlbum && (
              <button
                type="button"
                onClick={() => onOpenAddToAlbum(item)}
                className="w-10 h-10 rounded-full flex items-center justify-center text-white/90 hover:bg-white/10 transition-colors cursor-pointer"
                aria-label="Add to album"
                title="Add to album"
              >
                <FolderPlus className="w-[18px] h-[18px]" />
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowInfo((v) => !v)}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                showInfo ? 'bg-white/20 text-white' : 'text-white/90 hover:bg-white/10'
              }`}
              aria-label="Toggle info"
              title="Info (I)"
            >
              <Info className="w-[18px] h-[18px]" />
            </button>

            {!readOnly && onToggleFavorite && (
              <button
                type="button"
                onClick={() => onToggleFavorite(item)}
                className="w-10 h-10 rounded-full flex items-center justify-center text-white hover:bg-white/10 transition-colors cursor-pointer"
                aria-label={item.isFavorite ? 'Remove from favorites' : 'Favorite'}
                title="Favorite (F)"
              >
                <Star className={`w-[18px] h-[18px] ${item.isFavorite ? 'fill-white text-white' : 'text-white/90'}`} />
              </button>
            )}

            {allowDownload && (
              <a
                href={downloadHref}
                download={item.filename}
                className="w-10 h-10 rounded-full flex items-center justify-center text-white/90 hover:bg-white/10 transition-colors"
                aria-label="Download original"
                title="Download"
              >
                <Download className="w-[18px] h-[18px]" />
              </a>
            )}

            {!readOnly && onTrash && (
              <button
                type="button"
                onClick={() => onTrash(item)}
                className="w-10 h-10 rounded-full flex items-center justify-center text-white/90 hover:bg-white/10 transition-colors cursor-pointer"
                aria-label="Move to trash"
                title="Move to trash"
              >
                <Trash2 className="w-[18px] h-[18px]" />
              </button>
            )}
          </div>
        </div>

        {/* Center Viewport */}
        <div
          className="relative flex-1 flex items-center justify-center overflow-hidden select-none"
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {currentIndex > 0 && (
            <button
              type="button"
              onClick={goPrev}
              className="absolute left-4 z-20 w-12 h-12 rounded-full bg-black/45 hover:bg-black/70 text-white flex items-center justify-center transition-colors cursor-pointer"
              aria-label="Previous item"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
          )}

          {item.mediaType === 'video' ? (
            <video
              key={item.id}
              src={item.originalUrl}
              poster={item.thumb1600Url}
              controls
              autoPlay
              playsInline
              preload="metadata"
              className="max-h-[calc(100vh-5rem)] max-w-[calc(100%-5rem)] bg-black"
            />
          ) : (
            <img
              key={item.id}
              src={zoom > 1.5 ? item.originalUrl : item.thumb1600Url}
              alt={item.filename}
              draggable={false}
              referrerPolicy="no-referrer"
              onDoubleClick={() => {
                if (zoom > 1) {
                  setZoom(1);
                  setPan({ x: 0, y: 0 });
                } else {
                  setZoom(2);
                }
              }}
              style={{
                transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
                cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'zoom-in',
              }}
              className="max-h-[calc(100vh-4.5rem)] max-w-full object-contain transition-transform duration-150 ease-out"
            />
          )}

          {currentIndex < items.length - 1 && (
            <button
              type="button"
              onClick={goNext}
              className="absolute right-4 z-20 w-12 h-12 rounded-full bg-black/45 hover:bg-black/70 text-white flex items-center justify-center transition-colors cursor-pointer"
              aria-label="Next item"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          )}

          <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 text-xs tabular-nums text-neutral-400">
            {currentIndex + 1} / {items.length}
          </div>
        </div>
      </div>

      {/* Google Photos Material 3 Slide-Out Info Drawer */}
      {showInfo && (
        <aside className="w-80 sm:w-96 shrink-0 h-full bg-white dark:bg-[#1E1F20] text-[#1F1F1F] dark:text-[#E3E3E3] overflow-y-auto p-6 flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-medium">Info</h2>
            <button
              type="button"
              onClick={() => setShowInfo(false)}
              className="w-9 h-9 rounded-full flex items-center justify-center text-[#444746] dark:text-[#C4C7C5] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] cursor-pointer"
              aria-label="Close info panel"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <section className="space-y-3">
            <h3 className="text-xs font-medium text-[#747775] dark:text-[#8E918F]">Details</h3>
            <div className="space-y-2 text-sm">
              <div className="font-medium break-all">{item.filename}</div>
              <div className="text-xs text-[#444746] dark:text-[#C4C7C5] tabular-nums">
                {item.width} × {item.height}
                {item.mediaType === 'image' ? ` · ${formatMegapixels(item.width, item.height)}` : ''}
                {item.durationSec ? ` · ${formatDuration(item.durationSec)}` : ''}
                {' · '}
                {formatBytes(item.sizeBytes)}
              </div>
              <div className="text-xs text-[#444746] dark:text-[#C4C7C5] tabular-nums">
                {formatFullTimestamp(item.takenAt)}
              </div>
              <div className="flex items-center gap-2 text-xs text-[#444746] dark:text-[#C4C7C5] pt-1">
                <HardDrive className="w-4 h-4 text-[#0B57D0] dark:text-[#A8C7FA] shrink-0" />
                <span>
                  {item.sourceType === 'mount' ? `Read-only mount · ${item.mountName}` : 'Backed up to local library'}
                </span>
              </div>
            </div>
          </section>

          {(item.cameraMake || item.cameraModel || item.lensModel || item.focalLength || item.aperture || item.iso) && (
            <section className="space-y-3 pt-4 border-t border-black/[0.08] dark:border-white/[0.08]">
              <h3 className="text-xs font-medium text-[#747775] dark:text-[#8E918F] flex items-center gap-1.5">
                <Camera className="w-3.5 h-3.5" />
                Camera
              </h3>
              <div className="space-y-1.5">
                <div className="text-sm font-medium">
                  {[item.cameraMake, item.cameraModel].filter(Boolean).join(' ')}
                </div>
                {item.lensModel && (
                  <div className="text-xs text-[#444746] dark:text-[#C4C7C5]">{item.lensModel}</div>
                )}
                <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-xs text-[#444746] dark:text-[#C4C7C5] tabular-nums">
                  {item.aperture && <span>{item.aperture}</span>}
                  {item.shutterSpeed && <span>{item.shutterSpeed}</span>}
                  {item.focalLength && <span>{item.focalLength}</span>}
                  {item.iso && <span>ISO {item.iso}</span>}
                </div>
              </div>
            </section>
          )}

          {(item.locationName || (item.gpsLat !== null && item.gpsLng !== null)) && (
            <section className="space-y-3 pt-4 border-t border-black/[0.08] dark:border-white/[0.08]">
              <h3 className="text-xs font-medium text-[#747775] dark:text-[#8E918F] flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" />
                Location
              </h3>
              {item.locationName && <div className="text-sm font-medium">{item.locationName}</div>}
              {item.gpsLat !== null && item.gpsLng !== null && (
                <>
                  <div className="text-xs text-[#444746] dark:text-[#C4C7C5] tabular-nums">
                    {item.gpsLat.toFixed(5)}°, {item.gpsLng.toFixed(5)}°
                  </div>
                  {mapMarkerX !== null && mapMarkerY !== null && (
                    <div className="relative h-32 w-full rounded-2xl overflow-hidden bg-[#F1F3F4] dark:bg-[#282A2C]">
                      <svg viewBox="0 0 100 56" className="w-full h-full opacity-60">
                        <defs>
                          <pattern id="exifGridM3" width="10" height="10" patternUnits="userSpaceOnUse">
                            <path d="M 10 0 L 0 0 0 10" fill="none" stroke="currentColor" className="text-neutral-300 dark:text-neutral-700" strokeWidth="0.35" />
                          </pattern>
                        </defs>
                        <rect width="100" height="56" fill="url(#exifGridM3)" />
                      </svg>
                      <div
                        style={{ left: `${mapMarkerX}%`, top: `${mapMarkerY}%` }}
                        className="absolute -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-[#0B57D0] dark:bg-[#A8C7FA] ring-4 ring-[#0B57D0]/25"
                      />
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          <section className="space-y-1.5 pt-4 border-t border-black/[0.08] dark:border-white/[0.08]">
            <h3 className="text-xs font-medium text-[#747775] dark:text-[#8E918F]">SHA-256 Checksum</h3>
            <div className="p-3 rounded-xl bg-[#F8FAFD] dark:bg-[#282A2C] text-[11px] text-[#444746] dark:text-[#C4C7C5] break-all leading-relaxed select-all">
              {item.sha256}
            </div>
          </section>
        </aside>
      )}
    </div>
  );
};
