import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimInput } from '@/engine';
import {
  createAppStores,
  createSimulationStore,
  type BoardStore,
  type SimResult,
  type SimulationStore,
  type WorkspaceStore,
} from '@/store';
import { SIMULATION_DEBOUNCE_MS, startSimulationRunner, type SimulationRunner } from './runner';

const result = (nodes: number): SimResult => ({
  perNode: {},
  perEdge: {},
  perFlow: {},
  system: { rps: nodes, availability: 1, costPerMonth: 0, bottlenecks: [] },
  findings: [],
});

let board: BoardStore;
let ws: WorkspaceStore;
let sim: SimulationStore;
let runner: SimulationRunner;
let calls: SimInput[];
let run: (input: SimInput) => Promise<SimResult>;

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

function start() {
  runner = startSimulationRunner({
    boardStore: board,
    workspaceStore: ws,
    simulationStore: sim,
    run: (i) => run(i),
    now: () => 0,
  });
}

function addNode() {
  board
    .getState()
    .dispatch({ type: 'addNode', defId: 'compute.app-server', position: { x: 0, y: 0 } });
}

beforeEach(() => {
  vi.useFakeTimers();
  ({ boardStore: board, workspaceStore: ws } = createAppStores());
  sim = createSimulationStore();
  calls = [];
  run = (i) => {
    calls.push(i);
    return Promise.resolve(result(i.graph.nodes.length));
  };
});

afterEach(() => {
  runner.dispose();
  vi.useRealTimers();
});

describe('simulation runner', () => {
  it('runs once on start and stores the result for the open board', async () => {
    start();
    expect(calls).toHaveLength(1);
    await flush();
    expect(sim.getState()).toMatchObject({ status: 'done', boardId: ws.getState().activeBoardId });
  });

  it('debounces graph edits by 300 ms', async () => {
    start();
    await flush();
    addNode();
    vi.advanceTimersByTime(SIMULATION_DEBOUNCE_MS - 1);
    addNode();
    vi.advanceTimersByTime(SIMULATION_DEBOUNCE_MS - 1);
    expect(calls).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.graph.nodes).toHaveLength(2);
    await flush();
    expect(sim.getState().result?.system.rps).toBe(2);
  });

  it('re-runs on scenario changes, not on selection changes', () => {
    start();
    board.getState().setSelection([]);
    vi.advanceTimersByTime(1000);
    expect(calls).toHaveLength(1);
    board.getState().dispatch({ type: 'updateScenario', patch: { peakMultiplier: 3 } });
    vi.advanceTimersByTime(SIMULATION_DEBOUNCE_MS);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.scenario.peakMultiplier).toBe(3);
  });

  it('does not run a board twice when opening it also loads its graph', () => {
    start();
    ws.getState().createBoard();
    const n = calls.length;
    vi.advanceTimersByTime(SIMULATION_DEBOUNCE_MS);
    expect(calls).toHaveLength(n);
  });

  it('"Run" requests run immediately, even with unchanged inputs', () => {
    start();
    sim.getState().requestRun();
    expect(calls).toHaveLength(2);
  });

  it('clears old results and runs at once when another board opens', async () => {
    start();
    addNode();
    vi.advanceTimersByTime(SIMULATION_DEBOUNCE_MS);
    await flush();
    expect(sim.getState().result?.system.rps).toBe(1);
    const r = ws.getState().createBoard();
    expect(r.ok).toBe(true);
    expect(sim.getState().result).toBeNull();
    await flush();
    expect(calls.at(-1)?.graph.nodes).toHaveLength(0);
    expect(sim.getState()).toMatchObject({ status: 'done', boardId: ws.getState().activeBoardId });
    expect(sim.getState().result?.system.rps).toBe(0);
  });

  it('keeps only the newest result when runs finish out of order', async () => {
    const resolvers: ((r: SimResult) => void)[] = [];
    run = (i) => {
      calls.push(i);
      return new Promise((res) => resolvers.push(res));
    };
    start();
    sim.getState().requestRun();
    resolvers[1]?.(result(2));
    await flush();
    resolvers[0]?.(result(1));
    await flush();
    expect(sim.getState().result?.system.rps).toBe(2);
  });

  it('reports engine errors', async () => {
    run = () => Promise.reject(new Error('bad graph'));
    start();
    await flush();
    expect(sim.getState()).toMatchObject({ status: 'error', error: 'bad graph' });
  });

  it('stops listening after dispose', () => {
    start();
    runner.dispose();
    addNode();
    sim.getState().requestRun();
    vi.advanceTimersByTime(1000);
    expect(calls).toHaveLength(1);
  });
});
