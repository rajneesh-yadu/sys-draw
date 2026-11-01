/**
 * Failures over time (S11): a time-stepped run with 1 s ticks (coarser when the run is longer
 * than `maxTimelineTicks`). Every tick re-uses the analytical model (`evaluate`) under that
 * tick's conditions, and carries state from tick to tick:
 *
 * - chaos events switch on/off (ChaosEvent.atSec / durationSec);
 * - load balancers stop sending to a dead target only after their health checks notice
 *   (interval × unhealthy threshold); clients leave a dead region only after the DNS TTL;
 * - queues: a saturated `queue` node's backlog grows by (λ − capacity) per second and drains when
 *   capacity returns; its wait = backlog ÷ capacity;
 * - autoscaling: target tracking on the tick's load; new replicas serve after `warmupSec`,
 *   scale-in waits a 60 s cooldown;
 * - circuit breakers: open when failures over the last 10 s reach the threshold, fail fast while
 *   open, let one trial tick through after `breakerOpenSec` (half-open);
 * - retries and timeouts per edge (see model/evaluate.ts), seeded with the previous tick's error
 *   rates, so a retry storm can keep a system down after its trigger is gone.
 *
 * Deterministic: no randomness, same input ⇒ same timeline.
 */
import type {
  ChaosEvent,
  Finding,
  Graph,
  NodeTick,
  EdgeTick,
  Scenario,
  TimelineMarker,
  TimePoint,
} from '@/core';
import type { NetHop } from '../geo/distance';
import type { GeoModel } from '../geo/places';
import {
  evaluate,
  mixUnits,
  type Evaluation,
  type Perturbation,
  type QueueingCache,
} from '../model/evaluate';
import { isEmpty } from '../model/expr';
import { engineFinding } from '../model/findings';
import { fmt, pct } from '../model/format';
import { percentiles } from '../model/latency';
import type { FlowLoad } from '../model/load';
import { route, type RoutedFlow } from '../model/route';
import type { CompiledEdge, CompiledNode, EngineOptions, Model } from '../model/types';
import { effectiveReplicas } from '../queueing/node';
import { expQuantileFactor } from '../queueing/mmc';
import {
  BREAKER_WINDOW_SEC,
  coldStartMs,
  DEFAULT_BREAKER_OPEN_SEC,
  dnsTtlSec,
  eventLabel,
  eventWindow,
  healthCheckDelaySec,
  isActive,
  nodesInGroup,
  packetLossDelayMs,
  SCALE_IN_COOLDOWN_SEC,
} from './events';

export interface TimelineInput {
  model: Model;
  graph: Graph;
  scenario: Scenario;
  geo: GeoModel;
  loads: readonly FlowLoad[];
  options: EngineOptions;
}

export interface TimelineResult {
  timeline: TimePoint[];
  markers: TimelineMarker[];
  findings: Finding[];
  /** Seconds per tick (1 unless the run is longer than `maxTimelineTicks`). */
  tickSec: number;
}

/** What the active events do at one tick. */
interface Effects {
  active: string[];
  down: Set<string>;
  writeDown: Set<string>;
  slow: Map<string, number>;
  hot: Map<string, number>;
  nodeAdded: Map<string, number>;
  edgeAdded: Map<string, number>;
  partitions: [string, string][];
  spike: number;
  spikeByRegion: Map<string, number>;
  /** Cloud regions in an outage (region event or region group). */
  outageRegions: Set<string>;
}

type BreakerState = 'closed' | 'open' | 'half-open';
interface Breaker {
  edge: CompiledEdge;
  threshold: number;
  openSec: number;
  state: BreakerState;
  openedAt: number;
  history: { w: number; fail: number }[];
}

interface Scaler {
  node: CompiledNode;
  serving: number;
  pending: { readyAt: number; count: number; launchedAt: number }[];
  lowSince: number | undefined;
}

const LN100 = expQuantileFactor(0.99);
const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
const mul = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 1) * v);

