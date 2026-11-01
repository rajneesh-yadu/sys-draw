/**
 * Category colours for the trace (packets, timing bar, legend): the reference categorical palette
 * in fixed slot order (validated: adjacent CVD ΔE ≥ 9; dark-mode steps are set in app/index.css as
 * `--trace-<category>`). Several sit below 3:1 on white, so every coloured mark has a text label
 * or legend row beside it — colour never carries the meaning alone.
 */
export const TRACE_COLOR_ORDER = [
  'dns',
  'tcp',
  'tls',
  'handshake',
  'network',
  'queue',
  'service',
  'db',
] as const;
const LIGHT = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
  '#6250d6',
  '#e34948',
];

/** CSS colour for a trace category (CSS variable, light step as fallback). */
export function traceColor(category: string): string {
  const i = TRACE_COLOR_ORDER.indexOf(category as (typeof TRACE_COLOR_ORDER)[number]);
  return i < 0 ? '#8a8a80' : `var(--trace-${category}, ${LIGHT[i]})`;
}
