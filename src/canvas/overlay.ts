/** Pure helpers for the performance overlays (S08). Numbers come from SimResult; nothing is computed here but view scaling. */
import { formatPercent, utilizationLevel, type EdgeTick, type UtilizationLevel } from '@/store';

export const EDGE_WIDTH = { min: 1.5, max: 8 } as const;

/**
 * Stroke width for an edge carrying `rps` when the busiest edge on the board carries `maxRps`.
 * Square-root scale, so a 4× busier edge looks 2× thicker and quiet edges stay visible.
 */
export function edgeStrokeWidth(rps: number, maxRps: number): number {
  if (!(rps > 0) || !(maxRps > 0)) return EDGE_WIDTH.min;
  const t = Math.min(1, Math.sqrt(rps / maxRps));
  return Math.round((EDGE_WIDTH.min + (EDGE_WIDTH.max - EDGE_WIDTH.min) * t) * 10) / 10;
}

/** The busiest edge's rps (0 when there is no result). */
export function maxEdgeRps(perEdge: Readonly<Record<string, { rps: number }>> | undefined): number {
  if (!perEdge) return 0;
  let max = 0;
  for (const m of Object.values(perEdge)) if (m.rps > max) max = m.rps;
  return max;
}

/** Tailwind classes per utilisation band (border + tint of the node, colour of the pill). */
export const LEVEL_STYLES: Record<UtilizationLevel, { border: string; pill: string }> = {
  ok: {
    border: 'border-emerald-500 dark:border-emerald-500',
    pill: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  },
  warn: {
    border: 'border-amber-500 dark:border-amber-400',
    pill: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  },
  hot: {
    border: 'border-red-600 dark:border-red-500',
    pill: 'bg-red-600 text-white dark:bg-red-500',
  },
};

export { utilizationLevel };

/**
 * Edge look at one timeline tick (S11): an open circuit breaker is dashed red with "breaker
 * open"; an edge where ≥ 50 % of calls fail is red with its failure share. Text, not colour alone.
 */
export function tickEdgeStyle(t: EdgeTick): { stroke?: string; dashed: boolean; badge?: string } {
  if (t.breaker === 'open') return { stroke: '#dc2626', dashed: true, badge: 'breaker open' };
  if (t.breaker === 'half-open')
    return { stroke: '#d97706', dashed: true, badge: 'breaker half-open' };
  if (t.errorRate >= 0.5)
    return { stroke: '#dc2626', dashed: false, badge: `${formatPercent(t.errorRate)} fail` };
  return { dashed: false };
}
