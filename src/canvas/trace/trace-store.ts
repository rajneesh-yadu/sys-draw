/**
 * Request-trace UI state (S15): what to trace (flow, user region, cold/warm, cache branch), the
 * trace the app computed, and the step-through position. The canvas only renders it: the app's
 * trace runner calls the engine and stores the result here (`start` → `finish` / `fail`).
 *
 * The view types mirror the engine's `RequestTrace` (canvas may not import the engine); the app
 * maps one onto the other, so TypeScript checks they stay in step.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';

export type TraceWarmth = boolean | 'resumed';

export interface TraceViewStep {
  index: number;
  kind: 'dns' | 'handshake' | 'request' | 'response' | 'queue' | 'service';
  category: string;
  layer: string;
  osiLayer?: number | undefined;
  from: string;
  to: string;
  edgeId?: string | undefined;
  direction?: 'forward' | 'back' | undefined;
  message: string;
  headers: readonly string[];
  startMs: number;
  timeMs: number;
  async: boolean;
  explain: string;
}

export interface TraceViewSegment {
  /** Category id ('dns', 'tcp', …): also picks the colour. */
  id: string;
  label: string;
  ms: number;
}

export interface TraceView {
  flowId: string;
  flowName: string;
  regionId?: string | undefined;
  regionName?: string | undefined;
  warm: TraceWarmth;
  cache: 'miss' | 'hit';
  participants: readonly { id: string; label: string; kind: 'node' | 'dns' }[];
  steps: readonly TraceViewStep[];
  totalMs: number;
  /** Where time goes, in a fixed category order (zeros included). */
  breakdown: readonly TraceViewSegment[];
  decisions: readonly { nodeId: string; text: string }[];
  notes: readonly string[];
  explain: string;
}

export interface TraceRequestSpec {
  /** Undefined = the board's first flow. */
  flowId?: string | undefined;
  /** Undefined = the user region with most users. */
  regionId?: string | undefined;
  warm: TraceWarmth;
  cache: 'miss' | 'hit';
}

export type TraceStatus = 'idle' | 'running' | 'done' | 'error';

export interface TraceState {
  open: boolean;
  request: TraceRequestSpec;
  status: TraceStatus;
  trace: TraceView | null;
  error: string | null;
  /** Current step index; −1 = before the first step. */
  step: number;
  playing: boolean;
  /** Id of the newest computation; older results are dropped. */
  runId: number;

  setOpen(open: boolean): void;
  setRequest(patch: Partial<TraceRequestSpec>): void;
  start(): number;
  finish(runId: number, trace: TraceView): boolean;
  fail(runId: number, message: string): boolean;
  setStep(i: number): void;
  next(): void;
  prev(): void;
  play(): void;
  pause(): void;
  /** Next step while playing; stops at the last one. */
  advance(): void;
  reset(): void;
}

export type TraceStore = StoreApi<TraceState>;

export const DEFAULT_TRACE_REQUEST: Readonly<TraceRequestSpec> = Object.freeze({
  warm: false,
  cache: 'miss',
});

const stepCount = (s: Pick<TraceState, 'trace'>) => s.trace?.steps.length ?? 0;

export function createTraceStore(): TraceStore {
  return createStore<TraceState>()((set, get) => ({
    open: false,
    request: { ...DEFAULT_TRACE_REQUEST },
    status: 'idle',
    trace: null,
    error: null,
    step: -1,
    playing: false,
    runId: 0,

    setOpen(open) {
      set(open ? { open } : { open, playing: false });
    },
    setRequest(patch) {
      set((s) => ({ request: { ...s.request, ...patch } }));
    },
    start() {
      const runId = get().runId + 1;
      set({ runId, status: 'running', error: null });
      return runId;
    },
    finish(runId, trace) {
      if (runId !== get().runId) return false;
      // A new trace (other flow/region/warmth or an edited board) restarts the walk-through.
      set({ status: 'done', trace, error: null, step: -1, playing: false });
      return true;
    },
    fail(runId, message) {
      if (runId !== get().runId) return false;
      set({ status: 'error', error: message, playing: false });
      return true;
    },
    setStep(i) {
      const n = stepCount(get());
      set({ step: n === 0 ? -1 : Math.min(n - 1, Math.max(-1, Math.round(i))), playing: false });
    },
    next() {
      const n = stepCount(get());
      set((s) => ({ step: Math.min(n - 1, s.step + 1), playing: false }));
    },
    prev() {
      set((s) => ({ step: Math.max(-1, s.step - 1), playing: false }));
    },
    play() {
      const n = stepCount(get());
      if (n === 0) return;
      const step = get().step >= n - 1 ? -1 : get().step;
      set({ step, playing: true });
    },
    pause() {
      if (get().playing) set({ playing: false });
    },
    advance() {
      const { playing, step } = get();
      const n = stepCount(get());
      if (!playing || n === 0) return;
      const nextStep = Math.min(n - 1, step + 1);
      set({ step: nextStep, playing: nextStep < n - 1 });
    },
    reset() {
      set({ step: -1, playing: false });
    },
  }));
}

/** The step shown now, if any. */
export function currentTraceStep(s: Pick<TraceState, 'trace' | 'step'>): TraceViewStep | undefined {
  return s.step >= 0 ? s.trace?.steps[s.step] : undefined;
}
