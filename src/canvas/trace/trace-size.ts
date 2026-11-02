/**
 * S24: request trace panel width (pure helpers; the panel and its owner share them).
 *
 * The panel sits beside the canvas in a flex row. Its CSS width is
 * `min(<stored px>, <max share> of the row)`, so the canvas always keeps at least
 * `1 - TRACE_MAX_SHARE` of the row however wide the stored width is, and a wide width stored
 * on a big monitor still fits on a laptop.
 */

export interface TraceSize {
  /** Panel width when not expanded (px). */
  widthPx: number;
  /** Take the largest share of the row the canvas allows. */
  expanded: boolean;
}

/** w-80: the options grid and the sequence diagram's two columns still fit. */
export const TRACE_MIN_WIDTH = 320;
/** The width before S24 (Tailwind w-96). */
export const TRACE_DEFAULT_WIDTH = 384;
export const TRACE_MAX_WIDTH = 2000;
/** At most this share of the row beside the canvas, so the canvas keeps ≥ 30 %. */
export const TRACE_MAX_SHARE = 0.7;
/** Arrow-key step and Page Up/Down step (px). */
export const TRACE_KEY_STEP = 24;
export const TRACE_PAGE_STEP = 120;

export const DEFAULT_TRACE_SIZE: TraceSize = { widthPx: TRACE_DEFAULT_WIDTH, expanded: false };

export function clampTraceWidth(px: number): number {
  if (!Number.isFinite(px)) return TRACE_DEFAULT_WIDTH;
  return Math.round(Math.min(TRACE_MAX_WIDTH, Math.max(TRACE_MIN_WIDTH, px)));
}

/** CSS width of the panel: the stored width, never more than the row allows. */
export function traceWidthCss(size: TraceSize): string {
  const cap = `${TRACE_MAX_SHARE * 100}%`;
  return size.expanded ? cap : `min(${clampTraceWidth(size.widthPx)}px, ${cap})`;
}

/** CSS min-width: the minimum, unless the row is so narrow that the cap is smaller. */
export function traceMinWidthCss(): string {
  return `min(${TRACE_MIN_WIDTH}px, ${TRACE_MAX_SHARE * 100}%)`;
}

/**
 * Keyboard resizing on the separator (WAI-ARIA window splitter; the panel is on the right, so
 * ← widens it): ←/→ by a step, Page Up/Down by a bigger step, Home = minimum, End = expanded,
 * Enter = toggle expanded. Returns null for other keys.
 */
export function resizeTraceByKey(key: string, size: TraceSize): TraceSize | null {
  const w = size.widthPx;
  switch (key) {
    case 'ArrowLeft':
      return { widthPx: clampTraceWidth(w + TRACE_KEY_STEP), expanded: false };
    case 'ArrowRight':
      return { widthPx: clampTraceWidth(w - TRACE_KEY_STEP), expanded: false };
    case 'PageUp':
      return { widthPx: clampTraceWidth(w + TRACE_PAGE_STEP), expanded: false };
    case 'PageDown':
      return { widthPx: clampTraceWidth(w - TRACE_PAGE_STEP), expanded: false };
    case 'Home':
      return { widthPx: TRACE_MIN_WIDTH, expanded: false };
    case 'End':
      return { widthPx: w, expanded: true };
    case 'Enter':
      return { widthPx: w, expanded: !size.expanded };
    default:
      return null;
  }
}
