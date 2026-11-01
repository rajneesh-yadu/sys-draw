import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  BoardStoreProvider,
  createAppStores,
  createSimulationStore,
  defaultScenario,
  SimulationStoreProvider,
  type NodeMetrics,
  type SimResult,
} from '@/store';
import {
  bottleneckRows,
  flowFormula,
  flowName,
  nodeFormula,
  regionFormula,
  regionRows,
  systemFormulas,
} from './formulas';
import { MetricsDrawer } from './MetricsDrawer';

const node = (utilization: number, extra: Partial<NodeMetrics> = {}): NodeMetrics => ({
  utilization,
  rpsIn: 200,
  rpsOut: 200,
  queueDepth: 0.5,
  latencyMs: { p50: 13.86, p95: 59.91, p99: 92.1 },
  errorRate: 0,
  costPerMonth: 0,
  explain: {
    utilization: `ρ = λ/(c·μ) per instance = ${utilization}`,
    latencyMs: 'T = Wq + S̄ = 0 + 20 = 20 ms',
    rpsIn: 'λ = 200 read + 0 write = 200 rps',
    costPerMonth: 'Cost model arrives with scaling (S09).',
  },
  ...extra,
});

function region(name: string, users: number, rps: number, net: number, p50: number) {
  return {
    name,
    users,
    rps,
    p50,
    p95: p50 + 100,
    p99: p50 + 160,
    errorRate: 0,
    networkMs: net,
    servedFrom: 'us-east',
    explain: {
      networkMs: `Mean network time per request = ${net} ms. Main path: RTT ${name} → US East`,
      servedFrom: 'Served from us-east 100%',
    },
  };
}

function resultFor(ids: { lb: string; app: string }): SimResult {
  return {
    perNode: { [ids.lb]: node(0.2), [ids.app]: node(1.6) },
    perEdge: {},
    perFlow: {
      flow_inferred: { p50: 35.84, p95: 151, p99: 231.5, rps: 200, errorRate: 0 },
    },
    perRegion: {
      'north-america': region('North America', 600, 120, 38.8, 74.6),
      india: region('India & South Asia', 400, 80, 218.2, 254),
    },
    system: { rps: 200, availability: 0.995, costPerMonth: 0, bottlenecks: [ids.app] },
    findings: [
      {
        ruleId: 'engine.route',
        severity: 'info',
        title: 'No client nodes',
        message: 'Traffic starts at root nodes.',
        targetIds: [],
      },
    ],
  };
}

describe('formulas', () => {
  const scenario = { ...defaultScenario(), usersByRegion: { 'north-america': 1000 } };

  it('names the inferred flow and scenario flows', () => {
    expect(flowName('flow_inferred', scenario)).toBe('All traffic (inferred from clients)');
    const withFlow = {
      ...scenario,
      flows: [{ id: 'flow_feed', name: 'Load feed', share: 1, rpsPerUser: 1, path: [] }],
    };
    expect(flowName('flow_feed', withFlow)).toBe('Load feed');
    expect(flowName('flow_gone', withFlow)).toBe('flow_gone');
  });

  it('states system formulas with the result’s own numbers', () => {
    const r = resultFor({ lb: 'node_lb', app: 'node_app' });
    const f = systemFormulas(r, scenario);
    expect(f.rps).toContain('Rate of the only flow = 200 rps');
    expect(f.rps).toContain('1,000 users');
    expect(f.errorRate).toBe('error rate = 1 − availability = 1 − 99.5% = 0.5%');
    expect(f.availability).toContain('= 199 rps / 200 rps = 99.5%');
    expect(f.costPerMonth).toBe(
      'Σ component cost per month = $0. Select a component to see its own formula.',
    );
    r.perEdge = {
      e: {
        rps: 1,
        latencyMs: { p50: 1, p95: 1, p99: 1 },
        handshakeMs: 0,
        bytesPerSec: 1,
        errorRate: 0,
        costPerMonth: 30,
        explain: {},
      },
    };
    r.system.costPerMonth = 30;
    expect(systemFormulas(r, scenario).costPerMonth).toContain(
      'Σ component cost + Σ connection egress = $0 + $30 = $30',
    );
  });

  it('sums several flows for throughput', () => {
    const r = resultFor({ lb: 'a', app: 'b' });
    r.perFlow = {
      a: { p50: 1, p95: 2, p99: 3, rps: 150, errorRate: 0 },
      b: { p50: 1, p95: 2, p99: 3, rps: 50, errorRate: 0 },
    };
    expect(systemFormulas(r, scenario).rps).toContain('Σ flow rates = 150 + 50 = 200 rps');
  });

  it('uses the engine explain for node numbers and falls back to definitions', () => {
    const m = node(0.4);
    expect(nodeFormula('utilization', m)).toBe(m.explain.utilization);
    expect(nodeFormula('p99', m)).toBe(m.explain.latencyMs);
    expect(nodeFormula('errorRate', m)).toBe('No rejections.');
    expect(flowFormula('p99', { p50: 1, p95: 2, p99: 3, rps: 1, errorRate: 0 }, scenario)).toMatch(
      /^p99: .*shifted exponential/,
    );
  });

  it('per-region rows (most users first) use the engine explain', () => {
    const r = resultFor({ lb: 'a', app: 'b' });
    const rows = regionRows(r);
    expect(rows.map((x) => x.id)).toEqual(['north-america', 'india']);
    expect(regionFormula('networkMs', rows[1]!.m)).toContain('RTT India & South Asia');
    expect(regionFormula('p99', rows[1]!.m)).toMatch(/1 request in 100/);
  });

  it('lists bottlenecks in result order with labels', () => {
    const r = resultFor({ lb: 'node_lb', app: 'node_app' });
    expect(bottleneckRows(r, (id) => (id === 'node_app' ? 'app-server-1' : undefined))).toEqual([
      {
        nodeId: 'node_app',
        label: 'app-server-1',
        utilization: 1.6,
        formula: 'ρ = λ/(c·μ) per instance = 1.6',
      },
    ]);
  });
});

