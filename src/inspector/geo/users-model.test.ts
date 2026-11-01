import { describe, expect, it } from 'vitest';
import {
  compactCount,
  MARKER_BASE,
  MARKER_MIN,
  markerRadius,
  parseUsers,
  project,
  setUsers,
  userRows,
} from './users-model';

describe('users-per-region model', () => {
  it('projects lat/long like the land outline (equirectangular, 2 px per degree)', () => {
    expect(project(0, 0)).toEqual({ x: 360, y: 180 });
    expect(project(38.9, -77.4)).toEqual({ x: 205.2, y: 102.2 });
  });

  it('rows: every known region plus unknown ids, with shares', () => {
    const rows = userRows({ india: 300, europe: 100, 'old-id': 100 });
    expect(rows).toHaveLength(10);
    expect(rows.find((r) => r.id === 'india')?.share).toBeCloseTo(0.6, 12);
    expect(rows.find((r) => r.id === 'north-america')?.users).toBe(0);
    expect(rows.at(-1)).toMatchObject({ id: 'old-id', known: false });
  });

  it('setUsers is immutable and 0 removes the region', () => {
    const before = { india: 5 };
    expect(setUsers(before, 'europe', 7)).toEqual({ india: 5, europe: 7 });
    expect(setUsers(before, 'india', 0)).toEqual({});
    expect(before).toEqual({ india: 5 });
  });

  it('parses user counts', () => {
    expect(parseUsers('1,500')).toEqual({ ok: true, value: 1500 });
    expect(parseUsers('')).toEqual({ ok: true, value: 0 });
    expect(parseUsers('-1')).toEqual({ ok: false, error: 'Must be ≥ 0' });
    expect(parseUsers('abc').ok).toBe(false);
  });

  it('marker area ∝ share; compact counts', () => {
    expect(markerRadius(0)).toBe(MARKER_MIN);
    expect(markerRadius(1) - MARKER_BASE).toBeCloseTo(2 * (markerRadius(0.25) - MARKER_BASE), 12);
    expect(compactCount(1500)).toBe('1.5k');
    expect(compactCount(2_000_000)).toBe('2M');
    expect(compactCount(12)).toBe('12');
  });
});
