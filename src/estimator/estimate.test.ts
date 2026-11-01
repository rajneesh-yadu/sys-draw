/** S20: back-of-envelope math — expected values computed by hand. */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ESTIMATOR_INPUTS,
  estimate,
  formatBandwidth,
  formatCount,
  parseEstimatorInputs,
  type EstimatorInputs,
} from './index';

const base: EstimatorInputs = DEFAULT_ESTIMATOR_INPUTS;
const line = (e: ReturnType<typeof estimate>, id: string) => {
  const l = e.lines.find((x) => x.id === id);
  if (!l) throw new Error(`no line ${id}`);
  return l;
};

describe('estimate', () => {
  it('F12: DAU 100M × 10 requests/day → ≈ 11.6k avg QPS', () => {
    const e = estimate({ ...base, dau: 100_000_000, actionsPerUserPerDay: 10 });
    // 1e9 / 86 400 = 11 574.07…
    expect(e.qps.avg).toBeCloseTo(11_574.074, 2);
    expect(line(e, 'qpsAvg').display).toBe('11.6k rps');
    expect(line(e, 'qpsAvg').substituted).toBe('1B ÷ 86 400 = 11.6k rps');
  });

  it('splits reads and writes by the ratio and applies the peak factor', () => {
    const e = estimate(base); // 10:1, peak 2
    expect(e.readFraction).toBeCloseTo(10 / 11, 10);
    expect(e.qps.readAvg).toBeCloseTo(10_521.886, 2);
    expect(e.qps.writeAvg).toBeCloseTo(1_052.189, 2);
    expect(e.qps.peak).toBeCloseTo(23_148.148, 2);
    expect(e.qps.writePeak).toBeCloseTo(2_104.377, 2);
    expect(e.readsPerDay + e.writesPerDay).toBeCloseTo(1e9, 0);
  });

  it('storage: writes/day × size, × 365 × replication, × retention', () => {
    const e = estimate(base); // 1e9/11 writes/day × 10 KB
    expect(e.storage.perDayBytes).toBeCloseTo(909.0909e9, -6);
    expect(e.storage.perYearBytes).toBeCloseTo(909.0909e9 * 365 * 3, -9);
    expect(e.storage.retainedBytes).toBeCloseTo(909.0909e9 * 365 * 3 * 5, -10);
    expect(line(e, 'storagePerDay').display).toBe('909.09 GB');
    expect(line(e, 'storagePerYear').display).toBe('995.45 TB');
    expect(line(e, 'storagePerYear').substituted).toBe('909.09 GB × 365 × 3 = 995.45 TB');
  });

  it('bandwidth: write QPS × size in, read QPS × size out (avg and peak)', () => {
    const e = estimate(base);
    expect(e.bandwidth.inAvg).toBeCloseTo(1_052.189 * 10_000, -1);
    expect(e.bandwidth.outAvg).toBeCloseTo(10_521.886 * 10_000, -1);
    expect(e.bandwidth.outPeak).toBeCloseTo(2 * e.bandwidth.outAvg, 3);
    expect(line(e, 'bandwidthIn').display).toBe('10.52 MB/s (84 Mbps)');
  });

  it('cache: hot fraction × reads/day × size', () => {
    const e = estimate(base); // 0.2 × 1e10/11 × 10 KB
    expect(e.cacheBytes).toBeCloseTo((0.2 * 1e10 * 10_000) / 11, -3);
    expect(line(e, 'cache').display).toBe('1.82 TB');
    expect(line(e, 'cache').formula).toBe('cache = hot fraction × reads/day × object size');
  });

  it('read-only ratio puts all traffic on reads and stores nothing', () => {
    const e = estimate({ ...base, readRatio: 1, writeRatio: 0 });
    expect(e.qps.readAvg).toBeCloseTo(e.qps.avg, 10);
    expect(e.qps.writeAvg).toBe(0);
    expect(e.storage.retainedBytes).toBe(0);
  });

  it('every line has a formula, a substituted formula and a display value', () => {
    for (const l of estimate(base).lines) {
      expect(l.formula).toContain('=');
      expect(l.substituted.endsWith(`= ${l.display}`)).toBe(true);
    }
  });
});

describe('parseEstimatorInputs', () => {
  it('accepts the defaults', () => {
    expect(parseEstimatorInputs(base).ok).toBe(true);
  });
  it('rejects a 0:0 ratio, peak < 1, fractional replication and hot > 100%', () => {
    const bad = (patch: Partial<EstimatorInputs>) => {
      const r = parseEstimatorInputs({ ...base, ...patch });
      return r.ok ? [] : r.errors;
    };
    expect(bad({ readRatio: 0, writeRatio: 0 })[0]).toMatch(/^writeRatio: .*both be 0/);
    expect(bad({ peakFactor: 0.5 })[0]).toMatch(/^peakFactor: Must be ≥ 1/);
    expect(bad({ replicationFactor: 2.5 })[0]).toMatch(/^replicationFactor:/);
    expect(bad({ hotDataFraction: 1.5 })[0]).toMatch(/^hotDataFraction:/);
    expect(bad({ dau: -1 })[0]).toMatch(/^dau:/);
  });
});

describe('formatting', () => {
  it('formatCount', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(950)).toBe('950');
    expect(formatCount(11_574)).toBe('11.6k');
    expect(formatCount(1e8)).toBe('100M');
    expect(formatCount(3.2e9)).toBe('3.2B');
    expect(formatCount(0.5)).toBe('0.5');
    expect(formatCount(0.000_115_74)).toBe('0.00012');
  });
  it('formatBandwidth shows bytes/s and bits/s', () => {
    expect(formatBandwidth(125_000_000)).toBe('125 MB/s (1 Gbps)');
    expect(formatBandwidth(1_000)).toBe('1 KB/s (8 kbps)');
  });
});