export function runTimeline(input: TimelineInput): TimelineResult {
  const { model, graph, scenario, geo, loads, options } = input;
  const tickSec = Math.max(1, Math.ceil(scenario.durationSec / options.maxTimelineTicks));
  const nTicks = Math.max(1, Math.ceil(scenario.durationSec / tickSec));
  const events = scenario.events;
  const bytes = scenario.payloadBytes.req + scenario.payloadBytes.res;

  const nodeName = (id: string) => model.nodes.get(id)?.label ?? id;
  const edgeName = (id: string) => {
    const e = model.edges.get(id);
    return e ? `${nodeName(e.source)} → ${nodeName(e.target)}` : id;
  };
  const groupById = new Map(graph.groups.map((g) => [g.id, g]));
  const names = {
    node: nodeName,
    edge: edgeName,
    group: (id: string) => groupById.get(id)?.label ?? id,
  };
  const groupMembers = new Map<string, string[]>();
  const membersOf = (gid: string) => {
    let m = groupMembers.get(gid);
    if (!m) groupMembers.set(gid, (m = nodesInGroup(graph, gid)));
    return m;
  };
  const inRegion = (rid: string) =>
    [...model.nodes.values()].filter((n) => n.regionId === rid).map((n) => n.id);
  const allEdges = [...model.edges.keys()];

  const effectsAt = (t: number): Effects => {
    const fx: Effects = {
      active: [],
      down: new Set(),
      writeDown: new Set(),
      slow: new Map(),
      hot: new Map(),
      nodeAdded: new Map(),
      edgeAdded: new Map(),
      partitions: [],
      spike: 1,
      spikeByRegion: new Map(),
      outageRegions: new Set(),
    };
    for (const ev of events) {
      if (!isActive(ev, t)) continue;
      fx.active.push(ev.id);
      switch (ev.kind) {
        case 'nodeOutage':
          fx.down.add(ev.nodeId);
          break;
        case 'groupOutage': {
          for (const id of membersOf(ev.groupId)) fx.down.add(id);
          const g = groupById.get(ev.groupId);
          if (g?.kind === 'region' && g.regionId !== undefined) fx.outageRegions.add(g.regionId);
          break;
        }
        case 'regionOutage':
          for (const id of inRegion(ev.regionId)) fx.down.add(id);
          fx.outageRegions.add(ev.regionId);
          break;
        case 'trafficSpike':
          if (ev.regionId === undefined) fx.spike *= ev.multiplier;
          else mul(fx.spikeByRegion, ev.regionId, ev.multiplier);
          break;
        case 'packetLoss': {
          const ms = packetLossDelayMs(ev.lossRate, bytes);
          for (const id of ev.edgeId ? [ev.edgeId] : allEdges) add(fx.edgeAdded, id, ms);
          break;
        }
        case 'latencyInjection':
          if (ev.nodeId) add(fx.nodeAdded, ev.nodeId, ev.addedMs);
          if (ev.edgeId) add(fx.edgeAdded, ev.edgeId, ev.addedMs);
          if (!ev.nodeId && !ev.edgeId)
            for (const id of allEdges) add(fx.edgeAdded, id, ev.addedMs);
          break;
        case 'networkPartition':
          fx.partitions.push([ev.regionA, ev.regionB]);
          break;
        case 'hotKey':
          fx.hot.set(ev.nodeId, Math.max(fx.hot.get(ev.nodeId) ?? 0, ev.share));
          break;
        case 'dependencySlow':
          mul(fx.slow, ev.nodeId, ev.factor);
          break;
        case 'diskFull':
          fx.writeDown.add(ev.nodeId);
          break;
        case 'coldStartBurst': {
          const w = eventWindow(ev);
          // Share of requests still landing on a cold instance, fading 1 → 0 over the window.
          const share = Math.max(0, 1 - (t - w.start) / (w.end - w.start));
          const targets = ev.nodeId
            ? [ev.nodeId]
            : [...model.nodes.values()].filter((n) => n.category === 'compute').map((n) => n.id);
          for (const id of targets) {
            const n = model.nodes.get(id);
            if (n?.kind === 'service') add(fx.nodeAdded, id, coldStartMs(ev, n) * share);
          }
          break;
        }
      }
    }
    return fx;
  };

  // ── Routing variants (LB evictions, DNS failover), cached by key ──
  const lbs = [...model.nodes.values()].filter((n) => n.behaviors.includes('loadBalancer'));
  const ttl = dnsTtlSec(model);
  const routeCache = new Map<string, RoutedFlow[]>();
  const routedFor = (evicted: ReadonlySet<string>, unhealthy: ReadonlySet<string>) => {
    const key = `${[...evicted].sort().join(',')}|${[...unhealthy].sort().join(',')}`;
    let r = routeCache.get(key);
    if (r) return { key, routed: r };
    let m: Model = model;
    if (evicted.size > 0) {
      const out = new Map<string, readonly CompiledEdge[]>();
      for (const [id, list] of model.out)
        out.set(
          id,
          list.filter((e) => !evicted.has(e.id)),
        );
      m = { ...model, out };
    }
    const g: GeoModel = { ...geo, unhealthy, issues: [] };
    const plan = route(loads, m, options, g);
    r = plan.flows.map((f) => ({ ...f, rps: isEmpty(f.expr) ? 0 : f.rps }));
    routeCache.set(key, r);
    return { key, routed: r };
  };

  const spikeOf = (f: RoutedFlow, fx: Effects): number => {
    if (fx.spikeByRegion.size === 0 || f.regionId !== undefined)
      return fx.spike * (f.regionId !== undefined ? (fx.spikeByRegion.get(f.regionId) ?? 1) : 1);
    const load = loads.find((l) => l.flow.id === f.flowId);
    const total = load?.byRegion.reduce((s, r) => s + r.rps, 0) ?? 0;
    if (!load || total <= 0) return fx.spike;
    const w = load.byRegion.reduce(
      (s, r) => s + r.rps * (fx.spikeByRegion.get(r.regionId) ?? 1),
      0,
    );
    return fx.spike * (w / total);
  };

  // ── Baseline (before any event): steady-state autoscaling, no backlog. ──
  const base = routedFor(new Set(), new Set());
  const baseline = evaluate(model, base.routed, options, 0);

  const scalers = new Map<string, Scaler>();
  for (const n of model.nodes.values()) {
    if (n.kind !== 'service' || !n.autoscale || n.scale.platform) continue;
    scalers.set(n.id, {
      node: n,
      serving: baseline.stats.get(n.id)?.replicas ?? n.replicas,
      pending: [],
      lowSince: undefined,
    });
  }
  const breakers = new Map<string, Breaker>();
  for (const e of model.edges.values()) {
    const th = e.config.breakerErrorThreshold;
    if (th === undefined) continue;
    breakers.set(e.id, {
      edge: e,
      threshold: th,
      openSec: e.config.breakerOpenSec ?? DEFAULT_BREAKER_OPEN_SEC,
      state: 'closed',
      openedAt: 0,
      history: [],
    });
  }
  const windowTicks = Math.max(1, Math.round(BREAKER_WINDOW_SEC / tickSec));
  const backlog = new Map<string, number>();
  const downSince = new Map<string, number>();
  const outageSince = new Map<string, number>();
  let evicted = new Set<string>();
  let unhealthy = new Set<string>();
  let seedErrors: ReadonlyMap<string, number> = baseline.errors;

  const markers: TimelineMarker[] = [];
  for (const ev of events) {
    const w = eventWindow(ev);
    const label = eventLabel(ev, names);
    const targets = eventTargets(ev);
    if (w.start < scenario.durationSec)
      markers.push({
        tSec: w.start,
        kind: 'chaos-start',
        label,
        targetIds: targets,
        eventId: ev.id,
      });
    if (w.end < scenario.durationSec)
      markers.push({
        tSec: w.end,
        kind: 'chaos-end',
        label: `${label} — over`,
        targetIds: targets,
        eventId: ev.id,
      });
  }

  const timeline: TimePoint[] = [];
  const attemptsRatio = new Map<string, number>();
  const hitWhileDown = new Map<string, number>(); // node → peak failed rps while down
  let last: { sig: string; ev: Evaluation } | undefined;
  const queueCache: QueueingCache = new WeakMap();
  // Patched nodes are rebuilt per tick; reuse the same object while its patch is unchanged.
  const patchMemo = new Map<string, { key: string; node: CompiledNode }>();

  for (let i = 0; i < nTicks; i++) {
    const t = i * tickSec;
    const fx = effectsAt(t);

    // Down streaks and outage streaks.
    for (const id of fx.down) if (!downSince.has(id)) downSince.set(id, t);
    for (const id of [...downSince.keys()]) if (!fx.down.has(id)) downSince.delete(id);
    for (const r of fx.outageRegions) if (!outageSince.has(r)) outageSince.set(r, t);
    for (const r of [...outageSince.keys()]) if (!fx.outageRegions.has(r)) outageSince.delete(r);

    // Health checks: an LB drops targets that have been down for interval × threshold, as long
    // as one of its targets is still up (with every target down it keeps trying them all).
    const nextEvicted = new Set<string>();
    for (const lb of lbs) {
      if (fx.down.has(lb.id)) continue;
      const outs = model.out.get(lb.id) ?? [];
      if (!outs.some((e) => !fx.down.has(e.target))) continue;
      const delay = healthCheckDelaySec(lb);
      for (const e of outs) {
        const since = downSince.get(e.target);
        if (since !== undefined && t - since >= delay) nextEvicted.add(e.id);
      }
    }
    for (const id of nextEvicted) {
      if (evicted.has(id)) continue;
      const e = model.edges.get(id) as CompiledEdge;
      const lb = model.nodes.get(e.source) as CompiledNode;
      markers.push({
        tSec: t,
        kind: 'detected',
        label: `${lb.label} stops sending to ${nodeName(e.target)} (health checks: ${fmt(healthCheckDelaySec(lb))} s)`,
        targetIds: [e.source, e.target, e.id],
      });
    }
    evicted = nextEvicted;
    const nextUnhealthy = new Set<string>();
    for (const [r, since] of outageSince) if (t - since >= ttl) nextUnhealthy.add(r);
    if (geo.active) {
      for (const r of nextUnhealthy) {
        if (!unhealthy.has(r))
          markers.push({
            tSec: t,
            kind: 'failover',
            label: `DNS fails over away from ${r} (TTL ${fmt(ttl)} s)`,
            targetIds: inRegion(r),
          });
      }
    }
    unhealthy = nextUnhealthy;

    // Autoscaling: replicas that finished warming up start serving.
    for (const sc of scalers.values()) {
      const ready = sc.pending.filter((p) => p.readyAt <= t + 1e-9);
      if (ready.length === 0) continue;
      sc.pending = sc.pending.filter((p) => p.readyAt > t + 1e-9);
      const n = ready.reduce((s, p) => s + p.count, 0);
      sc.serving += n;
      markers.push({
        tSec: t,
        kind: 'scale-out',
        label: `${sc.node.label}: +${n} replica${n === 1 ? '' : 's'} ready (${sc.serving} serving; launched at ${fmt(ready[0]?.launchedAt ?? t)} s)`,
        targetIds: [sc.node.id],
      });
    }
    // Breakers whose open time is over let a trial tick through.
    for (const b of breakers.values()) {
      if (b.state === 'open' && t - b.openedAt >= b.openSec) b.state = 'half-open';
    }

    // Per-tick node changes.
    const patched = new Map<string, CompiledNode>();
    const patch = (id: string, f: (n: CompiledNode) => CompiledNode) => {
      const cur = patched.get(id) ?? model.nodes.get(id);
      if (cur && cur.kind === 'service') patched.set(id, f(cur));
    };
    for (const [id, factor] of fx.slow)
      patch(id, (n) => ({
        ...n,
        serviceTimeMs: {
          read: n.serviceTimeMs.read * factor,
          write: n.serviceTimeMs.write * factor,
        },
        ...(n.responseServiceMs
          ? {
              responseServiceMs: {
                read: n.responseServiceMs.read * factor,
                write: n.responseServiceMs.write * factor,
              },
            }
          : {}),
      }));
    for (const [id, share] of fx.hot)
      patch(id, (n) =>
        n.scale.shards > 1
          ? { ...n, scale: { ...n.scale, hotShardShare: Math.max(n.scale.hotShardShare, share) } }
          : n,
      );
    for (const sc of scalers.values())
      patch(sc.node.id, (n) => ({ ...n, replicas: sc.serving, autoscale: undefined }));
    // Keep one object per distinct patch so the queueing cache recognises it next tick.
    for (const [id, n] of patched) {
      const key = JSON.stringify([fx.slow.get(id), fx.hot.get(id), scalers.get(id)?.serving]);
      const memo = patchMemo.get(id);
      if (memo && memo.key === key) patched.set(id, memo.node);
      else patchMemo.set(id, { key, node: n });
    }

    const waits = new Map<string, number>();
    for (const [id, b] of backlog) {
      const cap = baselineCap(id);
      if (b > 0 && cap > 0) waits.set(id, (b / cap) * 1000);
    }
    function baselineCap(id: string): number {
      const s = last?.ev.stats.get(id) ?? baseline.stats.get(id);
      return s && Number.isFinite(s.capacityRps) ? s.capacityRps : 0;
    }

    const openEdges = new Set(
      [...breakers.values()].filter((b) => b.state === 'open').map((b) => b.edge.id),
    );
    const partitioned =
      fx.partitions.length > 0
        ? (hop: NetHop) =>
            hop.ends !== undefined &&
            fx.partitions.some(
              ([a, b]) =>
                (hop.ends?.[0] === a && hop.ends[1] === b) ||
                (hop.ends?.[0] === b && hop.ends[1] === a),
            )
        : undefined;
    const pert: Perturbation = {
      down: fx.down,
      writeDown: fx.writeDown,
      nodes: patched,
      extraWaitMs: waits,
      nodeAddedMs: fx.nodeAdded,
      edgeAddedMs: fx.edgeAdded,
      openEdges,
      ...(partitioned ? { partitioned } : {}),
    };

    const { key: routeKey, routed: routedBase } = routedFor(evicted, unhealthy);
    const routed = routedBase.map((f) => ({ ...f, rps: f.rps * spikeOf(f, fx) }));

    const sig = JSON.stringify([
      routeKey,
      fx.active,
      [...fx.nodeAdded].map(([k, v]) => [k, +v.toPrecision(9)]),
      [...scalers.values()].map((s) => s.serving),
      [...breakers.values()].map((b) => b.state),
      [...waits].map(([k, v]) => [k, +v.toPrecision(9)]),
    ]);
    const stable =
      last !== undefined &&
      last.sig === sig &&
      [...last.ev.errors].every(([k, v]) => Math.abs(v - (seedErrors.get(k) ?? 0)) < 1e-9);
    const ev =
      stable && last ? last.ev : evaluate(model, routed, options, 0, pert, seedErrors, queueCache);
    last = { sig, ev };
    seedErrors = ev.errors;

    // ── Record the tick. ──
    const all = mixUnits(ev.units, options.maxBranches);
    const pctl = percentiles(all.dist);
    const nodes: Record<string, NodeTick> = {};
    for (const [id, s] of ev.stats) {
      const isDown = fx.down.has(id);
      const writeErr = fx.writeDown.has(id) && s.lambda > 0 ? s.rps.write / s.lambda : 0;
      const err = isDown ? 1 : Math.min(1, s.errorRate + writeErr);
      const affected =
        fx.slow.has(id) ||
        fx.hot.has(id) ||
        fx.writeDown.has(id) ||
        (fx.nodeAdded.get(id) ?? 0) > 0 ||
        (waits.get(id) ?? 0) > 0;
      nodes[id] = {
        utilization: s.utilization,
        rpsIn: s.lambda,
        errorRate: err,
        p99Ms: isDown ? 0 : (s.responseMs.mean + (fx.nodeAdded.get(id) ?? 0)) * LN100,
        replicas: s.replicas,
        state: isDown ? 'down' : err >= 0.01 || affected ? 'degraded' : 'up',
      };
      if (isDown && s.lambda > 0)
        hitWhileDown.set(id, Math.max(hitWhileDown.get(id) ?? 0, s.lambda));
    }
    const edges: Record<string, EdgeTick> = {};
    for (const id of model.edges.keys()) {
      const a = ev.edgeAttempts.get(id);
      const b = breakers.get(id);
      edges[id] = {
        rps: ev.edgeRps.get(id) ?? 0,
        errorRate: a && a.w > 0 ? Math.min(1, Math.max(0, a.fail / a.w)) : 0,
        ...(b ? { breaker: b.state } : {}),
      };
      if (a && a.first > 0 && (model.edges.get(id)?.config.retries ?? 0) > 0)
        attemptsRatio.set(id, Math.max(attemptsRatio.get(id) ?? 1, a.w / a.first));
    }
    const offered = all.w;
    const availability = offered > 0 ? Math.min(1, Math.max(0, 1 - all.errorRate)) : 1;
    timeline.push({
      tSec: t,
      rps: offered,
      p50Ms: pctl.p50,
      p99Ms: pctl.p99,
      errorRate: 1 - availability,
      availability,
      nodes,
      edges,
      activeEventIds: fx.active,
    });

    // ── Carry state to the next tick. ──
    for (const [id, s] of ev.stats) {
      const node = s.node;
      if (fx.down.has(id) || node.saturationBehavior !== 'queue' || node.kind !== 'service') {
        backlog.delete(id);
        continue;
      }
      if (!Number.isFinite(s.capacityRps)) continue;
      const b = Math.max(0, (backlog.get(id) ?? 0) + (s.lambda - s.capacityRps) * tickSec);
      if (b > 0) backlog.set(id, b);
      else backlog.delete(id);
    }

    for (const sc of scalers.values()) {
      if (fx.down.has(sc.node.id)) continue;
      const s = ev.stats.get(sc.node.id);
      if (!s) continue;
      const cur = patched.get(sc.node.id) ?? sc.node;
      const want = effectiveReplicas({ ...cur, autoscale: sc.node.autoscale }, s.rps).replicas;
      const warming = sc.pending.reduce((x, p) => x + p.count, 0);
      const policy = sc.node.autoscale;
      if (!policy) continue;
      if (want > sc.serving + warming) {
        const count = want - sc.serving - warming;
        sc.pending.push({ readyAt: t + Math.max(tickSec, policy.warmupSec), count, launchedAt: t });
        sc.lowSince = undefined;
      } else if (want < sc.serving) {
        sc.lowSince ??= t;
        if (t - sc.lowSince >= SCALE_IN_COOLDOWN_SEC) {
          const to = Math.max(want, policy.min);
          markers.push({
            tSec: t,
            kind: 'scale-in',
            label: `${sc.node.label}: scaled in ${sc.serving} → ${to} replicas`,
            targetIds: [sc.node.id],
          });
          sc.serving = to;
          sc.pending = [];
          sc.lowSince = undefined;
        }
      } else {
        sc.lowSince = undefined;
      }
    }

    for (const b of breakers.values()) {
      const a = ev.edgeAttempts.get(b.edge.id);
      const w = a?.w ?? 0;
      const fail = a?.fail ?? 0;
      if (b.state === 'half-open') {
        if (w > 0 && fail / w >= b.threshold) {
          b.state = 'open';
          b.openedAt = t + tickSec; // takes effect next tick
          markers.push({
            tSec: t,
            kind: 'breaker-open',
            label: `Breaker on ${edgeName(b.edge.id)} re-opens (trial failed)`,
            targetIds: [b.edge.id],
          });
        } else {
          b.state = 'closed';
          b.history = [];
          markers.push({
            tSec: t,
            kind: 'breaker-close',
            label: `Breaker on ${edgeName(b.edge.id)} closes`,
            targetIds: [b.edge.id],
          });
        }
      } else if (b.state === 'closed') {
        b.history.push({ w, fail });
        if (b.history.length > windowTicks) b.history.shift();
        const W = b.history.reduce((s, h) => s + h.w, 0);
        const F = b.history.reduce((s, h) => s + h.fail, 0);
        if (W > 0 && F / W >= b.threshold) {
          b.state = 'open';
          b.openedAt = t + tickSec; // takes effect next tick
          markers.push({
            tSec: t,
            kind: 'breaker-open',
            label: `Breaker on ${edgeName(b.edge.id)} opens (${pct(F / W)} failed over ${fmt(BREAKER_WINDOW_SEC)} s)`,
            targetIds: [b.edge.id],
          });
        }
      }
    }
  }

  markers.sort((a, b) => a.tSec - b.tSec);
  return {
    timeline,
    markers,
    findings: timelineFindings(timeline, hitWhileDown, attemptsRatio, model, events, names),
    tickSec,
  };
}

