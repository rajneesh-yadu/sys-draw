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
import { EDGE_WIDTH, edgeStrokeWidth, maxEdgeRps } from './overlay';

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