function setup() {
  const { boardStore: board } = createAppStores();
  const sim = createSimulationStore();
  board
    .getState()
    .dispatch({ type: 'addNode', defId: 'network.load-balancer', position: { x: 0, y: 0 } });
  board
    .getState()
    .dispatch({ type: 'addNode', defId: 'compute.app-server', position: { x: 300, y: 0 } });
  const [lb, app] = board.getState().doc.graph.nodes.map((n) => n.id) as [string, string];
  render(
    <BoardStoreProvider store={board}>
      <SimulationStoreProvider store={sim}>
        <MetricsDrawer />
      </SimulationStoreProvider>
    </BoardStoreProvider>,
  );
  const publish = () =>
    act(
      () =>
        void sim.getState().finish(sim.getState().start(), 'board_1', resultFor({ lb, app }), 4),
    );
  return { board, sim, lb, app, publish };
}

describe('MetricsDrawer', () => {
  it('shows a placeholder before the first result, then system KPIs and per-flow p99', () => {
    const { publish } = setup();
    expect(screen.getByText('Results appear here after the first run.')).toBeInTheDocument();
    expect(screen.getByTestId('sim-status')).toHaveTextContent('Not simulated yet');
    publish();
    expect(screen.getByTestId('sim-status')).toHaveTextContent('Up to date (4 ms)');
    const kpis = screen.getByTestId('system-kpis');
    expect(
      within(kpis).getByRole('button', { name: 'Throughput: show formula' }),
    ).toHaveTextContent('200 rps');
    expect(
      within(kpis).getByRole('button', { name: 'Availability: show formula' }),
    ).toHaveTextContent('99.5%');
    expect(
      within(kpis).getByRole('button', { name: 'Error rate: show formula' }),
    ).toHaveTextContent('0.5%');
    const row = within(screen.getByTestId('flow-table')).getByRole('row', {
      name: /All traffic \(inferred from clients\)/,
    });
    expect(within(row).getByRole('button', { name: /^p99 of / })).toHaveTextContent('232 ms');
    expect(screen.getByText(/No client nodes/)).toBeInTheDocument();
  });

  it('shows latency by user region with where they are served from (S10)', () => {
    const { publish } = setup();
    publish();
    const table = screen.getByTestId('region-table');
    const india = within(table).getByRole('row', { name: /India & South Asia/ });
    expect(within(india).getByRole('button', { name: /^Network for / })).toHaveTextContent(
      '218 ms',
    );
    expect(within(india).getByRole('button', { name: /^p50 for / })).toHaveTextContent('254 ms');
    expect(within(india).getByRole('button', { name: /^From for / })).toHaveTextContent('us-east');
    expect(within(table).queryByRole('columnheader', { name: 'Errors' })).toBeNull();
  });

  it('shows a formula tooltip on focus and hides it on Escape', () => {
    const { publish } = setup();
    publish();
    const p99 = screen.getByRole('button', { name: /^p99 of / });
    fireEvent.focus(p99);
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('shifted exponential');
    expect(p99).toHaveAttribute('aria-describedby', tip.id);
    fireEvent.keyDown(p99, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('every number in the drawer has a formula', () => {
    const { publish, board, app } = setup();
    publish();
    act(() => board.getState().setSelection([app]));
    const list = screen.getByTestId('bottlenecks');
    const buttons = screen
      .getAllByRole('button')
      .filter((b) => /\d/.test(b.textContent ?? '') && !list.contains(b));
    expect(buttons.length).toBeGreaterThan(15);
    for (const b of buttons) expect(b.getAttribute('aria-label') ?? '').toMatch(/: show formula$/);
    // Bottleneck rows are buttons themselves; their utilisation formula is in the title.
    for (const b of within(list).getAllByRole('button')) expect(b.title).toContain('ρ = λ/(c·μ)');
  });

  it('clicking a bottleneck selects it, asks the canvas to focus it and shows its detail', () => {
    const { publish, board, sim, app } = setup();
    publish();
    expect(screen.queryByTestId('node-detail')).toBeNull();
    fireEvent.click(
      within(screen.getByTestId('bottlenecks')).getByRole('button', { name: /app-server-1/ }),
    );
    expect(board.getState().selection).toEqual([app]);
    expect(sim.getState().focus).toEqual({ nodeId: app, seq: 1 });
    const detail = screen.getByTestId('node-detail');
    expect(within(detail).getByRole('heading')).toHaveTextContent('app-server-1');
    expect(within(detail).getByRole('meter', { name: 'Utilisation' })).toHaveAttribute(
      'aria-valuetext',
      '160%, Overloaded',
    );
    expect(within(detail).getByRole('button', { name: 'p99: show formula' })).toHaveTextContent(
      '92.1 ms',
    );
  });

  it('Run asks for a simulation; Hide collapses the body', () => {
    const { sim } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(sim.getState().runRequests).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.getByRole('button', { name: 'Show' })).toHaveAttribute('aria-expanded', 'false');
  });
});
