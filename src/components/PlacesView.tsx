import React from 'react';
import { ArrowLeft, CheckCircle2, MapPin } from 'lucide-react';
import type { MediaItem, PlaceCluster } from '../types';
import { VirtualizedTimelineGrid } from './VirtualizedTimelineGrid';

interface PlacesViewProps {
  places: PlaceCluster[];
  activePlace: string | null;
  placeItems: MediaItem[];
  selectedIds: Set<string>;
  selectMode: boolean;
  columns: number;
  gridDensityControl?: React.ReactNode;
  onToggleSelectMode: () => void;
  onSelectPlace: (placeName: string | null) => void;
  onToggleSelect: (id: string) => void;
  onOpenLightbox: (index: number) => void;
  onToggleFavorite: (item: MediaItem) => void;
}

export const PlacesView: React.FC<PlacesViewProps> = ({
  places,
  activePlace,
  placeItems,
  selectedIds,
  selectMode,
  columns,
  gridDensityControl,
  onToggleSelectMode,
  onSelectPlace,
  onToggleSelect,
  onOpenLightbox,
  onToggleFavorite,
}) => {
  if (activePlace) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-4 lg:px-7 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => onSelectPlace(null)}
              className="w-10 h-10 -ml-2 rounded-full flex items-center justify-center text-[#444746] dark:text-[#C4C7C5] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] cursor-pointer"
              aria-label="Back to places"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h1 className="text-2xl font-normal tracking-tight text-[#1F1F1F] dark:text-[#E3E3E3] truncate">
                {activePlace}
              </h1>
              <p className="text-xs text-[#747775] dark:text-[#8E918F] tabular-nums">
                {placeItems.length} geotagged {placeItems.length === 1 ? 'item' : 'items'}
              </p>
            </div>
          </div>
          {placeItems.length > 0 && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={onToggleSelectMode}
                aria-pressed={selectMode}
                className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  selectMode
                    ? 'bg-[#C2E7FF] text-[#001D35] dark:bg-[#004A77] dark:text-[#C2E7FF]'
                    : 'border border-neutral-300 dark:border-neutral-700 text-[#444746] dark:text-[#C4C7C5] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{selectMode ? 'Done' : 'Select'}</span>
              </button>
              {gridDensityControl}
            </div>
          )}
        </div>
        <VirtualizedTimelineGrid
          items={placeItems}
          selectedIds={selectedIds}
          selectMode={selectMode}
          columns={columns}
          onToggleSelect={onToggleSelect}
          onOpenLightbox={onOpenLightbox}
          onToggleFavorite={onToggleFavorite}
          emptyTitle="No photos at this location"
          emptyDescription="Items geotagged with this place will appear here."
        />
      </div>
    );
  }

  const mappable = places.filter((p) => p.lat !== null && p.lng !== null);

  return (
    <div className="flex-1 overflow-y-auto px-4 lg:px-8 py-6 space-y-8">
      <div>
        <h1 className="text-2xl font-normal tracking-tight text-[#1F1F1F] dark:text-[#E3E3E3]">
          Places
        </h1>
        <p className="mt-1 text-xs text-[#747775] dark:text-[#8E918F] tabular-nums">
          {places.length} {places.length === 1 ? 'location' : 'locations'} from EXIF GPS coordinates
        </p>
      </div>

      {/* Interactive Self-Hosted Coordinate Cluster Map */}
      {mappable.length > 0 && (
        <div className="relative w-full h-72 sm:h-80 rounded-3xl overflow-hidden bg-[#F1F5F9] dark:bg-[#1E1F20]">
          <svg
            viewBox="0 0 1000 500"
            preserveAspectRatio="none"
            className="w-full h-full opacity-75 dark:opacity-45"
            aria-hidden="true"
          >
            <defs>
              <pattern id="placesGridM3" width="50" height="50" patternUnits="userSpaceOnUse">
                <path
                  d="M 50 0 L 0 0 0 50"
                  fill="none"
                  stroke="currentColor"
                  className="text-neutral-200 dark:text-neutral-800"
                  strokeWidth="1"
                />
              </pattern>
            </defs>
            <rect width="1000" height="500" fill="url(#placesGridM3)" />
            <path
              d="M110,95 L265,85 L315,155 L265,220 L215,245 L170,210 L130,170 Z M245,260 L335,290 L315,415 L265,435 L230,350 Z M455,80 L585,70 L615,145 L555,180 L470,175 L445,125 Z M465,195 L575,205 L595,310 L535,395 L485,365 L455,265 Z M610,95 L830,105 L875,185 L815,245 L715,255 L635,205 Z M775,305 L885,315 L895,395 L815,410 L765,365 Z"
              fill="currentColor"
              className="text-neutral-300/75 dark:text-neutral-700/70"
            />
          </svg>

          {mappable.map((place) => {
            const xPct = (((place.lng as number) + 180) / 360) * 100;
            const yPct = ((90 - (place.lat as number)) / 180) * 100;
            return (
              <button
                key={place.name}
                type="button"
                onClick={() => onSelectPlace(place.name)}
                style={{ left: `${xPct}%`, top: `${yPct}%` }}
                className="group absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center cursor-pointer focus-visible:outline-none"
                title={`${place.name} (${place.count})`}
              >
                <div className="relative w-12 h-12 rounded-full p-0.5 bg-white dark:bg-[#282A2C] shadow-lg ring-2 ring-white dark:ring-[#131314] group-hover:scale-110 transition-transform overflow-hidden">
                  {place.coverUrl ? (
                    <img
                      src={place.coverUrl}
                      alt={place.name}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover rounded-full"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-[#0B57D0] text-white rounded-full">
                      <MapPin className="w-4 h-4" />
                    </div>
                  )}
                </div>
                <span className="mt-1 px-2.5 py-0.5 rounded-full bg-white/95 dark:bg-[#282A2C]/95 text-[#1F1F1F] dark:text-[#E3E3E3] text-[11px] font-medium shadow-md whitespace-nowrap">
                  {place.name.split(',')[0]}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Location Collection Grid */}
      {places.length === 0 ? (
        <div className="py-16 text-center rounded-3xl bg-[#F8FAFD] dark:bg-[#1E1F20]">
          <MapPin className="w-8 h-8 text-[#747775] mx-auto mb-3" />
          <p className="text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">No geotagged media yet</p>
          <p className="mt-1 text-xs text-[#747775] dark:text-[#8E918F]">
            Photos and videos containing EXIF GPS metadata are grouped automatically.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-6">
          {places.map((place) => (
            <button
              key={place.name}
              type="button"
              onClick={() => onSelectPlace(place.name)}
              className="group text-left flex flex-col cursor-pointer"
            >
              <div className="relative aspect-[4/3] w-full rounded-2xl overflow-hidden bg-[#F1F3F4] dark:bg-[#282A2C]">
                {place.coverUrl ? (
                  <img
                    src={place.coverUrl}
                    alt={place.name}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[#747775]">
                    <MapPin className="w-6 h-6" />
                  </div>
                )}
              </div>
              <div className="mt-2.5 px-0.5">
                <div className="text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3] group-hover:text-[#0B57D0] dark:group-hover:text-[#A8C7FA] truncate">
                  {place.name}
                </div>
                <div className="text-xs text-[#747775] dark:text-[#8E918F] tabular-nums mt-0.5">
                  {place.count} {place.count === 1 ? 'item' : 'items'}
                  {place.lat !== null && place.lng !== null
                    ? ` · ${place.lat.toFixed(2)}°, ${place.lng.toFixed(2)}°`
                    : ''}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
