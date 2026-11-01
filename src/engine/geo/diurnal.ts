/**
 * Geo step — daily traffic cycle. `usersByRegion` holds each region's users at ITS local peak.
 * With the daily cycle on, a region's load at local hour h is users × f(h) (curve below, peak 1
 * at 20:00, trough ≈ 0.26 at 04:00). Regions peak at different UTC times, so the analytical run
 * evaluates the UTC moment with the highest total load (searched every 15 min). With the cycle off
 * every region is at its peak at once (the conservative worst case).
 */
import { fmt } from '../model/format';

/** Typical consumer web/mobile traffic, fraction of the daily peak per local hour 00:00–23:00. */
export const DIURNAL_CURVE: readonly number[] = Object.freeze([
  0.55, 0.42, 0.33, 0.28, 0.26, 0.28, 0.35, 0.48, 0.62, 0.74, 0.82, 0.87, 0.9, 0.9, 0.88, 0.87,
  0.88, 0.9, 0.93, 0.97, 1, 0.98, 0.88, 0.72,
]);

const mod24 = (h: number) => ((h % 24) + 24) % 24;

/** f(h): the curve linearly interpolated at a (fractional) local hour. */
export function diurnalFactor(localHour: number): number {
  const h = mod24(localHour);
  const i = Math.floor(h);
  const a = DIURNAL_CURVE[i] ?? 1;
  const b = DIURNAL_CURVE[(i + 1) % 24] ?? 1;
  return a + (b - a) * (h - i);
}

/** Mean of the curve over a day (for average-load costs). */
export const DIURNAL_MEAN = DIURNAL_CURVE.reduce((s, x) => s + x, 0) / DIURNAL_CURVE.length;

export function clock(hour: number): string {
  const h = mod24(hour);
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export interface DiurnalRegion {
  id: string;
  users: number;
  /** `undefined` = unknown time zone ⇒ always at peak. */
  utcOffsetHours: number | undefined;
}

export interface DiurnalPeak {
  /** UTC hour of the busiest moment (0 when the cycle is off). */
  utcHour: number;
  /** Per region id: multiplier on its users at that moment. */
  factors: Map<string, number>;
  /** Per region id: how the factor was found. */
  explain: Map<string, string>;
}

export const DIURNAL_STEP_HOURS = 0.25;

export function diurnalPeak(regions: readonly DiurnalRegion[], enabled: boolean): DiurnalPeak {
  const factors = new Map<string, number>();
  const explain = new Map<string, string>();
  if (!enabled) {
    for (const r of regions) {
      factors.set(r.id, 1);
      explain.set(r.id, 'daily cycle off: every region at its peak at once');
    }
    return { utcHour: 0, factors, explain };
  }
  const at = (r: DiurnalRegion, utc: number) =>
    r.utcOffsetHours === undefined ? 1 : diurnalFactor(utc + r.utcOffsetHours);
  let best = 0;
  let bestLoad = -1;
  for (let t = 0; t < 24; t += DIURNAL_STEP_HOURS) {
    const load = regions.reduce((s, r) => s + r.users * at(r, t), 0);
    if (load > bestLoad + 1e-9) {
      bestLoad = load;
      best = t;
    }
  }
  for (const r of regions) {
    const f = at(r, best);
    factors.set(r.id, f);
    explain.set(
      r.id,
      r.utcOffsetHours === undefined
        ? 'unknown time zone: at peak'
        : `busiest moment ${clock(best)} UTC = ${clock(best + r.utcOffsetHours)} local ⇒ f = ${fmt(f)}`,
    );
  }
  return { utcHour: best, factors, explain };
}
