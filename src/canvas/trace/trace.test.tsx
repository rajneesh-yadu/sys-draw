import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { registry } from '@/registry';
import { BoardStoreProvider, createBoardStore } from '@/store';
import { BoardCanvas } from '../BoardCanvas';
import { CanvasProvider } from '../CanvasProvider';
import { breakdownShares, elapsedAt, layerTag, sequenceLayout, tracedEdgeIds } from './sequence';
import { TracePanel } from './TracePanel';
import {
  createTraceStore,
  currentTraceStep,
  type TraceView,
  type TraceViewStep,
} from './trace-store';

const step = (i: number, p: Partial<TraceViewStep>): TraceViewStep => ({
  index: i,
  kind: 'request',
  category: 'network',
  layer: 'HTTP/2',
  osiLayer: 7,
  from: 'a',
  to: 'b',
  message: 'Read request',
  headers: [],
  startMs: i * 10,
  timeMs: 10,
  async: false,
  explain: '',
  ...p,
});

function fixture(edgeId = 'e1', a = 'a', b = 'b'): TraceView {
  return {
    flowId: 'f',
    flowName: 'Load feed',
    regionId: 'europe',
    regionName: 'Europe',
    warm: false,
    cache: 'miss',
    participants: [
      { id: a, label: 'client', kind: 'node' },
      { id: 'dns-resolver', label: 'DNS resolver', kind: 'dns' },
      { id: b, label: 'api', kind: 'node' },
    ],
    steps: [
      step(0, {
        kind: 'dns',
        category: 'dns',
        layer: 'DNS',
        from: a,
        to: 'dns-resolver',
        message: 'Query',
      }),
      step(1, {
        kind: 'handshake',
        category: 'tcp',
        layer: 'TCP',
        osiLayer: 4,
        from: a,
        to: b,
        message: 'SYN',
        edgeId,
        direction: 'forward',
      }),
      step(2, {
        kind: 'handshake',
        category: 'tcp',
        layer: 'TCP',
        osiLayer: 4,
        from: b,
        to: a,
        message: 'SYN-ACK',
        edgeId,
        direction: 'back',
      }),
      step(3, { from: a, to: b, edgeId, direction: 'forward', headers: ['Port 443 (TCP)'] }),
      step(4, {
        kind: 'service',
        category: 'service',
        layer: 'Service',
        from: b,
        to: b,
        message: 'api: read',
      }),
    ],
    totalMs: 50,
    breakdown: [
      { id: 'dns', label: 'DNS', ms: 10 },
      { id: 'tcp', label: 'TCP / QUIC', ms: 20 },
      { id: 'tls', label: 'TLS', ms: 0 },
      { id: 'network', label: 'Network', ms: 10 },
      { id: 'service', label: 'Service', ms: 10 },
    ],
    decisions: [{ nodeId: 'b', text: 'Cache miss (20% of reads, hit rate 80%)' }],
    notes: [],
    explain: 'x',
  };
}

describe('trace store (S15)', () => {
  it('drops stale results, restarts the walk on a new trace and clamps steps', () => {
    const s = createTraceStore();
    const r1 = s.getState().start();
    const r2 = s.getState().start();
    expect(s.getState().finish(r1, fixture())).toBe(false);
    expect(s.getState().finish(r2, fixture())).toBe(true);
    expect(s.getState().step).toBe(-1);
    s.getState().prev();
    expect(s.getState().step).toBe(-1);
    for (let i = 0; i < 9; i++) s.getState().next();
    expect(s.getState().step).toBe(4);
    expect(currentTraceStep(s.getState())?.message).toBe('api: read');
    s.getState().setStep(2);
    expect(currentTraceStep(s.getState())?.direction).toBe('back');
    s.getState().finish(s.getState().start(), fixture());
    expect(s.getState().step).toBe(-1);
    expect(s.getState().fail(s.getState().runId, 'boom')).toBe(true);
    expect(s.getState().error).toBe('boom');
  });

  it('plays to the last step and stops; closing pauses', () => {
    const s = createTraceStore();
    s.getState().finish(s.getState().start(), fixture());
    s.getState().play();
    for (let i = 0; i < 10; i++) s.getState().advance();
    expect(s.getState()).toMatchObject({ step: 4, playing: false });
    s.getState().play(); // from the end ⇒ restart
    expect(s.getState()).toMatchObject({ step: -1, playing: true });
    s.getState().setOpen(true);
    s.getState().setOpen(false);
    expect(s.getState().playing).toBe(false);
  });
});

