/**
 * Unit constants, conversions and display formatters.
 * Field names carry their unit (`latencyMs`, `sizeBytes`, `costUsdPerMonth`, `rps`); these helpers
 * convert between them so no module hand-rolls magic numbers.
 */

// ---------- Time ----------
export const MS_PER_SECOND = 1_000;
export const SECONDS_PER_MINUTE = 60;
export const SECONDS_PER_HOUR = 3_600;
export const SECONDS_PER_DAY = 86_400;
/** Billing convention used by cloud providers and the engine's cost step (24 × 365 / 12 ≈ 730). */
export const HOURS_PER_MONTH = 730;

export const secondsToMs = (sec: number): number => sec * MS_PER_SECOND;
export const msToSeconds = (ms: number): number => ms / MS_PER_SECOND;

// ---------- Size (decimal SI, as cloud pricing uses) ----------
export const BYTES_PER_KB = 1_000;
export const BYTES_PER_MB = 1_000_000;
export const BYTES_PER_GB = 1_000_000_000;
export const BYTES_PER_TB = 1_000_000_000_000;

export const kbToBytes = (kb: number): number => kb * BYTES_PER_KB;
export const mbToBytes = (mb: number): number => mb * BYTES_PER_MB;
export const gbToBytes = (gb: number): number => gb * BYTES_PER_GB;
export const bytesToGb = (bytes: number): number => bytes / BYTES_PER_GB;
/** Bytes per second → megabits per second (network bandwidth). */
export const bytesPerSecToMbps = (bps: number): number => (bps * 8) / 1_000_000;

// ---------- Rate ----------
/** Average requests per second from a per-day count, e.g. 100M users × 10/day → ≈ 11 574 rps. */
export const perDayToRps = (perDay: number): number => perDay / SECONDS_PER_DAY;
export const rpsToPerDay = (rps: number): number => rps * SECONDS_PER_DAY;

// ---------- Cost ----------
export const usdPerHourToUsdPerMonth = (usdPerHour: number): number => usdPerHour * HOURS_PER_MONTH;

// ---------- Formatters (for UI labels; pure and locale-independent) ----------
function trim(n: number, digits: number): string {
  return Number(n.toFixed(digits)).toString();
}

/** 0.42 → "420 µs", 12.3 → "12.3 ms", 1534 → "1.53 s". */
export function formatLatencyMs(ms: number): string {
  if (!Number.isFinite(ms)) return '∞';
  if (ms < 1) return `${trim(ms * 1_000, 0)} µs`;
  if (ms < 1_000) return `${trim(ms, ms < 10 ? 2 : 1)} ms`;
  return `${trim(ms / 1_000, 2)} s`;
}

/** 1500 → "1.5 KB", 2.5e9 → "2.5 GB". */
export function formatBytes(bytes: number): string {
  const steps: [number, string][] = [
    [BYTES_PER_TB, 'TB'],
    [BYTES_PER_GB, 'GB'],
    [BYTES_PER_MB, 'MB'],
    [BYTES_PER_KB, 'KB'],
  ];
  for (const [size, unit] of steps) {
    if (Math.abs(bytes) >= size) return `${trim(bytes / size, 2)} ${unit}`;
  }
  return `${trim(bytes, 0)} B`;
}

/** 950 → "950 rps", 11574 → "11.6k rps", 2.4e6 → "2.4M rps". */
export function formatRps(rps: number): string {
  if (Math.abs(rps) >= 1_000_000) return `${trim(rps / 1_000_000, 1)}M rps`;
  if (Math.abs(rps) >= 1_000) return `${trim(rps / 1_000, 1)}k rps`;
  return `${trim(rps, rps < 10 ? 2 : 0)} rps`;
}

/** 1234.5 → "$1,234.50". */
export function formatUsd(usd: number): string {
  const sign = usd < 0 ? '-' : '';
  const [whole = '0', cents = '00'] = Math.abs(usd).toFixed(2).split('.');
  return `${sign}$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`;
}

/** 0.1234 → "12.3%". */
export function formatPercent(ratio: number, digits = 1): string {
  return `${trim(ratio * 100, digits)}%`;
}
