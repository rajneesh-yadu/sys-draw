/** The calculator's form state: strings while typing, parsed and validated into EstimatorInputs. */
import { BYTES_PER_KB, BYTES_PER_MB } from '@/core';
import {
  DEFAULT_ESTIMATOR_INPUTS,
  parseEstimatorInputs,
  type EstimatorInputKey,
  type EstimatorInputs,
} from './estimate';

// ---------- Draft (strings while typing) ----------

export const SIZE_UNITS = [
  { id: 'B', bytes: 1 },
  { id: 'KB', bytes: BYTES_PER_KB },
  { id: 'MB', bytes: BYTES_PER_MB },
] as const;
export type SizeUnit = (typeof SIZE_UNITS)[number]['id'];

export interface EstimatorDraft {
  dau: string;
  actionsPerUserPerDay: string;
  readRatio: string;
  writeRatio: string;
  objectSize: string;
  objectSizeUnit: SizeUnit;
  retentionYears: string;
  peakFactor: string;
  replicationFactor: string;
  hotDataPercent: string;
}

const SUFFIX: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 };

/** "100M" → 1e8, "1.5k" → 1500, "2,000" → 2000; anything else → NaN. */
export function parseNumber(text: string): number {
  const m = /^\s*([0-9][0-9_,]*(?:\.[0-9]+)?|\.[0-9]+)\s*([kmbt])?\s*$/i.exec(text);
  if (!m?.[1]) return Number.NaN;
  const base = Number(m[1].replace(/[_,]/g, ''));
  return base * (m[2] ? (SUFFIX[m[2].toLowerCase()] ?? 1) : 1);
}

function shortNumber(n: number): string {
  for (const [s, v] of [
    ['T', 1e12],
    ['B', 1e9],
    ['M', 1e6],
  ] as const) {
    if (n >= v && Number.isInteger(n / v)) return `${n / v}${s}`;
  }
  return String(n);
}

export function draftFromInputs(i: EstimatorInputs): EstimatorDraft {
  const unit =
    [...SIZE_UNITS]
      .reverse()
      .find((u) => i.objectSizeBytes >= u.bytes && i.objectSizeBytes % u.bytes === 0) ??
    SIZE_UNITS[0];
  return {
    dau: shortNumber(i.dau),
    actionsPerUserPerDay: String(i.actionsPerUserPerDay),
    readRatio: String(i.readRatio),
    writeRatio: String(i.writeRatio),
    objectSize: String(i.objectSizeBytes / unit.bytes),
    objectSizeUnit: unit.id,
    retentionYears: String(i.retentionYears),
    peakFactor: String(i.peakFactor),
    replicationFactor: String(i.replicationFactor),
    hotDataPercent: String(Number((i.hotDataFraction * 100).toFixed(4))),
  };
}

export type DraftResult =
  | { ok: true; inputs: EstimatorInputs }
  | { ok: false; errors: Partial<Record<EstimatorInputKey, string>> };

export function inputsFromDraft(d: EstimatorDraft): DraftResult {
  const unitBytes = SIZE_UNITS.find((u) => u.id === d.objectSizeUnit)?.bytes ?? 1;
  const raw: Record<EstimatorInputKey, number> = {
    dau: parseNumber(d.dau),
    actionsPerUserPerDay: parseNumber(d.actionsPerUserPerDay),
    readRatio: parseNumber(d.readRatio),
    writeRatio: parseNumber(d.writeRatio),
    objectSizeBytes: parseNumber(d.objectSize) * unitBytes,
    retentionYears: parseNumber(d.retentionYears),
    peakFactor: parseNumber(d.peakFactor),
    replicationFactor: parseNumber(d.replicationFactor),
    hotDataFraction: parseNumber(d.hotDataPercent) / 100,
  };
  const errors: Partial<Record<EstimatorInputKey, string>> = {};
  for (const [k, v] of Object.entries(raw) as [EstimatorInputKey, number][]) {
    if (Number.isNaN(v)) errors[k] = 'Enter a number (suffixes k, M, B allowed)';
  }
  // Validate the rest too (unparsable fields stand in with defaults) so every error shows at once.
  const filled = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [
      k,
      Number.isNaN(v) ? DEFAULT_ESTIMATOR_INPUTS[k as EstimatorInputKey] : v,
    ]),
  );
  const res = parseEstimatorInputs(filled);
  if (res.ok && Object.keys(errors).length === 0) return { ok: true, inputs: res.value };
  for (const msg of res.ok ? [] : res.errors) {
    // Readable errors look like "field: message".
    const [path, ...rest] = msg.split(': ');
    const key = (path ?? '') as EstimatorInputKey;
    if (key in raw) errors[key] ??= rest.join(': ') || msg;
    else errors.dau ??= msg;
  }
  return { ok: false, errors };
}
