import React, { useMemo, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { MediaItem } from '../types';
import { formatMonthYear } from '../lib/format';

interface MemoryCard {
  id: string;
  title: string;
  subtitle: string;
  coverUrl: string;
  dominantColor: string;
  items: MediaItem[];
}

interface MemoriesCarouselProps {
  items: MediaItem[];
  onOpenMemory: (memoryItems: MediaItem[]) => void;
}

export const MemoriesCarousel: React.FC<MemoriesCarouselProps> = ({ items, onOpenMemory }) => {
  const scrollerRef = useRef<HTMLDivElement>(null);

  const memories = useMemo<MemoryCard[]>(() => {
    if (items.length === 0) return [];
    const cards: MemoryCard[] = [];

    // 1. Recent highlights (favorited items or newest 4)
    const favs = items.filter((m) => m.isFavorite);
    const highlightItems = favs.length > 0 ? favs : items.slice(0, 4);
    if (highlightItems.length > 0) {
      cards.push({
        id: 'mem-highlights',
        title: 'Recent highlights',
        subtitle: formatMonthYear(highlightItems[0].takenAt),
        coverUrl: highlightItems[0].thumb400Url,
        dominantColor: highlightItems[0].dominantColor,
        items: highlightItems,
      });
    }

    // 2. Curated place memories from geotagged photos
    const byLocation = new Map<string, MediaItem[]>();
    for (const item of items) {
      if (!item.locationName) continue;
      const list = byLocation.get(item.locationName) || [];
      list.push(item);
      byLocation.set(item.locationName, list);
    }

    for (const [loc, locItems] of byLocation.entries()) {
      const shortPlace = loc.split(',')[0].trim();
      cards.push({
        id: `mem-loc-${loc}`,
        title: `Spotlight on ${shortPlace}`,
        subtitle: formatMonthYear(locItems[0].takenAt),
        coverUrl: locItems[0].thumb400Url,
        dominantColor: locItems[0].dominantColor,
        items: locItems,
      });
    }

    return cards.slice(0, 8);
  }, [items]);

  if (memories.length === 0) return null;

  const scrollByAmount = (delta: number) => {
    scrollerRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  };

  return (
    <section className="relative group/memories pt-2 pb-5">
      <div
        ref={scrollerRef}
        className="flex items-stretch gap-3 overflow-x-auto no-scrollbar scroll-smooth"
      >
        {memories.map((mem) => (
          <button
            key={mem.id}
            type="button"
            onClick={() => onOpenMemory(mem.items)}
            style={{ backgroundColor: mem.dominantColor }}
            className="group relative w-36 sm:w-44 aspect-[3/4] shrink-0 rounded-2xl overflow-hidden text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-[#0B57D0]"
          >
            <img
              src={mem.coverUrl}
              alt={mem.title}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-3.5 text-white">
              <div className="font-display text-[15px] font-semibold leading-snug line-clamp-2 drop-shadow-xs">
                {mem.title}
              </div>
              <div className="mt-1 text-xs text-white/80 font-normal">
                {mem.subtitle}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Subtle floating Google Photos carousel scroll chevrons on hover */}
      <button
        type="button"
        onClick={() => scrollByAmount(-320)}
        aria-label="Scroll memories left"
        className="hidden md:flex opacity-0 group-hover/memories:opacity-100 transition-opacity absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/95 dark:bg-[#282A2C]/95 text-[#1F1F1F] dark:text-[#E3E3E3] shadow-md items-center justify-center hover:scale-105 cursor-pointer"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>
      <button
        type="button"
        onClick={() => scrollByAmount(320)}
        aria-label="Scroll memories right"
        className="hidden md:flex opacity-0 group-hover/memories:opacity-100 transition-opacity absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/95 dark:bg-[#282A2C]/95 text-[#1F1F1F] dark:text-[#E3E3E3] shadow-md items-center justify-center hover:scale-105 cursor-pointer"
      >
        <ChevronRight className="w-5 h-5" />
      </button>
    </section>
  );
};
