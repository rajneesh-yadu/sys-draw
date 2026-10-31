/** Number formatting for explain strings (deterministic, locale-independent). */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? '∞' : '−∞';
  if (n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e6) return String(Math.round(n));
  return String(Number(n.toPrecision(abs >= 1000 ? 6 : 4)));
}

export function pct(r: number): string {
  return `${fmt(r * 100)}%`;
}
