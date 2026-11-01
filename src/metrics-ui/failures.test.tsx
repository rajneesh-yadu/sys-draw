import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BoardStoreProvider,
  CHAOS_EVENT_KINDS,
  createAppStores,
  createSimulationStore,
  SimulationStoreProvider,
  type Graph,
  type SimResult,
  type TimePoint,
} from '@/store';
import {
  boardRegions,
  buildChaosEvent,
  CHAOS_KIND_META,
  chaosEventLabel,
  chaosWhen,
  emptyDraft,
  eventSpans,
  PLAYBACK_MS_PER_TICK,
} from './chaos';
import { MetricsDrawer } from './MetricsDrawer';

const graph: Graph = {
  nodes: [
    {
      id: 'node_db',
      defId: 'database.sql',
      label: 'Orders DB',
      position: { x: 0, y: 0 },
      config: {},
      scaling: { replicas: 1, instanceType: 'x' },
    },
    {
      id: 'node_app',
      defId: 'compute.app-server',
      label: 'API',
      position: { x: 0, y: 0 },
      config: {},
      scaling: { replicas: 1, instanceType: 'x' },
    },
  ],
  edges: [
    {
      id: 'edge_a',
      source: 'node_app',
      target: 'node_db',
      protocolStack: ['tcp'],
      sync: true,
      config: {},
    },
  ],
  groups: [
    { id: 'grp_a', kind: 'az', label: 'AZ a' },
    { id: 'grp_us', kind: 'region', label: 'US', regionId: 'us-east' },
    { id: 'grp_eu', kind: 'region', label: 'EU', regionId: 'eu-west' },
  ],
};

describe('chaos editor helpers', () => {
  it('has editor metadata for every chaos event kind', () => {
    for (const k of CHAOS_EVENT_KINDS) expect(CHAOS_KIND_META[k].label).not.toBe('');
  });

  it('builds valid events from the form fields', () => {
    const id = () => 'evt_test';
    expect(buildChaosEvent({ ...emptyDraft('nodeOutage'), target: 'node_db' }, id)).toEqual({
      ok: true,
      event: { id: 'evt_test', kind: 'nodeOutage', atSec: 10, nodeId: 'node_db' },
    });
    const spike = buildChaosEvent(
      { ...emptyDraft('trafficSpike'), atSec: '5', durationSec: '20' },
      id,
    );
    expect(spike).toEqual({
      ok: true,
      event: { id: 'evt_test', kind: 'trafficSpike', atSec: 5, durationSec: 20, multiplier: 3 },
    });
    const lat = buildChaosEvent({ ...emptyDraft('latencyInjection'), target: 'edge_a' }, id);
    expect(lat.ok && lat.event).toMatchObject({ edgeId: 'edge_a', addedMs: 200 });
    const cold = buildChaosEvent(emptyDraft('coldStartBurst'), id);
    expect(cold.ok && cold.event).toEqual({ id: 'evt_test', kind: 'coldStartBurst', atSec: 10 });
    const part = buildChaosEvent(
      { ...emptyDraft('networkPartition'), target: 'us-east', target2: 'eu-west' },
      id,
    );
    expect(part.ok && part.event).toMatchObject({ regionA: 'us-east', regionB: 'eu-west' });
  });

  it('gives a readable reason for incomplete or invalid fields', () => {
    expect(buildChaosEvent(emptyDraft('nodeOutage'))).toEqual({
      ok: false,
      reason: 'Pick a component.',
    });
    expect(
      buildChaosEvent({ ...emptyDraft('networkPartition'), target: 'eu-west', target2: 'eu-west' }),
    ).toEqual({ ok: false, reason: 'Pick two different regions.' });
    const bad = buildChaosEvent({
      ...emptyDraft('hotKey'),
      target: 'node_db',
      params: { share: '3' },
    });
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.reason).toMatch(/^share:/);
    const generated = buildChaosEvent({ ...emptyDraft('diskFull'), target: 'node_db' });
    expect(generated.ok && generated.event.id).toMatch(/^evt_[a-z0-9]{1,12}$/);
  });

  it('labels events with board names and timing', () => {
    const ev = { id: 'evt_1', kind: 'groupOutage' as const, groupId: 'grp_a', atSec: 20 };
    expect(chaosEventLabel(ev, graph)).toBe('AZ a down');
    expect(chaosWhen(ev)).toBe('at 20 s until the end');
    expect(
      chaosEventLabel(
        { id: 'evt_2', kind: 'packetLoss', lossRate: 0.02, edgeId: 'edge_a', atSec: 0 },
        graph,
      ),
    ).toBe('2% packet loss on API → Orders DB');
    expect(
      chaosWhen({ id: 'evt_3', kind: 'diskFull', nodeId: 'node_db', atSec: 5, durationSec: 9 }),
    ).toBe('at 5 s for 9 s');
    expect(boardRegions(graph)).toEqual(['eu-west', 'us-east']);
  });

  it('turns start/end markers into shaded spans', () => {
    expect(
      eventSpans(
        [
          { tSec: 10, kind: 'chaos-start', label: 'A', targetIds: [], eventId: 'evt_a' },
          { tSec: 30, kind: 'chaos-end', label: 'A over', targetIds: [], eventId: 'evt_a' },
          { tSec: 40, kind: 'detected', label: 'x', targetIds: [] },
          { tSec: 50, kind: 'chaos-start', label: 'B', targetIds: [], eventId: 'evt_b' },
        ],
        60,
      ),
    ).toEqual([
      { eventId: 'evt_a', label: 'A', from: 10, to: 30 },
      { eventId: 'evt_b', label: 'B', from: 50, to: 60 },
    ]);
  });
});

