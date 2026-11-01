/**
 * Back-of-envelope capacity math (F12). Pure functions over plain numbers: every result line
 * carries its symbolic formula and the same formula with the inputs substituted, so the UI can
 * show how each number was reached (ARCHITECTURE.md principle 3).
 *
 *   requests/day = DAU × actions/user/day
 *   QPS_avg      = requests/day ÷ 86 400 s            (reads and writes split by read:write)
 *   QPS_peak     = QPS_avg × peak factor
 *   storage/day  = writes/day × object size           (one copy)
 *   storage/yr   = storage/day × 365 × replication
 *   retained     = storage/yr × retention years
 *   ingress      = write QPS × object size            (bytes/s; peak uses peak QPS)
 *   egress       = read QPS × object size
 *   cache        = hot fraction × reads/day × object size   (the 80/20 rule)
 */
import { z } from 'zod';
import {
  BYTES_PER_KB,
  NonNegativeNumberSchema,
  PositiveIntSchema,
  PositiveNumberSchema,
  RatioSchema,
  SECONDS_PER_DAY,
  bytesPerSecToMbps,
  formatBytes,
  formatRps,
  safeParseReadable,
  type ParseResult,
} from '@/core';

export const DAYS_PER_YEAR = 365;

export const EstimatorInputsSchema = z
  .object({
    /** Daily active users. */
    dau: NonNegativeNumberSchema,
    /** Requests (reads + writes) each active user makes per day. */
    actionsPerUserPerDay: NonNegativeNumberSchema,
    /** Read part of the read:write ratio, e.g. 10 in 10:1. */
    readRatio: NonNegativeNumberSchema,
    /** Write part of the read:write ratio, e.g. 1 in 10:1. */
    writeRatio: NonNegativeNumberSchema,
    /** Average size of one object written or read. */
    objectSizeBytes: NonNegativeNumberSchema,
    /** How long written data is kept. */
    retentionYears: PositiveNumberSchema,
    /** Busiest-hour traffic ÷ average traffic. */
    peakFactor: z.number().finite().min(1, 'Must be ≥ 1'),
    /** Copies of each object kept by the data store. */
    replicationFactor: PositiveIntSchema,
    /** Share of the daily read volume worth caching (0.2 = the 80/20 rule). */
    hotDataFraction: RatioSchema,
  })
  .refine((v) => v.readRatio + v.writeRatio > 0, {
    message: 'Read and write parts cannot both be 0',
    path: ['writeRatio'],
  });
export type EstimatorInputs = z.infer<typeof EstimatorInputsSchema>;
export type EstimatorInputKey = keyof EstimatorInputs;

/** A read-heavy social-app starting point; F12's check uses DAU 100M × 10 requests/day. */
export const DEFAULT_ESTIMATOR_INPUTS: EstimatorInputs = {
  dau: 100_000_000,
  actionsPerUserPerDay: 10,
  readRatio: 10,
  writeRatio: 1,
  objectSizeBytes: 10 * BYTES_PER_KB,
  retentionYears: 5,
  peakFactor: 2,
  replicationFactor: 3,
  hotDataFraction: 0.2,
};

export function parseEstimatorInputs(raw: unknown): ParseResult<EstimatorInputs> {
  return safeParseReadable(EstimatorInputsSchema, raw);
}

export type EstimateSection = 'traffic' | 'storage' | 'bandwidth' | 'cache';
export type EstimateUnit = 'rps' | 'perDay' | 'bytes' | 'bytesPerSec';

export const ESTIMATE_SECTION_LABEL: Record<EstimateSection, string> = {
  traffic: 'Traffic',
  storage: 'Storage',
  bandwidth: 'Bandwidth',
  cache: 'Cache',
};

export interface EstimateLine {
  id: string;
  section: EstimateSection;
  label: string;
  value: number;
  unit: EstimateUnit;
  /** Formatted value, e.g. "11.6k rps". */
  display: string;
  /** Symbolic formula, e.g. "QPS_avg = DAU × actions/user/day ÷ 86 400 s". */
  formula: string;
  /** The formula with the inputs filled in and the result, e.g. "100M × 10 ÷ 86 400 = 11.6k rps". */
  substituted: string;
  /** Optional caveat shown under the formula. */
  note?: string;
}

