import { describe, expect, it } from 'vitest';
import {
  bytesPerSecToMbps,
  formatBytes,
  formatLatencyMs,
  formatPercent,
  formatRps,
  formatUsd,
  gbToBytes,
  perDayToRps,
  usdPerHourToUsdPerMonth,
} from './units';

describe('units', () => {
  it('converts rates: 100M DAU × 10/day ≈ 11.6k rps (F12 check)', () => {
    expect(perDayToRps(100_000_000 * 10)).toBeCloseTo(11_574.07, 2);
  });
  it('converts cost with 730 h/month', () => {
    expect(usdPerHourToUsdPerMonth(0.1)).toBeCloseTo(73, 10);
  });
  it('converts sizes and bandwidth', () => {
    expect(gbToBytes(2)).toBe(2e9);
    expect(bytesPerSecToMbps(125_000)).toBe(1);
  });
  it('formats', () => {
    expect(formatLatencyMs(0.42)).toBe('420 µs');
    expect(formatLatencyMs(3.456)).toBe('3.46 ms');
    expect(formatLatencyMs(123.45)).toBe('123.5 ms');
    expect(formatLatencyMs(1534)).toBe('1.53 s');
    expect(formatLatencyMs(Infinity)).toBe('∞');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1500)).toBe('1.5 KB');
    expect(formatBytes(2.5e9)).toBe('2.5 GB');
    expect(formatRps(950)).toBe('950 rps');
    expect(formatRps(11_574)).toBe('11.6k rps');
    expect(formatRps(2.4e6)).toBe('2.4M rps');
    expect(formatUsd(1234.5)).toBe('$1,234.50');
    expect(formatUsd(-3)).toBe('-$3.00');
    expect(formatPercent(0.1234)).toBe('12.3%');
  });
});
