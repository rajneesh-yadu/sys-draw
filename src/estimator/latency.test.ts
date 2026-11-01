/** S20: latency card data and formatting. */
import { describe, expect, it } from 'vitest';
import { LATENCY_NUMBERS, formatNs, humanScale, latencyBarPercent } from './index';

describe('latency numbers', () => {
  it('are sorted fastest first with unique ids', () => {
    const ns = LATENCY_NUMBERS.map((l) => l.ns);
    expect([...ns].sort((a, b) => a - b)).toEqual(ns);
    expect(new Set(LATENCY_NUMBERS.map((l) => l.id)).size).toBe(LATENCY_NUMBERS.length);
  });
  it('formatNs picks the unit', () => {
    expect(formatNs(0.5)).toBe('0.5 ns');
    expect(formatNs(150_000)).toBe('150 µs');
    expect(formatNs(150_000_000)).toBe('150 ms');
    expect(formatNs(2e9)).toBe('2 s');
  });
  it('humanScale: L1 = 1 s', () => {
    expect(humanScale(0.5)).toBe('1 s');
    expect(humanScale(100)).toBe('3.3 min'); // 200 s
    expect(humanScale(500_000)).toBe('12 days'); // 1e6 s
    expect(humanScale(150_000_000)).toBe('9.5 years'); // 3e8 s
  });
  it('bars are log-scaled from 2% to 100%', () => {
    expect(latencyBarPercent(0.5)).toBe(2);
    expect(latencyBarPercent(150_000_000)).toBe(100);
    expect(latencyBarPercent(100)).toBeGreaterThan(20);
  });
});