export interface Estimate {
  inputs: EstimatorInputs;
  readFraction: number;
  writeFraction: number;
  requestsPerDay: number;
  readsPerDay: number;
  writesPerDay: number;
  qps: {
    avg: number;
    peak: number;
    readAvg: number;
    writeAvg: number;
    readPeak: number;
    writePeak: number;
  };
  storage: {
    /** New data per day, one copy. */
    perDayBytes: number;
    /** New data per year including replicas. */
    perYearBytes: number;
    /** Data kept over the retention period including replicas. */
    retainedBytes: number;
  };
  /** Bytes per second. */
  bandwidth: { inAvg: number; outAvg: number; inPeak: number; outPeak: number };
  cacheBytes: number;
  lines: EstimateLine[];
}

// ---------- Formatting ----------

function trim(n: number, digits: number): string {
  return Number(n.toFixed(digits)).toString();
}

/** 950 → "950", 11 574 → "11.6k", 1e8 → "100M", 3.2e9 → "3.2B". */
export function formatCount(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${trim(n / 1e12, 1)}T`;
  if (abs >= 1e9) return `${trim(n / 1e9, 1)}B`;
  if (abs >= 1e6) return `${trim(n / 1e6, 1)}M`;
  if (abs >= 1e3) return `${trim(n / 1e3, 1)}k`;
  if (abs === 0 || abs >= 10) return trim(n, 0);
  if (abs >= 0.01) return trim(n, 2);
  return n.toPrecision(2);
}

/** 1.25e6 bytes/s → "1.25 MB/s (10 Mbps)". */
export function formatBandwidth(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s (${formatMbps(bytesPerSecToMbps(bytesPerSec))})`;
}

function formatMbps(mbps: number): string {
  if (mbps >= 1_000_000) return `${trim(mbps / 1_000_000, 2)} Tbps`;
  if (mbps >= 1_000) return `${trim(mbps / 1_000, 2)} Gbps`;
  if (mbps >= 1) return `${trim(mbps, mbps < 10 ? 2 : 0)} Mbps`;
  return `${trim(mbps * 1_000, 1)} kbps`;
}

function formatValue(value: number, unit: EstimateUnit): string {
  switch (unit) {
    case 'rps':
      return formatRps(value);
    case 'perDay':
      return `${formatCount(value)}/day`;
    case 'bytes':
      return formatBytes(value);
    case 'bytesPerSec':
      return formatBandwidth(value);
  }
}

const n = formatCount;
const SEC_PER_DAY_LABEL = '86 400';

// ---------- Math ----------

