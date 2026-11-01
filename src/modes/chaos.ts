/**
 * Chaos mode logic (pure): one-click failure presets that add chaos events to the scenario, and
 * the verdict over the resulting timeline (availability and p99 against targets).
 */
import type { BoardCommand, ChaosEvent, Graph, Scenario, TimelineMarker } from '@/store';
import { formatSloValue } from './evaluate';
import type { ModeContext, Problem } from './types';

export interface ChaosPreset {
  id: string;
  label: string;
  description: string;
  /** The event to add, or a reason why it does not apply to this board. */
  build(graph: Graph, scenario: Scenario, id: string): ChaosEvent | { unavailable: string };
}

/** Failures start a sixth into the run and last a third of it. */
export function chaosWindow(s: Scenario): { atSec: number; durationSec: number } {
  return {
    atSec: Math.max(1, Math.round(s.durationSec / 6)),
    durationSec: Math.max(1, Math.round(s.durationSec / 3)),
  };
}

const firstGroup = (g: Graph, kind: string) => g.groups.find((x) => x.kind === kind);

export const CHAOS_PRESETS: readonly ChaosPreset[] = [
  {
    id: 'kill-az',
    label: 'Kill an availability zone',
    description:
      'Everything in the first AZ goes down (or the first region / service if no AZ is drawn).',
    build(graph, s, id) {
      const w = chaosWindow(s);
      const az = firstGroup(graph, 'az') ?? firstGroup(graph, 'subnet');
      if (az) return { id, kind: 'groupOutage', groupId: az.id, ...w };
      const compute = graph.nodes.find((n) => !n.defId.startsWith('client.'));
      if (!compute) return { unavailable: 'Add a service to the board first' };
      return { id, kind: 'nodeOutage', nodeId: compute.id, ...w };
    },
  },
  {
    id: 'region-outage',
    label: 'Region outage',
    description: 'A whole cloud region (the first one on the board) goes dark.',
    build(graph, s, id) {
      const region = graph.groups.find((g) => g.kind === 'region' && g.regionId);
      if (!region?.regionId) return { unavailable: 'Put your design in a Region group first' };
      return { id, kind: 'regionOutage', regionId: region.regionId, ...chaosWindow(s) };
    },
  },
  {
    id: 'traffic-spike',
    label: 'Traffic spike ×3',
    description: 'Every region sends three times the traffic (a launch, a viral post).',
    build: (_g, s, id) => ({ id, kind: 'trafficSpike', multiplier: 3, ...chaosWindow(s) }),
  },
  {
    id: 'packet-loss',
    label: 'Packet loss 5 %',
    description: 'Every connection drops 5 % of packets (a bad link, a congested peering point).',
    build: (_g, s, id) => ({ id, kind: 'packetLoss', lossRate: 0.05, ...chaosWindow(s) }),
  },
];

/** One undo step adding the preset's event (or the reason it cannot apply). */
export function injectCommand(
  presetId: string,
  graph: Graph,
  scenario: Scenario,
  eventId: string,
): { ok: true; command: BoardCommand } | { ok: false; reason: string } {
  const preset = CHAOS_PRESETS.find((p) => p.id === presetId);
  if (!preset) return { ok: false, reason: `Unknown failure "${presetId}"` };
  const ev = preset.build(graph, scenario, eventId);
  if ('unavailable' in ev) return { ok: false, reason: ev.unavailable };
  return {
    ok: true,
    command: { type: 'updateScenario', patch: { events: [...scenario.events, ev] } },
  };
}

export interface ChaosTargets {
  availability: number;
  p99Ms: number;
}

export const DEFAULT_CHAOS_TARGETS: ChaosTargets = { availability: 0.99, p99Ms: 1000 };

/**
 * Targets: the problem's availability SLO and its loosest p99 SLO; defaults otherwise. A failure
 * may degrade the system, so under chaos the bar is the SLOs themselves, not the steady state.
 */
export function chaosTargets(problem: Problem | undefined): ChaosTargets {
  const slos = problem?.rubric.flatMap((r) => (r.slo ? [r.slo] : [])) ?? [];
  const avail = slos.find((s) => s.metric === 'availability');
  const p99s = slos.filter((s) => s.metric === 'p99').map((s) => s.value);
  return {
    availability: avail?.value ?? DEFAULT_CHAOS_TARGETS.availability,
    p99Ms: p99s.length ? Math.max(...p99s) : DEFAULT_CHAOS_TARGETS.p99Ms,
  };
}

export interface ChaosVerdict {
  events: number;
  targets: ChaosTargets;
  /** Undefined when there is no timeline yet. */
  minAvailability?: number;
  maxP99Ms?: number;
  availabilityOk: boolean;
  p99Ok: boolean;
  /** Seconds after the last failure ends until availability is back at target (0 = never dipped). */
  recoverySec?: number;
  markers: TimelineMarker[];
  passed: boolean;
  summary: string;
}

export function chaosVerdict(
  ctx: Pick<ModeContext, 'problem' | 'scenario' | 'result'>,
): ChaosVerdict {
  const targets = chaosTargets(ctx.problem);
  const events = ctx.scenario.events.length;
  const tl = ctx.result?.timeline;
  const markers = ctx.result?.timelineEvents ?? [];
  if (events === 0 || !tl?.length) {
    return {
      events,
      targets,
      availabilityOk: false,
      p99Ok: false,
      markers,
      passed: false,
      summary:
        events === 0 ? 'Inject a failure to start the experiment.' : 'Waiting for the timeline…',
    };
  }
  const minAvailability = Math.min(...tl.map((t) => t.availability));
  const maxP99Ms = Math.max(...tl.map((t) => t.p99Ms));
  const availabilityOk = minAvailability >= targets.availability;
  const p99Ok = maxP99Ms <= targets.p99Ms;
  const end = Math.max(...ctx.scenario.events.map((e) => e.atSec + (e.durationSec ?? Infinity)));
  let recoverySec: number | undefined;
  if (availabilityOk) recoverySec = 0;
  else if (Number.isFinite(end)) {
    const back = tl.find((t) => t.tSec >= end && t.availability >= targets.availability);
    if (back) recoverySec = back.tSec - end;
  }
  const passed = availabilityOk && p99Ok;
  const summary = passed
    ? 'The design rode out every failure within its targets.'
    : [
        !availabilityOk &&
          `availability fell to ${formatSloValue('availability', minAvailability)} (target ≥ ${formatSloValue('availability', targets.availability)})`,
        !p99Ok &&
          `p99 reached ${formatSloValue('p99', maxP99Ms)} (target ≤ ${formatSloValue('p99', targets.p99Ms)})`,
      ]
        .filter(Boolean)
        .join('; ')
        .replace(/^./, (c) => c.toUpperCase()) + '.';
  return {
    events,
    targets,
    minAvailability,
    maxP99Ms,
    availabilityOk,
    p99Ok,
    ...(recoverySec !== undefined ? { recoverySec } : {}),
    markers,
    passed,
    summary,
  };
}

export function chaosScore(v: ChaosVerdict): number {
  return (v.availabilityOk ? 60 : 0) + (v.p99Ok ? 40 : 0);
}
