import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { registry } from '@/registry';
import {
  BoardStoreProvider,
  createBoardStore,
  createSimulationStore,
  SimulationStoreProvider,
  type NodeMetrics,
  type SimResult,
} from '@/store';
import { BoardCanvas } from './BoardCanvas';
import { CanvasProvider } from './CanvasProvider';
import { EDGE_WIDTH, edgeStrokeWidth, maxEdgeRps, tickEdgeStyle } from './overlay';

describe('edgeStrokeWidth', () => {
  it('scales with the square root of rps relative to the busiest edge', () => {
    expect(edgeStrokeWidth(0, 100)).toBe(EDGE_WIDTH.min);
    expect(edgeStrokeWidth(5, 0)).toBe(EDGE_WIDTH.min);
    expect(edgeStrokeWidth(100, 100)).toBe(EDGE_WIDTH.max);
    // √(25/100) = 0.5 → 1.5 + 6.5 × 0.5 = 4.75 → 4.8 (one decimal)
    expect(edgeStrokeWidth(25, 100)).toBe(4.8);
    expect(edgeStrokeWidth(400, 100)).toBe(EDGE_WIDTH.max);
  });

  it('finds the busiest edge', () => {
    const e = (rps: number) => ({
      rps,
      latencyMs: { p50: 0, p95: 0, p99: 0 },
      handshakeMs: 0,
      bytesPerSec: 0,
      errorRate: 0,
      costPerMonth: 0,
      explain: {},
    });
    expect(maxEdgeRps(undefined)).toBe(0);
    expect(maxEdgeRps({ a: e(3), b: e(12), c: e(7) })).toBe(12);
  });
});

const metrics = (utilization: number): NodeMetrics => ({
  utilization,
  rpsIn: 1500,
  rpsOut: 1500,
  queueDepth: 0,
  latencyMs: { p50: 5, p95: 20, p99: 42 },
  errorRate: 0,
  costPerMonth: 0,
  explain: { utilization: `ρ = ${utilization}` },
});

function setup() {
  const board = createBoardStore({ registry });
  const sim = createSimulationStore();
  for (const x of [0, 300, 600]) {
    board
      .getState()
      .dispatch({ type: 'addNode', defId: 'compute.app-server', position: { x, y: 0 } });
  }
  render(
    <BoardStoreProvider store={board}>
      <SimulationStoreProvider store={sim}>
        <CanvasProvider>
          <div style={{ width: 800, height: 600 }}>
            <BoardCanvas />
          </div>
        </CanvasProvider>
      </SimulationStoreProvider>
    </BoardStoreProvider>,
  );
  return { board, sim };
}

describe('node overlays', () => {
  it('colours nodes by utilisation and shows rps and a p99 badge', async () => {
    const { board, sim } = setup();
    expect(screen.queryByTestId('node-overlay')).toBeNull();
    const [a, b, c] = board.getState().doc.graph.nodes.map((n) => n.id) as [string, string, string];
    const result: SimResult = {
      perNode: { [a]: metrics(0.3), [b]: metrics(0.7), [c]: metrics(1.6) },
      perEdge: {},
      perFlow: {},
      system: { rps: 1500, availability: 1, costPerMonth: 0, bottlenecks: [c] },
      findings: [],
    };
    act(() => void sim.getState().finish(sim.getState().start(), 'board_x', result));
    const overlays = await screen.findAllByTestId('node-overlay');
    expect(overlays.map((o) => o.getAttribute('data-level'))).toEqual(['ok', 'warn', 'hot']);
    expect(screen.getByLabelText('Utilisation 160%, Overloaded')).toBeInTheDocument();
    expect(screen.getAllByText('1500 rps')).toHaveLength(3);
    expect(screen.getAllByTestId('node-p99')[0]).toHaveTextContent('p99 42 ms');
    expect(
      screen.getAllByTestId('component-node').map((n) => n.getAttribute('data-level')),
    ).toEqual(['ok', 'warn', 'hot']);
  });
});

describe('failure timeline playback (S11)', () => {
  it('edge style per tick: breaker states and failing edges carry a text badge', () => {
    expect(tickEdgeStyle({ rps: 5, errorRate: 0 })).toEqual({ dashed: false });
    expect(tickEdgeStyle({ rps: 5, errorRate: 1, breaker: 'open' })).toMatchObject({
      dashed: true,
      badge: 'breaker open',
    });
    expect(tickEdgeStyle({ rps: 5, errorRate: 0, breaker: 'half-open' }).badge).toBe(
      'breaker half-open',
    );
    expect(tickEdgeStyle({ rps: 5, errorRate: 0.5 })).toMatchObject({ badge: '50% fail' });
  });

  it('shows the scrubbed tick on the nodes: down, degraded with errors, autoscaled replicas', async () => {
    const { board, sim } = setup();
    const [a, b, c] = board.getState().doc.graph.nodes.map((n) => n.id) as [string, string, string];
    const tick = (
      state: 'up' | 'down' | 'degraded',
      utilization: number,
      errorRate = 0,
      replicas = 1,
    ) => ({
      utilization,
      rpsIn: 10,
      errorRate,
      p99Ms: 12,
      replicas,
      state,
    });
    const result: SimResult = {
      perNode: { [a]: metrics(0.3), [b]: metrics(0.3), [c]: metrics(0.3) },
      perEdge: {},
      perFlow: {},
      system: { rps: 1, availability: 1, costPerMonth: 0, bottlenecks: [] },
      findings: [],
      timeline: [
        { tSec: 0, rps: 1, p50Ms: 1, p99Ms: 2, errorRate: 0, availability: 1 },
        {
          tSec: 1,
          rps: 1,
          p50Ms: 1,
          p99Ms: 2,
          errorRate: 0.5,
          availability: 0.5,
          nodes: {
            [a]: tick('down', 0, 1),
            [b]: tick('degraded', 0.9, 0.2),
            [c]: tick('up', 0.3, 0, 3),
          },
        },
      ],
    };
    act(() => void sim.getState().finish(sim.getState().start(), 'board_x', result));
    await screen.findAllByTestId('node-overlay');
    expect(
      screen.getAllByTestId('component-node').map((n) => n.getAttribute('data-state')),
    ).toEqual([null, null, null]);
    act(() => sim.getState().setTick(1));
    const nodes = screen.getAllByTestId('component-node');
    expect(nodes.map((n) => n.getAttribute('data-state'))).toEqual(['down', 'degraded', 'up']);
    expect(nodes.map((n) => n.getAttribute('data-level'))).toEqual(['ok', 'hot', 'ok']);
    expect(screen.getByText('Down')).toBeInTheDocument();
    expect(screen.getByText('20% err')).toBeInTheDocument();
    expect(screen.getByLabelText('3 replicas')).toBeInTheDocument();
    act(() => sim.getState().setTick(null));
    expect(screen.queryByText('Down')).toBeNull();
  });
});
