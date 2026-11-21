import React from 'react';
import { LayoutGrid } from 'lucide-react';

interface GridDensityToggleProps {
  columns: number;
  options: readonly number[];
  onChange: (columns: number) => void;
}

export const GridDensityToggle: React.FC<GridDensityToggleProps> = ({
  columns,
  options,
  onChange,
}) => {
  return (
    <div
      role="group"
      aria-label="Grid columns per row"
      className="inline-flex items-center h-8 rounded-lg border border-neutral-300 dark:border-neutral-700 p-0.5 bg-white dark:bg-[#131314] shrink-0"
    >
      <span
        aria-hidden="true"
        className="px-1.5 text-[#5F6368] dark:text-[#9AA0A6] flex items-center justify-center"
        title="Photos per row"
      >
        <LayoutGrid className="w-3.5 h-3.5" />
      </span>
      {options.map((opt) => {
        const active = columns === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            aria-pressed={active}
            aria-label={`${opt} columns per row`}
            title={`${opt} columns per row`}
            className={`min-w-6.5 h-6.5 px-1.5 rounded-md text-[12px] font-medium tabular-nums transition-colors cursor-pointer flex items-center justify-center ${
              active
                ? 'bg-[#C2E7FF] text-[#001D35] dark:bg-[#004A77] dark:text-[#C2E7FF]'
                : 'text-[#444746] dark:text-[#C4C7C5] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]'
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
};
