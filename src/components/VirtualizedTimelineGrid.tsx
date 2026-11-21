import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Check, Film, ImageOff, Play, Star } from 'lucide-react';
import type { MediaItem } from '../types';
import { formatDuration, formatMonthYear } from '../lib/format';

interface VirtualizedTimelineGridProps {
  items: MediaItem[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onOpenLightbox: (index: number) => void;
  onToggleFavorite?: (item: MediaItem) => void;
  emptyTitle: string;
  emptyDescription: string;
  emptyAction?: React.ReactNode;
  readOnly?: boolean;
  selectMode?: boolean;
  columns?: number;
  topContent?: React.ReactNode;
}

interface HeaderRow {
  kind: 'header';
  key: string;
  headerText: string;
  monthYear: string;
  height: number;
}

interface MediaRowLayout {
  kind: 'media';
  key: string;
  monthYear: string;
  height: number;
  gap: number;
  tiles: Array<{
    item: MediaItem;
    globalIndex: number;
    width: number;
    height: number;
  }>;
}

type VirtualRow = HeaderRow | MediaRowLayout;

const HEADER_HEIGHT = 44;

function formatShortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Builds a crisp, uniform column-based date-grouped photo grid using square tiles
 * with consistent 4px (gap-1) or 6px (gap-1.5) spacing so full rows align cleanly
 * edge-to-edge and partial rows preserve identical tile proportions without stretching.
 */
function buildUniformGridRows(
  items: MediaItem[],
  containerWidth: number,
  columns: number
): VirtualRow[] {
  if (items.length === 0 || containerWidth <= 0) return [];

  const safeCols = Math.max(1, Math.round(columns));
  const gap = safeCols >= 5 ? 4 : 6;
  const totalGaps = gap * (safeCols - 1);
  const availableWidth = Math.max(safeCols * 44, containerWidth - totalGaps);
  const baseTileWidth = Math.floor(availableWidth / safeCols);
  const remainderPx = availableWidth - baseTileWidth * safeCols;
  const tileHeight = baseTileWidth;

  // Group items by calendar day (YYYY-MM-DD)
  const dayGroups: Array<{
    dayKey: string;
    leadIso: string;
    entries: Array<{ item: MediaItem; globalIndex: number }>;
  }> = [];

  items.forEach((item, globalIndex) => {
    const d = new Date(item.takenAt);
    const dayKey = Number.isNaN(d.getTime())
      ? 'unknown'
      : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const last = dayGroups[dayGroups.length - 1];
    if (last && last.dayKey === dayKey) {
      last.entries.push({ item, globalIndex });
    } else {
      dayGroups.push({
        dayKey,
        leadIso: item.takenAt,
        entries: [{ item, globalIndex }],
      });
    }
  });

  const rows: VirtualRow[] = [];

  for (const group of dayGroups) {
    const uniquePlaces = Array.from(
      new Set(
        group.entries
          .map((e) => e.item.locationName)
          .filter((x): x is string => Boolean(x))
      )
    );
    const datePart = formatShortDate(group.leadIso);
    const locationPart =
      uniquePlaces.length === 1
        ? uniquePlaces[0]
        : uniquePlaces.length > 1
          ? uniquePlaces.slice(0, 2).map((p) => p.split(',')[0]).join(', ')
          : '';
    const headerText = locationPart ? `${datePart} · ${locationPart}` : datePart;
    const monthYear = formatMonthYear(group.leadIso);

    rows.push({
      kind: 'header',
      key: `hdr-${group.dayKey}-${group.entries[0].item.id}`,
      headerText,
      monthYear,
      height: HEADER_HEIGHT,
    });

    for (let i = 0; i < group.entries.length; i += safeCols) {
      const chunk = group.entries.slice(i, i + safeCols);
      const isFullRow = chunk.length === safeCols;
      const tiles = chunk.map((entry, colIdx) => ({
        item: entry.item,
        globalIndex: entry.globalIndex,
        // Distribute sub-pixel rounding remainder cleanly across full rows for exact edge-to-edge alignment
        width: isFullRow && colIdx < remainderPx ? baseTileWidth + 1 : baseTileWidth,
        height: tileHeight,
      }));

      rows.push({
        kind: 'media',
        key: `row-${safeCols}-${group.dayKey}-${i}-${chunk[0].item.id}`,
        monthYear,
        height: tileHeight + gap,
        gap,
        tiles,
      });
    }
  }

  return rows;
}

const MediaTile: React.FC<{
  item: MediaItem;
  width: number;
  height: number;
  isSelected: boolean;
  selectionMode: boolean;
  readOnly?: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onToggleFavorite?: () => void;
}> = React.memo(
  ({ item, width, height, isSelected, selectionMode, readOnly, onSelect, onOpen, onToggleFavorite }) => {
    const [imgError, setImgError] = useState(false);

    return (
      <div
        style={{ width, height }}
        className={`group relative overflow-hidden rounded-none select-none transition-all duration-150 ${
          isSelected ? 'bg-[#E8F0FE] dark:bg-[#004A77]/40 p-2' : ''
        }`}
      >
        <div
          style={{ backgroundColor: item.dominantColor }}
          className={`relative w-full h-full overflow-hidden transition-all duration-150 ${
            isSelected
              ? 'rounded-md ring-2 ring-[#1A73E8] dark:ring-[#8AB4F8] shadow-xs'
              : 'rounded-none'
          }`}
        >
          <button
            type="button"
            onClick={() => (selectionMode && !readOnly ? onSelect() : onOpen())}
            className="block w-full h-full text-left focus-visible:outline-2 focus-visible:outline-[#0B57D0] cursor-pointer"
            aria-label={
              selectionMode && !readOnly
                ? isSelected
                  ? `Deselect ${item.filename}`
                  : `Select ${item.filename}`
                : `Open ${item.filename}`
            }
          >
            {!imgError ? (
              <img
                src={item.thumb400Url}
                alt={item.filename}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                onError={() => setImgError(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center p-3 bg-neutral-200 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 text-center">
                <ImageOff className="w-5 h-5 mb-1 opacity-70" />
                <span className="text-xs truncate max-w-full">{item.filename}</span>
              </div>
            )}
          </button>

          {/* Soft dark top gradient scrim smoothly appearing on hover */}
          <div
            className={`pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-black/50 via-black/15 to-transparent transition-opacity duration-150 ${
              isSelected || selectionMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
          />

          {/* Soft dark bottom gradient scrim on hover (or always subtle for videos) */}
          <div
            className={`pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/55 via-black/15 to-transparent transition-opacity duration-150 ${
              item.mediaType === 'video' ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
          />

          {/* Top-left circular selection checkbox on hover or during Select Mode */}
          {!readOnly && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelect();
              }}
              aria-pressed={isSelected}
              aria-label={isSelected ? `Deselect ${item.filename}` : `Select ${item.filename}`}
              className={`absolute top-2 left-2 w-6 h-6 rounded-full flex items-center justify-center transition-all duration-150 cursor-pointer ${
                isSelected
                  ? 'bg-[#1A73E8] dark:bg-[#8AB4F8] text-white dark:text-[#062E6F] ring-2 ring-white dark:ring-[#1E1F20] opacity-100 shadow-sm scale-100'
                  : selectionMode
                    ? 'border-2 border-white/95 bg-black/25 text-transparent opacity-100 hover:bg-black/45 hover:scale-105'
                    : 'border-2 border-white/95 bg-black/20 text-transparent opacity-0 group-hover:opacity-100 hover:bg-black/45 hover:scale-105'
              }`}
            >
              <Check className="w-3.5 h-3.5 stroke-[2.8]" />
            </button>
          )}

          {/* Subtle white star icon (hidden during active selection mode to avoid accidental taps) */}
          {!readOnly && !selectionMode && onToggleFavorite && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite();
              }}
              aria-label={item.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              className={`absolute top-2 right-2 p-1 rounded-full text-white transition-opacity duration-150 cursor-pointer drop-shadow-xs ${
                item.isFavorite
                  ? 'opacity-95'
                  : 'opacity-0 group-hover:opacity-90 hover:opacity-100'
              }`}
            >
              <Star className={`w-4 h-4 ${item.isFavorite ? 'fill-white' : ''}`} />
            </button>
          )}

          {/* Clean white video duration indicator */}
          {item.mediaType === 'video' && (
            <div className="pointer-events-none absolute bottom-2 right-2.5 flex items-center gap-1 text-xs font-medium text-white tabular-nums drop-shadow-xs">
              <span>{item.durationSec ? formatDuration(item.durationSec) : 'Video'}</span>
              <Play className="w-3.5 h-3.5 fill-white" />
            </div>
          )}
        </div>
      </div>
    );
  }
);

