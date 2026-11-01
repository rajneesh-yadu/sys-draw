/**
 * Wires the engine's request trace to the canvas's trace store (S15). While the trace panel is
 * open it re-traces when the request (flow, region, cold/warm, cache branch) changes at once, and
 * 300 ms after the board's graph, scenario or provider changes; results of older runs are dropped.
 * Contains no metric logic: it only moves data (and maps the engine result onto the view type).
 */
import { TRACE_CATEGORIES, TRACE_CATEGORY_LABEL, type RequestTrace, type SimInput } from '@/engine';
import type { TraceRequestSpec, TraceStore, TraceView } from '@/canvas';
import type { BoardStore } from '@/store';

export const TRACE_DEBOUNCE_MS = 300;

export type TraceRun = (
  input: SimInput,
  flowId: string | undefined,
  regionId: string | undefined,
  options: { warm: TraceRequestSpec['warm']; cache: TraceRequestSpec['cache'] },
) => Promise<RequestTrace>;

export interface TraceRunnerOptions {
  boardStore: BoardStore;
  traceStore: TraceStore;
  run: TraceRun;
  debounceMs?: number;
}

/** The canvas's view of an engine trace (breakdown as labelled segments in category order). */
export function toTraceView(t: RequestTrace): TraceView {
  return {
    ...t,
    breakdown: TRACE_CATEGORIES.map((id) => ({
      id,
      label: TRACE_CATEGORY_LABEL[id],
      ms: t.breakdown[id],
    })),
  };
}

export function startTraceRunner(opts: TraceRunnerOptions): { dispose(): void } {
  const { boardStore, traceStore, run } = opts;
  const debounceMs = opts.debounceMs ?? TRACE_DEBOUNCE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const execute = () => {
    cancel();
    if (disposed || !traceStore.getState().open) return;
    const { doc } = boardStore.getState();
    const { request } = traceStore.getState();
    const runId = traceStore.getState().start();
    let pending: Promise<RequestTrace>;
    try {
      pending = run(
        { graph: doc.graph, scenario: doc.scenario, providerId: doc.providerId },
        request.flowId,
        request.regionId,
        { warm: request.warm, cache: request.cache },
      );
    } catch (e) {
      pending = Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
    pending.then(
      (t) => {
        if (!disposed) traceStore.getState().finish(runId, toTraceView(t));
      },
      (e: unknown) => {
        if (!disposed)
          traceStore
            .getState()
            .fail(runId, e instanceof Error ? e.message : `Trace failed: ${String(e)}`);
      },
    );
  };

  const unsubTrace = traceStore.subscribe((s, prev) => {
    if ((s.open && !prev.open) || (s.open && s.request !== prev.request)) execute();
    if (!s.open) cancel();
  });

  const unsubBoard = boardStore.subscribe((s, prev) => {
    if (!traceStore.getState().open) return;
    if (
      s.doc.graph !== prev.doc.graph ||
      s.doc.scenario !== prev.doc.scenario ||
      s.doc.providerId !== prev.doc.providerId
    ) {
      cancel();
      timer = setTimeout(execute, debounceMs);
    }
  });

  execute();

  return {
    dispose() {
      disposed = true;
      cancel();
      unsubTrace();
      unsubBoard();
    },
  };
}