/** Compute every estimate line from validated inputs. */
export function estimate(inputs: EstimatorInputs): Estimate {
  const i = inputs;
  const parts = i.readRatio + i.writeRatio;
  const readFraction = i.readRatio / parts;
  const writeFraction = i.writeRatio / parts;

  const requestsPerDay = i.dau * i.actionsPerUserPerDay;
  const readsPerDay = requestsPerDay * readFraction;
  const writesPerDay = requestsPerDay * writeFraction;

  const avg = requestsPerDay / SECONDS_PER_DAY;
  const readAvg = avg * readFraction;
  const writeAvg = avg * writeFraction;
  const peak = avg * i.peakFactor;
  const readPeak = readAvg * i.peakFactor;
  const writePeak = writeAvg * i.peakFactor;

  const perDayBytes = writesPerDay * i.objectSizeBytes;
  const perYearBytes = perDayBytes * DAYS_PER_YEAR * i.replicationFactor;
  const retainedBytes = perYearBytes * i.retentionYears;

  const inAvg = writeAvg * i.objectSizeBytes;
  const outAvg = readAvg * i.objectSizeBytes;
  const inPeak = writePeak * i.objectSizeBytes;
  const outPeak = readPeak * i.objectSizeBytes;

  const cacheBytes = i.hotDataFraction * readsPerDay * i.objectSizeBytes;

  const size = formatBytes(i.objectSizeBytes);
  const ratio = `${n(i.readRatio)}:${n(i.writeRatio)}`;
  const rf = trim(readFraction, 3);
  const wf = trim(writeFraction, 3);

  const line = (
    id: string,
    section: EstimateSection,
    label: string,
    value: number,
    unit: EstimateUnit,
    formula: string,
    filled: string,
    note?: string,
  ): EstimateLine => {
    const display = formatValue(value, unit);
    return {
      id,
      section,
      label,
      value,
      unit,
      display,
      formula,
      substituted: `${filled} = ${display}`,
      ...(note ? { note } : {}),
    };
  };

  const lines: EstimateLine[] = [
    line(
      'requestsPerDay',
      'traffic',
      'Requests per day',
      requestsPerDay,
      'perDay',
      'requests/day = DAU × actions/user/day',
      `${n(i.dau)} × ${n(i.actionsPerUserPerDay)}`,
    ),
    line(
      'qpsAvg',
      'traffic',
      'QPS (average)',
      avg,
      'rps',
      `QPS_avg = requests/day ÷ ${SEC_PER_DAY_LABEL} s`,
      `${n(requestsPerDay)} ÷ ${SEC_PER_DAY_LABEL}`,
      'Shortcut: 1M requests/day ≈ 12 rps (a day is ≈ 10⁵ s).',
    ),
    line(
      'qpsPeak',
      'traffic',
      'QPS (peak)',
      peak,
      'rps',
      'QPS_peak = QPS_avg × peak factor',
      `${formatRps(avg)} × ${n(i.peakFactor)}`,
    ),
    line(
      'readQps',
      'traffic',
      'Read QPS (avg / peak)',
      readAvg,
      'rps',
      'read QPS = QPS_avg × reads ÷ (reads + writes)',
      `${formatRps(avg)} × ${rf} (${ratio})`,
      `Peak: ${formatRps(readPeak)}.`,
    ),
    line(
      'writeQps',
      'traffic',
      'Write QPS (avg / peak)',
      writeAvg,
      'rps',
      'write QPS = QPS_avg × writes ÷ (reads + writes)',
      `${formatRps(avg)} × ${wf} (${ratio})`,
      `Peak: ${formatRps(writePeak)}.`,
    ),
    line(
      'storagePerDay',
      'storage',
      'New data per day (1 copy)',
      perDayBytes,
      'bytes',
      'storage/day = writes/day × object size',
      `${n(writesPerDay)} × ${size}`,
    ),
    line(
      'storagePerYear',
      'storage',
      'Storage per year (with replicas)',
      perYearBytes,
      'bytes',
      'storage/yr = storage/day × 365 × replication',
      `${formatBytes(perDayBytes)} × 365 × ${i.replicationFactor}`,
    ),
    line(
      'storageRetained',
      'storage',
      `Storage kept (${n(i.retentionYears)} yr retention)`,
      retainedBytes,
      'bytes',
      'retained = storage/yr × retention years',
      `${formatBytes(perYearBytes)} × ${n(i.retentionYears)}`,
      'Ignores indexes, metadata and compression; add ~20–30% headroom.',
    ),
    line(
      'bandwidthIn',
      'bandwidth',
      'Ingress (avg)',
      inAvg,
      'bytesPerSec',
      'ingress = write QPS × object size',
      `${formatRps(writeAvg)} × ${size}`,
      `Peak: ${formatBandwidth(inPeak)}. Replication traffic between copies is extra.`,
    ),
    line(
      'bandwidthOut',
      'bandwidth',
      'Egress (avg)',
      outAvg,
      'bytesPerSec',
      'egress = read QPS × object size',
      `${formatRps(readAvg)} × ${size}`,
      `Peak: ${formatBandwidth(outPeak)}.`,
    ),
    line(
      'cache',
      'cache',
      `Cache for hot data (${trim(i.hotDataFraction * 100, 1)}%)`,
      cacheBytes,
      'bytes',
      'cache = hot fraction × reads/day × object size',
      `${trim(i.hotDataFraction, 3)} × ${n(readsPerDay)} × ${size}`,
      '80/20 rule: a small share of objects serves most reads. Upper bound: repeat reads of one object share one cache entry.',
    ),
  ];

  return {
    inputs,
    readFraction,
    writeFraction,
    requestsPerDay,
    readsPerDay,
    writesPerDay,
    qps: { avg, peak, readAvg, writeAvg, readPeak, writePeak },
    storage: { perDayBytes, perYearBytes, retainedBytes },
    bandwidth: { inAvg, outAvg, inPeak, outPeak },
    cacheBytes,
    lines,
  };
}