export const VirtualizedTimelineGrid: React.FC<VirtualizedTimelineGridProps> = ({
  items,
  selectedIds,
  onToggleSelect,
  onOpenLightbox,
  onToggleFavorite,
  emptyTitle,
  emptyDescription,
  emptyAction,
  readOnly = false,
  selectMode = false,
  columns,
  topContent,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrubberRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1040);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubPercent, setScrubPercent] = useState(0);
  const [activeScrubLabel, setActiveScrubLabel] = useState('');

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const measure = () => {
      // Exact available inner width inside horizontal padding (px-4 lg:px-7)
      const horizontalPadding = window.innerWidth >= 1024 ? 56 : 32;
      const inner = Math.max(240, el.clientWidth - horizontalPadding);
      setContainerWidth(inner);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const effectiveColumns = columns ?? (containerWidth < 768 ? 3 : 5);

  const rows = useMemo(
    () => buildUniformGridRows(items, containerWidth, effectiveColumns),
    [items, containerWidth, effectiveColumns]
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: (index) => rows[index]?.height ?? 180,
    overscan: 6,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [rows, virtualizer]);

  // Extract timeline scrubber anchors
  const scrubMarkers = useMemo(() => {
    if (rows.length === 0) return [];
    const seen = new Set<string>();
    const markers: Array<{ label: string; rowIndex: number; percent: number }> = [];
    rows.forEach((row, idx) => {
      if (row.kind === 'header' && !seen.has(row.monthYear)) {
        seen.add(row.monthYear);
        markers.push({
          label: row.monthYear,
          rowIndex: idx,
          percent: rows.length > 1 ? (idx / (rows.length - 1)) * 100 : 0,
        });
      }
    });
    return markers;
  }, [rows]);

  const handleScroll = useCallback(() => {
    if (isScrubbing) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    const maxScroll = el.scrollHeight - el.clientHeight;
    if (maxScroll > 0) {
      setScrubPercent(Math.min(100, Math.max(0, (el.scrollTop / maxScroll) * 100)));
    } else {
      setScrubPercent(0);
    }
  }, [isScrubbing]);

  const scrubToClientY = useCallback(
    (clientY: number) => {
      const rail = scrubberRef.current;
      if (!rail || rows.length === 0) return;
      const rect = rail.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
      setScrubPercent(ratio * 100);
      const targetIndex = Math.min(rows.length - 1, Math.round(ratio * (rows.length - 1)));
      const targetRow = rows[targetIndex];
      if (targetRow) setActiveScrubLabel(targetRow.monthYear);
      virtualizer.scrollToIndex(targetIndex, { align: 'start' });
    },
    [rows, virtualizer]
  );

  useEffect(() => {
    if (!isScrubbing) return;
    const onMove = (e: PointerEvent) => {
      e.preventDefault();
      scrubToClientY(e.clientY);
    };
    const onUp = () => setIsScrubbing(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [isScrubbing, scrubToClientY]);

  const virtualItems = virtualizer.getVirtualItems();
  const selectionMode = selectMode || selectedIds.size > 0;

  return (
    <div className="relative flex-1 min-h-0 flex">
      {/* Main virtualized scroll container */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 lg:px-7 pb-24 sm:pb-16"
      >
        {topContent}

        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
            <div className="w-14 h-14 rounded-full bg-[#F1F3F4] dark:bg-[#282A2C] flex items-center justify-center text-[#5F6368] dark:text-[#9AA0A6] mb-4">
              <Film className="w-6 h-6" />
            </div>
            <h2 className="text-base font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">{emptyTitle}</h2>
            <p className="mt-1.5 text-sm text-[#5F6368] dark:text-[#9AA0A6] max-w-sm">
              {emptyDescription}
            </p>
            {emptyAction && <div className="mt-5">{emptyAction}</div>}
          </div>
        ) : (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: `${containerWidth}px`,
              position: 'relative',
            }}
          >
            {virtualItems.map((virtualRow) => {
              const row = rows[virtualRow.index];
              if (!row) return null;

              return (
                <div
                  key={row.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {row.kind === 'header' ? (
                    <div className="h-full flex items-end pb-2.5 pt-2">
                      <h3 className="text-[14px] font-medium text-neutral-700 dark:text-neutral-200 truncate">
                        {row.headerText}
                      </h3>
                    </div>
                  ) : (
                    <div className="flex items-start" style={{ gap: `${row.gap}px` }}>
                      {row.tiles.map((tile) => (
                        <MediaTile
                          key={tile.item.id}
                          item={tile.item}
                          width={tile.width}
                          height={tile.height}
                          isSelected={selectedIds.has(tile.item.id)}
                          selectionMode={selectionMode}
                          readOnly={readOnly}
                          onSelect={() => onToggleSelect(tile.item.id)}
                          onOpen={() => onOpenLightbox(tile.globalIndex)}
                          onToggleFavorite={
                            onToggleFavorite ? () => onToggleFavorite(tile.item) : undefined
                          }
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Subtle Google Photos right-side draggable date scrubber */}
      {items.length > 0 && scrubMarkers.length > 0 && (
        <div
          ref={scrubberRef}
          onPointerDown={(e) => {
            e.preventDefault();
            setIsScrubbing(true);
            scrubToClientY(e.clientY);
          }}
          className="hidden sm:flex relative w-7 shrink-0 select-none touch-none flex-col items-center py-4 cursor-ns-resize group/scrubber"
          aria-label="Timeline date scrubber"
          title="Drag to scrub timeline dates"
        >
          <div className="w-[3px] flex-1 rounded-full bg-transparent group-hover/scrubber:bg-neutral-200 dark:group-hover/scrubber:bg-neutral-800 transition-colors" />

          {/* Draggable scrub thumb */}
          <div
            style={{ top: `calc(${scrubPercent}% * 0.88 + 16px)` }}
            className={`absolute right-2 -translate-y-1/2 w-1.5 h-7 rounded-full transition-all ${
              isScrubbing
                ? 'bg-[#0B57D0] dark:bg-[#A8C7FA] w-2'
                : 'bg-neutral-300 dark:bg-neutral-700 group-hover/scrubber:bg-[#0B57D0] dark:group-hover/scrubber:bg-[#A8C7FA]'
            }`}
          />

          {/* Floating Material date pill while scrubbing */}
          {isScrubbing && activeScrubLabel && (
            <div
              style={{ top: `calc(${scrubPercent}% * 0.88 + 16px)` }}
              className="pointer-events-none absolute right-9 -translate-y-1/2 rounded-full bg-[#1F1F1F] dark:bg-[#E3E3E3] text-white dark:text-[#1F1F1F] px-3.5 py-1.5 text-xs font-medium shadow-lg whitespace-nowrap"
            >
              {activeScrubLabel}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
