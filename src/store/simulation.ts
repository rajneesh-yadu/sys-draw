/**
 * Simulation results for the open board (S08). The store never runs the engine: the app's
 * runner calls `start` → engine → `finish`/`fail`; UI modules (canvas overlays, metrics-ui)
 * read `result` and ask for a run (`requestRun`) or a node focus (`requestFocus`).
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { SimResult, TimePoint } from '@/core';

export type SimulationStatus = 'idle' | 'running' | 'done' | 'error';

export interface FocusRequest {
  nodeId: string;
  /** Increments on every request, so focusing the same node twice still fires. */
  seq: number;
}

/**
 * Failures-over-time playback (S11): which tick of `result.timeline` the canvas shows.
 * `tick` null = the steady-state (analytical) numbers.
 */
export interface Playback {
  tick: number | null;
  playing: boolean;
}

export interface SimulationState {
  status: SimulationStatus;
  /** Latest finished result (kept while a newer run is in flight, so overlays don't flicker). */
  result: SimResult | null;
  /** Board the result was computed for. */
  boardId: string | null;
  /** Wall-clock duration of the last successful run, ms. */
  durationMs: number | null;
  error: string | null;
  /** Id of the newest run started; results of older runs are dropped. */
  runId: number;
  /** Bumped by `requestRun` (the "Run" button); the runner listens to it. */
  runRequests: number;
  focus: FocusRequest | null;
  playback: Playback;

  /** Mark a new run as started; returns its id for `finish`/`fail`. */
  start(): number;
  /** Store a result; ignored (returns false) if a newer run has started since. */
  finish(runId: number, boardId: string, result: SimResult, durationMs?: number): boolean;
  /** Record a failure; ignored (returns false) if a newer run has started since. */
  fail(runId: number, message: string): boolean;
  /** Drop the result (e.g. when another board opens). Running runs are superseded. */
  clear(): void;
  requestRun(): void;
  requestFocus(nodeId: string): void;
  /** Show tick `i` of the timeline on the canvas (clamped), or null for steady state. Pauses. */
  setTick(i: number | null): void;
  /** Play the timeline from the current tick (from 0 at the end); `advance` moves one tick. */
  play(): void;
  pause(): void;
  /** Next tick while playing; stops at the last one. */
  advance(): void;
}

const NO_PLAYBACK: Playback = Object.freeze({ tick: null, playing: false }) as Playback;

/** The time point the canvas should show, or undefined in steady-state view. */
export function playbackPoint(result: SimResult | null, playback: Playback): TimePoint | undefined {
  if (playback.tick === null || !result?.timeline) return undefined;
  return result.timeline[playback.tick];
}

function clampTick(i: number, result: SimResult | null): number | null {
  const n = result?.timeline?.length ?? 0;
  if (n === 0) return null;
  return Math.min(n - 1, Math.max(0, Math.round(i)));
}

export type SimulationStore = StoreApi<SimulationState>;

export function createSimulationStore(): SimulationStore {
  return createStore<SimulationState>()((set, get) => ({
    status: 'idle',
    result: null,
    boardId: null,
    durationMs: null,
    error: null,
    runId: 0,
    runRequests: 0,
    focus: null,
    playback: NO_PLAYBACK,

    start() {
      const runId = get().runId + 1;
      set({ runId, status: 'running', error: null });
      return runId;
    },
    finish(runId, boardId, result, durationMs) {
      if (runId !== get().runId) return false;
      const p = get().playback;
      const tick = p.tick === null ? null : clampTick(p.tick, result);
      set({
        status: 'done',
        result,
        boardId,
        durationMs: durationMs ?? null,
        error: null,
        playback: tick === null ? NO_PLAYBACK : { tick, playing: p.playing },
      });
      return true;
    },
    fail(runId, message) {
      if (runId !== get().runId) return false;
      set({ status: 'error', error: message });
      return true;
    },
    clear() {
      set((s) => ({
        runId: s.runId + 1,
        status: 'idle',
        result: null,
        boardId: null,
        durationMs: null,
        error: null,
        playback: NO_PLAYBACK,
      }));
    },
    requestRun() {
      set((s) => ({ runRequests: s.runRequests + 1 }));
    },
    requestFocus(nodeId) {
      set((s) => ({ focus: { nodeId, seq: (s.focus?.seq ?? 0) + 1 } }));
    },
    setTick(i) {
      const tick = i === null ? null : clampTick(i, get().result);
      set({ playback: tick === null ? NO_PLAYBACK : { tick, playing: false } });
    },
    play() {
      const { result, playback } = get();
      const n = result?.timeline?.length ?? 0;
      if (n === 0) return;
      const tick = playback.tick === null || playback.tick >= n - 1 ? 0 : playback.tick;
      set({ playback: { tick, playing: true } });
    },
    pause() {
      const p = get().playback;
      if (p.playing) set({ playback: { ...p, playing: false } });
    },
    advance() {
      const { result, playback } = get();
      const n = result?.timeline?.length ?? 0;
      if (!playback.playing || playback.tick === null || n === 0) return;
      const tick = Math.min(n - 1, playback.tick + 1);
      set({ playback: { tick, playing: tick < n - 1 } });
    },
  }));
}

