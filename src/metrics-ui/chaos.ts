/**
 * Chaos events in the UI (S11): what each kind needs from the user, readable labels, and building
 * a validated event from the editor's fields. Pure (no React). Events are core `ChaosEvent`s; the
 * engine decides what they do.
 */
import {
  ChaosEventSchema,
  formatPercent,
  type ChaosEvent,
  type ChaosEventKind,
  type Graph,
  type TimelineMarker,
} from '@/store';

/** Playback speed: one simulated second per this many ms. */
export const PLAYBACK_MS_PER_TICK = 150;

/** Which board item an event points at. `?` = optional (empty = everything). */
export type ChaosTarget =
  'node' | 'node?' | 'group' | 'region' | 'region?' | 'edge?' | 'node-or-edge?' | 'region-pair';

export interface ChaosParam {
  key: 'multiplier' | 'lossRate' | 'addedMs' | 'share' | 'factor';
  label: string;
  default?: number;
  min: number;
  max?: number;
  step: number;
  optional?: boolean;
}

export interface ChaosKindMeta {
  label: string;
  help: string;
  target: ChaosTarget;
  params: ChaosParam[];
}

export const CHAOS_KIND_META: Record<ChaosEventKind, ChaosKindMeta> = {
  nodeOutage: {
    label: 'Component down',
    help: 'One component stops answering. Load balancers notice after their health checks.',
    target: 'node',
    params: [],
  },
  groupOutage: {
    label: 'Zone / group down',
    help: 'An availability zone, region group, VPC… goes down with everything inside it.',
    target: 'group',
    params: [],
  },
  regionOutage: {
    label: 'Region down',
    help: 'A whole cloud region fails. Users move elsewhere only after the DNS TTL.',
    target: 'region',
    params: [],
  },
  trafficSpike: {
    label: 'Traffic spike',
    help: 'Traffic multiplies (a launch, a viral post), everywhere or from one user region.',
    target: 'region?',
    params: [{ key: 'multiplier', label: 'Multiplier ×', default: 3, min: 0.01, step: 0.5 }],
  },
  hotKey: {
    label: 'Hot key',
    help: 'One key (celebrity user, viral post) carries a share of the traffic: its shard runs hot.',
    target: 'node',
    params: [{ key: 'share', label: 'Share of traffic', default: 0.5, min: 0, max: 1, step: 0.05 }],
  },
  packetLoss: {
    label: 'Packet loss',
    help: 'Lost TCP segments are resent after a 200 ms timeout, so some calls get slower.',
    target: 'edge?',
    params: [{ key: 'lossRate', label: 'Loss rate', default: 0.02, min: 0, max: 1, step: 0.01 }],
  },
  latencyInjection: {
    label: 'Latency injection',
    help: 'Adds a fixed delay to a connection or a component’s answers (does not use its CPU).',
    target: 'node-or-edge?',
    params: [{ key: 'addedMs', label: 'Added ms', default: 200, min: 1, step: 50 }],
  },
  dependencySlow: {
    label: 'Dependency slow',
    help: 'The component itself works slower (GC pauses, noisy neighbour): its capacity drops.',
    target: 'node',
    params: [{ key: 'factor', label: 'Slower ×', default: 5, min: 0.01, step: 0.5 }],
  },
  diskFull: {
    label: 'Disk full',
    help: 'Writes fail; reads still work.',
    target: 'node',
    params: [],
  },
  coldStartBurst: {
    label: 'Cold start burst',
    help: 'Instances restart cold (deploy, scale from zero): requests wait, fading out over the event.',
    target: 'node?',
    params: [{ key: 'addedMs', label: 'Cold start ms', min: 1, step: 100, optional: true }],
  },
  networkPartition: {
    label: 'Network partition',
    help: 'Two cloud regions cannot reach each other.',
    target: 'region-pair',
    params: [],
  },
};

/** Cloud regions used on the board (Region groups with a region set), sorted. */
export function boardRegions(graph: Pick<Graph, 'groups'>): string[] {
  return [
    ...new Set(graph.groups.map((g) => g.regionId).filter((r): r is string => r !== undefined)),
  ].sort();
}