describe('sequence helpers', () => {
  it('lays out lifelines and arrows, shares, elapsed time and traced edges', () => {
    const { columns, rows } = sequenceLayout(fixture());
    expect(columns.map((c) => Math.round(c.x))).toEqual([17, 50, 83]);
    expect(rows[2]).toMatchObject({ x1: columns[2]!.x, x2: columns[0]!.x, self: false });
    expect(rows[4]?.self).toBe(true);
    expect(breakdownShares(fixture().breakdown).map((b) => [b.id, b.share])).toEqual([
      ['dns', 0.2],
      ['tcp', 0.4],
      ['network', 0.2],
      ['service', 0.2],
    ]);
    expect(elapsedAt(fixture(), -1)).toBe(0);
    expect(elapsedAt(fixture(), 2)).toBe(30);
    expect([...tracedEdgeIds(fixture())]).toEqual(['e1']);
    expect(layerTag({ layer: 'TCP', osiLayer: 4 })).toBe('L4 · TCP');
  });
});

function setup() {
  const board = createBoardStore({ registry });
  board.getState().dispatch({ type: 'addNode', defId: 'client.app', position: { x: 0, y: 0 } });
  board
    .getState()
    .dispatch({ type: 'addNode', defId: 'compute.app-server', position: { x: 400, y: 0 } });
  const [n1, n2] = board.getState().doc.graph.nodes;
  board.getState().dispatch({ type: 'connect', source: n1!.id, target: n2!.id });
  const edgeId = board.getState().doc.graph.edges[0]?.id ?? 'none';
  const trace = createTraceStore();
  render(
    <BoardStoreProvider store={board}>
      <CanvasProvider traceStore={trace}>
        <div style={{ display: 'flex', width: 1200, height: 600 }}>
          <div style={{ width: 800, height: 600 }}>
            <BoardCanvas />
          </div>
          <TracePanel />
        </div>
      </CanvasProvider>
    </BoardStoreProvider>,
  );
  return { board, trace, edgeId, ids: [n1!.id, n2!.id] as const };
}

describe('TracePanel + canvas packets', () => {
  it('the toolbar opens the panel; options change the request', () => {
    const { trace } = setup();
    expect(screen.queryByTestId('trace-panel')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Trace request' }));
    const panel = screen.getByTestId('trace-panel');
    expect(trace.getState().open).toBe(true);
    fireEvent.click(within(panel).getByLabelText('Warm'));
    expect(trace.getState().request.warm).toBe(true);
    fireEvent.click(within(panel).getByLabelText('Resumed'));
    expect(trace.getState().request.warm).toBe('resumed');
    fireEvent.change(within(panel).getByLabelText('Users in'), { target: { value: 'india' } });
    expect(trace.getState().request.regionId).toBe('india');
    fireEvent.click(within(panel).getByLabelText('Close request trace'));
    expect(screen.queryByTestId('trace-panel')).toBeNull();
  });

  it('steps through the sequence diagram, shows headers and where time goes, and marks nodes', () => {
    const { trace, edgeId, ids } = setup();
    act(() => {
      trace.getState().setOpen(true);
      trace.getState().finish(trace.getState().start(), fixture(edgeId, ...ids));
    });
    const panel = screen.getByTestId('trace-panel');
    expect(within(panel).getAllByTestId('trace-row')).toHaveLength(5);
    expect(within(panel).getByTestId('trace-total')).toHaveTextContent('50 ms');
    expect(within(panel).getByTestId('trace-cat-tcp')).toHaveTextContent(
      /TCP \/ QUIC\s*20 ms\s*40%/,
    );
    expect(within(panel).queryByTestId('trace-cat-tls')).toBeNull(); // zero segments hidden
    expect(within(panel).getByText('Cache miss (20% of reads, hit rate 80%)')).toBeInTheDocument();

    fireEvent.click(within(panel).getByLabelText('Next step'));
    fireEvent.click(within(panel).getByLabelText('Next step'));
    expect(within(panel).getByTestId('trace-position')).toHaveTextContent('Step 2 / 5 · 20 ms');
    expect(within(panel).getByTestId('trace-step-detail')).toHaveTextContent('L4 · TCPSYN');
    // The packet on the edge itself is checked in e2e/trace.spec.ts (React Flow draws no edges in
    // jsdom, which cannot measure nodes); here: the node it travels to is marked as arriving.
    expect(document.querySelector(`[data-trace="arriving"]`)).not.toBeNull();
    fireEvent.click(within(panel).getAllByTestId('trace-row')[2]!);
    expect(within(panel).getAllByTestId('trace-row')[2]).toHaveAttribute('aria-current', 'step');
    fireEvent.click(within(panel).getAllByTestId('trace-row')[3]!);
    expect(within(panel).getByTestId('trace-step-detail')).toHaveTextContent('Port 443 (TCP)');

    // A node-local step: the node is highlighted.
    fireEvent.click(within(panel).getAllByTestId('trace-row')[4]!);
    expect(document.querySelector('[data-trace="service"]')).not.toBeNull();
  });
});