/** Utilisation bands shared by canvas overlays and metrics panels: green < 60 %, amber < 85 %, red. */
export const UTILIZATION_THRESHOLDS = { warn: 0.6, hot: 0.85 } as const;

export type UtilizationLevel = 'ok' | 'warn' | 'hot';

export function utilizationLevel(u: number): UtilizationLevel {
  if (!(u < UTILIZATION_THRESHOLDS.hot)) return 'hot'; // NaN/∞ count as hot
  return u < UTILIZATION_THRESHOLDS.warn ? 'ok' : 'warn';
}

export const UTILIZATION_LEVEL_LABEL: Record<UtilizationLevel, string> = {
  ok: 'Healthy',
  warn: 'Busy',
  hot: 'Overloaded',
};

// ── Display formatting shared by the UI modules (deterministic, compact). ──

function compact(n: number, digits: number): string {
  if (!Number.isFinite(n)) return n > 0 ? '∞' : '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${trim((n / 1e9).toFixed(1))}B`;
  if (abs >= 1e6) return `${trim((n / 1e6).toFixed(1))}M`;
  if (abs >= 1e4) return `${trim((n / 1e3).toFixed(1))}k`;
  if (abs >= 100 || Number.isInteger(n)) return String(Math.round(n));
  return trim(n.toFixed(digits));
}

function trim(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** 12 345 → "12.3k rps"; 0.25 → "0.25 rps". */
export function formatRps(rps: number): string {
  return `${compact(rps, 2)} rps`;
}

/** Milliseconds: < 1 ms with two decimals, ≥ 1 s in seconds. */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return ms > 0 ? '∞ ms' : '—';
  if (ms >= 1000) return `${trim((ms / 1000).toFixed(2))} s`;
  if (ms >= 100) return `${Math.round(ms)} ms`;
  if (ms >= 1) return `${trim(ms.toFixed(1))} ms`;
  return `${trim(ms.toFixed(2))} ms`;
}

/** Ratio → percent: 0.634 → "63%", 0.0042 → "0.42%", 0.99995 → "99.995%". */
export function formatPercent(ratio: number): string {
  if (!Number.isFinite(ratio)) return ratio > 0 ? '∞%' : '—';
  const p = ratio * 100;
  if (p === 0 || p === 100) return `${p}%`;
  if (p > 99 && p < 100) {
    // Availability-style numbers: keep the nines.
    const digits = Math.min(4, Math.max(1, Math.ceil(-Math.log10(100 - p)) + 1));
    return `${trim(p.toFixed(digits))}%`;
  }
  if (Math.abs(p) >= 10) return `${Math.round(p)}%`;
  if (Math.abs(p) >= 1) return `${trim(p.toFixed(1))}%`;
  return `${trim(p.toFixed(2))}%`;
}

/** USD per month: "$0", "$1,234", "$1.2M". */
export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd)) return '—';
  if (Math.abs(usd) >= 1e6) return `$${trim((usd / 1e6).toFixed(1))}M`;
  return `$${Math.round(usd).toLocaleString('en-US')}`;
}
