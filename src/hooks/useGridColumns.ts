import { useCallback, useEffect, useState } from 'react';

export type MobileColumnOption = 2 | 3;
export type DesktopColumnOption = 4 | 5 | 7;

const MOBILE_STORAGE_KEY = 'xphotolabs_grid_cols_mobile';
const DESKTOP_STORAGE_KEY = 'xphotolabs_grid_cols_desktop';

const MOBILE_OPTIONS: readonly MobileColumnOption[] = [2, 3];
const DESKTOP_OPTIONS: readonly DesktopColumnOption[] = [4, 5, 7];

function readMobileCols(): MobileColumnOption {
  try {
    const raw = Number(localStorage.getItem(MOBILE_STORAGE_KEY));
    if (raw === 2 || raw === 3) return raw;
  } catch {
    // ignore storage access issues
  }
  return 3;
}

function readDesktopCols(): DesktopColumnOption {
  try {
    const raw = Number(localStorage.getItem(DESKTOP_STORAGE_KEY));
    if (raw === 4 || raw === 5 || raw === 7) return raw;
  } catch {
    // ignore storage access issues
  }
  return 5;
}

export function useGridColumns() {
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.matchMedia('(min-width: 768px)').matches;
  });

  const [mobileColumns, setMobileColumnsState] = useState<MobileColumnOption>(readMobileCols);
  const [desktopColumns, setDesktopColumnsState] = useState<DesktopColumnOption>(readDesktopCols);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 768px)');
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    setIsDesktop(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const setMobileColumns = useCallback((cols: MobileColumnOption) => {
    setMobileColumnsState(cols);
    try {
      localStorage.setItem(MOBILE_STORAGE_KEY, String(cols));
    } catch {
      // ignore
    }
  }, []);

  const setDesktopColumns = useCallback((cols: DesktopColumnOption) => {
    setDesktopColumnsState(cols);
    try {
      localStorage.setItem(DESKTOP_STORAGE_KEY, String(cols));
    } catch {
      // ignore
    }
  }, []);

  const columns = isDesktop ? desktopColumns : mobileColumns;
  const options: readonly number[] = isDesktop ? DESKTOP_OPTIONS : MOBILE_OPTIONS;

  const setColumns = useCallback(
    (next: number) => {
      if (isDesktop) {
        if (next === 4 || next === 5 || next === 7) setDesktopColumns(next);
      } else {
        if (next === 2 || next === 3) setMobileColumns(next);
      }
    },
    [isDesktop, setDesktopColumns, setMobileColumns]
  );

  return {
    isDesktop,
    columns,
    options,
    setColumns,
  };
}