function eventTargets(ev: ChaosEvent): string[] {
  const ids: string[] = [];
  if ('nodeId' in ev && ev.nodeId) ids.push(ev.nodeId);
  if ('edgeId' in ev && ev.edgeId) ids.push(ev.edgeId);
  if ('groupId' in ev) ids.push(ev.groupId);
  return ids;
}

function timelineFindings(
  timeline: readonly TimePoint[],
  hitWhileDown: ReadonlyMap<string, number>,
  attemptsRatio: ReadonlyMap<string, number>,
  model: Model,
  events: readonly ChaosEvent[],
  names: { node(id: string): string; edge(id: string): string },
): Finding[] {
  const out: Finding[] = [];
  const first = timeline[0];
  if (!first) return out;

  // Outage windows (availability < 50 %).
  let start: number | undefined;
  let worst = 1;
  const windows: { from: number; to: number | undefined; worst: number }[] = [];
  for (const p of timeline) {
    if (p.availability < 0.5) {
      start ??= p.tSec;
      worst = Math.min(worst, p.availability);
    } else if (start !== undefined) {
      windows.push({ from: start, to: p.tSec, worst });
      start = undefined;
      worst = 1;
    }
  }
  if (start !== undefined) windows.push({ from: start, to: undefined, worst });
  const spof = [...hitWhileDown.keys()];
  for (const w of windows) {
    out.push(
      engineFinding(
        'engine.chaos',
        'error',
        'Outage',
        `Availability fell to ${pct(w.worst)} from ${fmt(w.from)} s ${w.to === undefined ? 'until the end of the run' : `to ${fmt(w.to)} s (${fmt(w.to - w.from)} s)`}.` +
          (spof.length > 0
            ? ` Requests kept reaching ${spof.map((id) => `"${names.node(id)}"`).join(', ')} while down — nothing took over (single point of failure).`
            : ''),
        spof,
      ),
    );
  }

  // Dips that recovered.
  const firstEvent = Math.min(...events.map((e) => e.atSec));
  const dipStart = timeline.find((p) => p.tSec >= firstEvent && p.availability < 0.99);
  if (dipStart && windows.length === 0) {
    const low = timeline.reduce((m, p) => (p.availability < m.availability ? p : m), dipStart);
    const back = timeline.find((p) => p.tSec > low.tSec && p.availability >= 0.99);
    out.push(
      engineFinding(
        'engine.chaos',
        'warning',
        back ? 'Dip and recovery' : 'Degraded until the end',
        `Availability dipped to ${pct(low.availability)} at ${fmt(low.tSec)} s` +
          (back
            ? ` and recovered to ≥ 99% at ${fmt(back.tSec)} s (${fmt(back.tSec - dipStart.tSec)} s after the dip began).`
            : ' and had not recovered by the end of the run.'),
        [],
      ),
    );
  }

  for (const [id, ratio] of attemptsRatio) {
    if (ratio < 1.5) continue;
    const e = model.edges.get(id);
    out.push(
      engineFinding(
        'engine.chaos',
        'warning',
        'Retry storm',
        `Retries on ${names.edge(id)} multiplied its calls up to ${fmt(ratio)}× (${e?.config.retries ?? 0} retries; A = (1 − f^(r+1)) / (1 − f) with f the failure rate), adding load exactly when the target is struggling.`,
        [id],
      ),
    );
  }

  for (const ev of events) {
    if (ev.kind !== 'hotKey') continue;
    const n = model.nodes.get(ev.nodeId);
    if (n && n.scale.shards <= 1) {
      out.push(
        engineFinding(
          'engine.chaos',
          'info',
          'Hot key on an unsharded node',
          `"${n.label}" is not sharded, so one instance already serves every key: the hot key adds no extra hot spot here. Shard it to see one shard take the heat.`,
          [n.id],
        ),
      );
    }
  }
  return out;
}