// ── Panel ──

const point = (tSec: number, availability: number): TimePoint => ({
  tSec,
  rps: 60,
  p50Ms: 10,
  p99Ms: availability < 1 ? 400 : 40,
  errorRate: 1 - availability,
  availability,
});

function timelineResult(): SimResult {
  return {
    perNode: {},
    perEdge: {},
    perFlow: {},
    system: { rps: 60, availability: 1, costPerMonth: 0, bottlenecks: [] },
    findings: [],
    timeline: Array.from({ length: 6 }, (_, t) => ({
      ...point(t, t >= 2 && t < 4 ? 0.5 : 1),
      activeEventIds: t >= 2 ? ['evt_kill'] : [],
    })),
    timelineEvents: [
      { tSec: 2, kind: 'chaos-start', label: 'App down', targetIds: [], eventId: 'evt_kill' },
      { tSec: 4, kind: 'detected', label: 'LB stops sending to App', targetIds: [] },
    ],
  };
}

function setup() {
  const { boardStore: board } = createAppStores();
  const sim = createSimulationStore();
  board
    .getState()
    .dispatch({ type: 'addNode', defId: 'compute.app-server', position: { x: 0, y: 0 } });
  const app = board.getState().doc.graph.nodes[0]!;
  render(
    <BoardStoreProvider store={board}>
      <SimulationStoreProvider store={sim}>
        <MetricsDrawer />
      </SimulationStoreProvider>
    </BoardStoreProvider>,
  );
  return { board, sim, app };
}

afterEach(() => vi.useRealTimers());

