import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTraceStore, type TraceStore } from '@/canvas';
import { traceRequest, type RequestTrace } from '@/engine';
import { registry } from '@/registry';
import { createBoardStore, type BoardStore } from '@/store';
import { startTraceRunner, toTraceView, TRACE_DEBOUNCE_MS } from './runner';

let board: BoardStore;
let trace: TraceStore;
let calls: unknown[][];
let dispose: () => void;

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
  board = createBoardStore({ registry });
  trace = createTraceStore();
  calls = [];
  dispose = startTraceRunner({
    boardStore: board,
    traceStore: trace,
    run: (input, flowId, regionId, options) => {
      calls.push([flowId, regionId, options]);
      return Promise.resolve(traceRequest(input, flowId, regionId, options));
    },
  }).dispose;
});

afterEach(() => {
  dispose();
  vi.useRealTimers();
});

describe('trace runner (S15)', () => {
  it('traces only while open, at once on request changes and debounced on board edits', async () => {
    expect(calls).toHaveLength(0);
    trace.getState().setOpen(true);
    await flush();
    expect(calls).toEqual([[undefined, undefined, { warm: false, cache: 'miss' }]]);
    expect(trace.getState().status).toBe('done');
    expect(trace.getState().trace?.notes[0]).toMatch(/empty/);

    trace.getState().setRequest({ warm: true, regionId: 'europe' });
    await flush();
    expect(calls.at(-1)).toEqual([undefined, 'europe', { warm: true, cache: 'miss' }]);

    board.getState().dispatch({ type: 'addNode', defId: 'client.app', position: { x: 0, y: 0 } });
    board
      .getState()
      .dispatch({ type: 'addNode', defId: 'compute.app-server', position: { x: 300, y: 0 } });
    expect(calls).toHaveLength(2);
    vi.advanceTimersByTime(TRACE_DEBOUNCE_MS);
    await flush();
    expect(calls).toHaveLength(3);

    trace.getState().setOpen(false);
    board
      .getState()
      .dispatch({ type: 'addNode', defId: 'compute.app-server', position: { x: 600, y: 0 } });
    vi.advanceTimersByTime(TRACE_DEBOUNCE_MS);
    expect(calls).toHaveLength(3);
  });

  it('maps the engine trace onto the canvas view with labelled segments in order', () => {
    const t = {
      breakdown: { dns: 1, tcp: 2, tls: 0, handshake: 0, network: 3, queue: 0, service: 4, db: 5 },
    } as RequestTrace;
    expect(toTraceView(t).breakdown.map((b) => `${b.label}=${b.ms}`)).toEqual([
      'DNS=1',
      'TCP / QUIC=2',
      'TLS=0',
      'App handshake=0',
      'Network=3',
      'Queue=0',
      'Service=4',
      'DB / cache=5',
    ]);
  });

  it('records a failure', async () => {
    dispose();
    dispose = startTraceRunner({
      boardStore: board,
      traceStore: trace,
      run: () => Promise.reject(new Error('worker died')),
    }).dispose;
    trace.getState().setOpen(true);
    await flush();
    expect(trace.getState()).toMatchObject({ status: 'error', error: 'worker died' });
  });
});