export function chaosEventLabel(ev: ChaosEvent, graph: Graph): string {
  const node = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;
  const group = (id: string) => graph.groups.find((g) => g.id === id)?.label ?? id;
  const edge = (id: string) => {
    const e = graph.edges.find((x) => x.id === id);
    return e ? `${node(e.source)} → ${node(e.target)}` : id;
  };
  switch (ev.kind) {
    case 'nodeOutage':
      return `${node(ev.nodeId)} down`;
    case 'groupOutage':
      return `${group(ev.groupId)} down`;
    case 'regionOutage':
      return `Region ${ev.regionId} down`;
    case 'trafficSpike':
      return `Traffic ×${ev.multiplier}${ev.regionId ? ` (${ev.regionId})` : ''}`;
    case 'packetLoss':
      return `${formatPercent(ev.lossRate)} packet loss${ev.edgeId ? ` on ${edge(ev.edgeId)}` : ''}`;
    case 'latencyInjection':
      return `+${ev.addedMs} ms on ${ev.nodeId ? node(ev.nodeId) : ev.edgeId ? edge(ev.edgeId) : 'every connection'}`;
    case 'networkPartition':
      return `Partition ${ev.regionA} ↮ ${ev.regionB}`;
    case 'hotKey':
      return `Hot key on ${node(ev.nodeId)} (${formatPercent(ev.share)})`;
    case 'dependencySlow':
      return `${node(ev.nodeId)} ${ev.factor}× slower`;
    case 'diskFull':
      return `${node(ev.nodeId)} disk full`;
    case 'coldStartBurst':
      return `Cold starts${ev.nodeId ? ` on ${node(ev.nodeId)}` : ''}`;
  }
}

/** "at 20 s for 30 s" / "at 20 s until the end". */
export function chaosWhen(ev: ChaosEvent): string {
  return `at ${ev.atSec} s ${ev.durationSec !== undefined ? `for ${ev.durationSec} s` : ev.kind === 'coldStartBurst' ? 'fading over 30 s' : 'until the end'}`;
}

export interface ChaosDraft {
  kind: ChaosEventKind;
  atSec: string;
  durationSec: string;
  /** Node / group / edge id or region id (for region-pair: region A). */
  target: string;
  /** Region B of a partition. */
  target2: string;
  params: Partial<Record<ChaosParam['key'], string>>;
}

export function emptyDraft(kind: ChaosEventKind = 'nodeOutage'): ChaosDraft {
  const params: ChaosDraft['params'] = {};
  for (const p of CHAOS_KIND_META[kind].params)
    if (p.default !== undefined) params[p.key] = String(p.default);
  return { kind, atSec: '10', durationSec: '', target: '', target2: '', params };
}

function randomBody(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes]
    .map((b) => b.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 12);
}

/** Builds a validated event from the editor's text fields, or a readable reason. */
export function buildChaosEvent(
  d: ChaosDraft,
  newId: () => string = () => `evt_${randomBody()}`,
): { ok: true; event: ChaosEvent } | { ok: false; reason: string } {
  const meta = CHAOS_KIND_META[d.kind];
  const num = (s: string | undefined) =>
    s === undefined || s.trim() === '' ? undefined : Number(s);
  const raw: Record<string, unknown> = { id: newId(), kind: d.kind, atSec: num(d.atSec) ?? 0 };
  const dur = num(d.durationSec);
  if (dur !== undefined) raw.durationSec = dur;
  const t = d.target.trim();
  switch (meta.target) {
    case 'node':
      if (!t) return { ok: false, reason: 'Pick a component.' };
      raw.nodeId = t;
      break;
    case 'node?':
      if (t) raw.nodeId = t;
      break;
    case 'group':
      if (!t) return { ok: false, reason: 'Pick a group (zone, region, VPC…).' };
      raw.groupId = t;
      break;
    case 'region':
      if (!t) return { ok: false, reason: 'Pick a region.' };
      raw.regionId = t;
      break;
    case 'region?':
      if (t) raw.regionId = t;
      break;
    case 'edge?':
      if (t) raw.edgeId = t;
      break;
    case 'node-or-edge?':
      if (t.startsWith('edge_')) raw.edgeId = t;
      else if (t) raw.nodeId = t;
      break;
    case 'region-pair':
      if (!t || !d.target2.trim()) return { ok: false, reason: 'Pick two regions.' };
      if (t === d.target2.trim()) return { ok: false, reason: 'Pick two different regions.' };
      raw.regionA = t;
      raw.regionB = d.target2.trim();
      break;
  }
  for (const p of meta.params) {
    const v = num(d.params[p.key]);
    if (v === undefined) {
      if (p.optional) continue;
      return { ok: false, reason: `${p.label} is required.` };
    }
    raw[p.key] = v;
  }
  const res = ChaosEventSchema.safeParse(raw);
  if (!res.success) {
    const issue = res.error.issues[0];
    return {
      ok: false,
      reason: `${issue?.path.join('.') || 'event'}: ${issue?.message ?? 'invalid'}`,
    };
  }
  return { ok: true, event: res.data };
}

/** Event spans for the shaded areas: [start, end) per chaos event, clipped to the run. */
export function eventSpans(
  markers: readonly TimelineMarker[],
  endSec: number,
): { eventId: string; label: string; from: number; to: number }[] {
  const spans = new Map<string, { eventId: string; label: string; from: number; to: number }>();
  for (const m of markers) {
    if (!m.eventId) continue;
    if (m.kind === 'chaos-start')
      spans.set(m.eventId, { eventId: m.eventId, label: m.label, from: m.tSec, to: endSec });
    if (m.kind === 'chaos-end') {
      const s = spans.get(m.eventId);
      if (s) s.to = m.tSec;
    }
  }
  return [...spans.values()];
}
