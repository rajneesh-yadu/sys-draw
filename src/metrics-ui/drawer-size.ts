/** S21: metrics drawer size (pure helpers; the drawer and its owner share them). */

export interface DrawerSize {
  /** Body height when not maximised (px). */
  heightPx: number;
  /** Take most of the window (leaves room for the top bar, tabs and a strip of canvas). */
  maximized: boolean;
}

export const DRAWER_MIN_HEIGHT = 120;
export const DRAWER_DEFAULT_HEIGHT = 240;
export const DRAWER_MAX_HEIGHT = 2000;
/** Arrow-key step and Page Up/Down step (px). */
export const DRAWER_KEY_STEP = 24;
export const DRAWER_PAGE_STEP = 120;
/**
 * What the drawer always leaves above itself: top bar (3 rem) + board tabs (~2.25 rem) + the
 * drawer header (~2.25 rem) + at least ~9.5 rem of canvas (its toolbar and a strip of the board).
 */
export const DRAWER_RESERVED = '17rem';

export function clampDrawerHeight(px: number): number {
  if (!Number.isFinite(px)) return DRAWER_DEFAULT_HEIGHT;
  return Math.round(Math.min(DRAWER_MAX_HEIGHT, Math.max(DRAWER_MIN_HEIGHT, px)));
}

/** CSS height of the drawer body: the stored height, never more than the window allows. */
export function drawerBodyHeight(size: DrawerSize): string {
  const cap = `calc(100dvh - ${DRAWER_RESERVED})`;
  return size.maximized ? cap : `min(${clampDrawerHeight(size.heightPx)}px, ${cap})`;
}

/**
 * Keyboard resizing on the separator (WAI-ARIA window splitter): ↑/↓ by a step, Page Up/Down by a
 * bigger step, Home = minimum, End = maximised, Enter = toggle maximised. Returns null for other keys.
 */
export function resizeByKey(key: string, size: DrawerSize): DrawerSize | null {
  const h = size.heightPx;
  switch (key) {
    case 'ArrowUp':
      return { heightPx: clampDrawerHeight(h + DRAWER_KEY_STEP), maximized: false };
    case 'ArrowDown':
      return { heightPx: clampDrawerHeight(h - DRAWER_KEY_STEP), maximized: false };
    case 'PageUp':
      return { heightPx: clampDrawerHeight(h + DRAWER_PAGE_STEP), maximized: false };
    case 'PageDown':
      return { heightPx: clampDrawerHeight(h - DRAWER_PAGE_STEP), maximized: false };
    case 'Home':
      return { heightPx: DRAWER_MIN_HEIGHT, maximized: false };
    case 'End':
      return { heightPx: size.heightPx, maximized: true };
    case 'Enter':
      return { heightPx: size.heightPx, maximized: !size.maximized };
    default:
      return null;
  }
}
