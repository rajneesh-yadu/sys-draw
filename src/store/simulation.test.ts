import { describe, expect, it } from 'vitest';
import type { SimResult } from '@/core';
import {
  createSimulationStore,
  formatMs,
  formatPercent,
  formatRps,
  formatUsd,
  utilizationLevel,
} from './simulation';

const result = (rps: number): SimResult => ({
  perNode: {},
  perEdge: {},
  perFlow: {},
  system: { rps, availability: 1, costPerMonth: 0, bottlenecks: [] },
  findings: [],
});

describe('simulation store', () => {
  it('starts idle and stores a finished run', () => {
    const s = createSimulationStore();
    expect(s.getState().status).toBe('idle');
    const id = s.getState().start();
    expect(s.getState().status).toBe('running');
    expect(s.getState().finish(id, 'board_a', result(5), 12)).toBe(true);
    expect(s.getState()).toMatchObject({
      status: 'done',
      boardId: 'board_a',
      durationMs: 12,
      error: null,
    });
    expect(s.getState().result?.system.rps).toBe(5);
  });

  it('drops results and errors from superseded runs', () => {
    const s = createSimulationStore();
    const first = s.getState().start();
    const second = s.getState().start();
    expect(s.getState().finish(first, 'board_a', result(1))).toBe(false);
    expect(s.getState().fail(first, 'old')).toBe(false);
    expect(s.getState().status).toBe('running');
    expect(s.getState().finish(second, 'board_a', result(2))).toBe(true);
    expect(s.getState().result?.system.rps).toBe(2);
  });

  it('keeps the previous result while a new run is in flight', () => {
    const s = createSimulationStore();
    s.getState().finish(s.getState().start(), 'board_a', result(1));
    s.getState().start();
    expect(s.getState().result?.system.rps).toBe(1);
  });

  it('records failures and clears', () => {
    const s = createSimulationStore();
    const id = s.getState().start();
    expect(s.getState().fail(id, 'boom')).toBe(true);
    expect(s.getState()).toMatchObject({ status: 'error', error: 'boom' });
    s.getState().finish(s.getState().start(), 'board_a', result(1));
    const pending = s.getState().start();
    s.getState().clear();
    expect(s.getState()).toMatchObject({ status: 'idle', result: null, boardId: null });
    expect(s.getState().finish(pending, 'board_a', result(3))).toBe(false);
  });

  it('counts run requests and sequences focus requests', () => {
    const s = createSimulationStore();
    s.getState().requestRun();
    s.getState().requestRun();
    expect(s.getState().runRequests).toBe(2);
    s.getState().requestFocus('node_a');
    s.getState().requestFocus('node_a');
    expect(s.getState().focus).toEqual({ nodeId: 'node_a', seq: 2 });
  });
});

describe('utilizationLevel', () => {
  it('uses green < 60 %, amber < 85 %, red otherwise', () => {
    expect(utilizationLevel(0)).toBe('ok');
    expect(utilizationLevel(0.5999)).toBe('ok');
    expect(utilizationLevel(0.6)).toBe('warn');
    expect(utilizationLevel(0.8499)).toBe('warn');
    expect(utilizationLevel(0.85)).toBe('hot');
    expect(utilizationLevel(2.4)).toBe('hot');
    expect(utilizationLevel(Number.NaN)).toBe('hot');
  });
});

describe('formatters', () => {
  it('formats rps', () => {
    expect(formatRps(0)).toBe('0 rps');
    expect(formatRps(0.25)).toBe('0.25 rps');
    expect(formatRps(42.5)).toBe('42.5 rps');
    expect(formatRps(150.4)).toBe('150 rps');
    expect(formatRps(9999)).toBe('9999 rps');
    expect(formatRps(12_345)).toBe('12.3k rps');
    expect(formatRps(2_000_000)).toBe('2M rps');
  });

  it('formats milliseconds', () => {
    expect(formatMs(0)).toBe('0 ms');
    expect(formatMs(0.456)).toBe('0.46 ms');
    expect(formatMs(13.86)).toBe('13.9 ms');
    expect(formatMs(231.5)).toBe('232 ms');
    expect(formatMs(1500)).toBe('1.5 s');
  });

  it('formats percentages, keeping the nines', () => {
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(1)).toBe('100%');
    expect(formatPercent(0.634)).toBe('63%');
    expect(formatPercent(0.0425)).toBe('4.3%');
    expect(formatPercent(0.0042)).toBe('0.42%');
    expect(formatPercent(1.6)).toBe('160%');
    expect(formatPercent(0.999)).toBe('99.9%');
    expect(formatPercent(0.99995)).toBe('99.995%');
  });

  it('formats dollars', () => {
    expect(formatUsd(0)).toBe('$0');
    expect(formatUsd(1234.4)).toBe('$1,234');
    expect(formatUsd(1_250_000)).toBe('$1.3M');
  });
});

describe('timeline playback (S11)', () => {
  const point = (tSec: number) => ({
    tSec,
    rps: 1,
    p50Ms: 1,
    p99Ms: 2,
    errorRate: 0,
    availability: 1,
  });
  const withTimeline = (n: number): SimResult => ({
    ...result(1),
    timeline: Array.from({ length: n }, (_, i) => point(i)),
  });
  const ready = (n: number) => {
    const s = createSimulationStore();
    s.getState().finish(s.getState().start(), 'board_a', withTimeline(n));
    return s;
  };

  it('starts in steady-state view and clamps scrubbing to the timeline', async () => {
    const { playbackPoint } = await import('./simulation');
    const s = ready(10);
    expect(s.getState().playback).toEqual({ tick: null, playing: false });
    s.getState().setTick(42);
    expect(s.getState().playback.tick).toBe(9);
    expect(playbackPoint(s.getState().result, s.getState().playback)?.tSec).toBe(9);
    s.getState().setTick(-3);
    expect(s.getState().playback.tick).toBe(0);
    s.getState().setTick(null);
    expect(playbackPoint(s.getState().result, s.getState().playback)).toBeUndefined();
  });

  it('plays tick by tick and stops at the end; play at the end restarts', () => {
    const s = ready(3);
    s.getState().play();
    expect(s.getState().playback).toEqual({ tick: 0, playing: true });
    s.getState().advance();
    s.getState().advance();
    expect(s.getState().playback).toEqual({ tick: 2, playing: false });
    s.getState().advance();
    expect(s.getState().playback.tick).toBe(2);
    s.getState().play();
    expect(s.getState().playback.tick).toBe(0);
    s.getState().pause();
    expect(s.getState().playback.playing).toBe(false);
  });

  it('keeps the tick across re-runs (clamped) and resets without a timeline or on clear', () => {
    const s = ready(10);
    s.getState().setTick(8);
    s.getState().finish(s.getState().start(), 'board_a', withTimeline(5));
    expect(s.getState().playback.tick).toBe(4);
    s.getState().finish(s.getState().start(), 'board_a', result(1));
    expect(s.getState().playback.tick).toBeNull();
    s.getState().finish(s.getState().start(), 'board_a', withTimeline(5));
    s.getState().setTick(2);
    s.getState().clear();
    expect(s.getState().playback.tick).toBeNull();
  });

  it('does nothing without a timeline', () => {
    const s = createSimulationStore();
    s.getState().play();
    s.getState().setTick(3);
    expect(s.getState().playback).toEqual({ tick: null, playing: false });
  });
});