describe('FailuresPanel', () => {
  it('adds and removes chaos events through the board store (one undo step each)', () => {
    const { board, sim, app } = setup();
    act(() => void sim.getState().finish(sim.getState().start(), 'b', timelineResult()));
    const panel = screen.getByTestId('failures-panel');
    expect(within(panel).getByText('No chaos events yet.')).toBeInTheDocument();
    // Collapsed until asked for, so the board's names don't repeat in the drawer.
    expect(within(panel).queryByRole('form')).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: 'Add chaos event…' }));
    const form = within(panel).getByRole('form', { name: 'Add chaos event' });
    fireEvent.click(within(form).getByRole('button', { name: 'Add event' }));
    expect(within(panel).getByRole('alert')).toHaveTextContent('Pick a component.');
    fireEvent.change(within(form).getByLabelText('Target'), { target: { value: app.id } });
    fireEvent.change(within(form).getByLabelText('Starts at (s)'), { target: { value: '20' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add event' }));
    const events = board.getState().doc.scenario.events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'nodeOutage', nodeId: app.id, atSec: 20 });
    expect(within(panel).queryByRole('form')).toBeNull(); // closes after adding
    expect(within(panel).getByTestId('chaos-events')).toHaveTextContent(
      `${app.label} down at 20 s until the end`,
    );
    fireEvent.click(within(panel).getByRole('button', { name: `Remove ${app.label} down` }));
    expect(board.getState().doc.scenario.events).toHaveLength(0);
    act(() => board.getState().undo());
    expect(board.getState().doc.scenario.events).toHaveLength(1);
  });

  it('shows params for the chosen kind', () => {
    const { sim } = setup();
    act(() => void sim.getState().finish(sim.getState().start(), 'b', timelineResult()));
    fireEvent.click(screen.getByRole('button', { name: 'Add chaos event…' }));
    const form = screen.getByRole('form', { name: 'Add chaos event' });
    fireEvent.change(within(form).getByLabelText('Event'), { target: { value: 'trafficSpike' } });
    expect(within(form).getByLabelText('Multiplier ×')).toHaveValue(3);
    expect(within(form).getByLabelText('Target')).toHaveDisplayValue('All users');
  });

  it('explains the timeline before there is one', () => {
    const { sim } = setup();
    act(
      () =>
        void sim
          .getState()
          .finish(sim.getState().start(), 'b', { ...timelineResult(), timeline: undefined }),
    );
    expect(screen.getByText(/Add a chaos event to replay the run/)).toBeInTheDocument();
    expect(screen.queryByTestId('timeline')).toBeNull();
  });

  it('charts the timeline, lists markers, and scrubs the canvas tick', () => {
    const { sim } = setup();
    act(() => void sim.getState().finish(sim.getState().start(), 'b', timelineResult()));
    const tl = screen.getByTestId('timeline');
    expect(within(tl).getByRole('figure', { name: 'Availability' })).toBeInTheDocument();
    expect(within(tl).getByRole('figure', { name: 'p99 latency' })).toBeInTheDocument();
    expect(within(tl).getByTestId('timeline-readout')).toHaveTextContent(/steady state/);
    // Slider ⇒ tick.
    fireEvent.change(within(tl).getByLabelText('Timeline position'), { target: { value: '3' } });
    expect(sim.getState().playback.tick).toBe(3);
    expect(within(tl).getByTestId('timeline-readout')).toHaveTextContent(
      't = 3 s · 60 rps · availability 50% · p99 400 ms',
    );
    // Marker ⇒ tick.
    fireEvent.click(within(tl).getByRole('button', { name: /LB stops sending to App/ }));
    expect(sim.getState().playback.tick).toBe(4);
    // Back to steady state.
    fireEvent.click(within(tl).getByRole('button', { name: 'Steady state' }));
    expect(sim.getState().playback.tick).toBeNull();
    // Table view has a row per tick.
    expect(within(tl).getAllByRole('row')).toHaveLength(7);
  });

  it('plays tick by tick and stops at the end', () => {
    vi.useFakeTimers();
    const { sim } = setup();
    act(() => void sim.getState().finish(sim.getState().start(), 'b', timelineResult()));
    fireEvent.click(screen.getByRole('button', { name: 'Play timeline' }));
    expect(sim.getState().playback).toEqual({ tick: 0, playing: true });
    act(() => vi.advanceTimersByTime(PLAYBACK_MS_PER_TICK * 2));
    expect(sim.getState().playback.tick).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'Pause timeline' }));
    act(() => vi.advanceTimersByTime(PLAYBACK_MS_PER_TICK * 5));
    expect(sim.getState().playback.tick).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'Play timeline' }));
    act(() => vi.advanceTimersByTime(PLAYBACK_MS_PER_TICK * 10));
    expect(sim.getState().playback).toEqual({ tick: 5, playing: false });
  });
});
