/**
 * One analytical run: compile → load → route → queueing (fixed point on rejections) →
 * behaviors finish → latency composition → SimResult. Pure and deterministic (no randomness;
 * `scenario.seed` matters only for later stochastic modes).
 */
import type {
  EdgeMetrics,
  Finding,
  FlowMetrics,
  NodeMetrics,
  RegionMetrics,
  SimResult,
} from '@/core';
import { userRegion } from '@/registry';
import { behaviorsOf } from './behaviors';
import { netBetween, type NetHop } from './geo/distance';
import { buildGeoModel, type GeoModel } from './geo/places';
import { compile, isDataStore, type ComponentSource } from './model/compile';
import { engineFinding } from './model/findings';
import { type Expr, isEmpty } from './model/expr';
import { fmt } from './model/format';
import { percentiles } from './model/latency';
import { generateLoad, inferFlow } from './model/load';
import { route } from './model/route';
import { DEFAULT_ENGINE_OPTIONS, type EngineOptions, type SimInput } from './model/types';
import { evaluate, mixUnits } from './model/evaluate';
import { runTimeline } from './chaos/timeline';
import { expQuantileFactor } from './queueing/mmc';
import { FALLBACK_PRICING, nodeCost, SECONDS_PER_MONTH, type Pricing } from './cost/cost';
import type { RoutedFlow } from './model/route';

/** Inter-region transfer is priced at this fraction of internet egress (≈ $0.02 vs $0.09 / GB). */
export const INTER_REGION_PRICE_FACTOR = 0.25;

/** Nodes at or above this utilisation are listed as bottlenecks. */
export const BOTTLENECK_UTILIZATION = 0.85;

/** Network hops of the most likely critical path, for explain strings. */
function criticalHops(e: Expr): NetHop[] {
  switch (e.k) {
    case 'visit':
      return [...(e.net ? [e.net] : []), ...criticalHops(e.then)];
    case 'seq':
      return e.items.flatMap(criticalHops);
    case 'choice': {
      const best = [...e.options].sort((a, b) => b.p - a.p)[0];
      return best ? criticalHops(best.expr) : [];
    }
    case 'async':
    case 'empty':
      return [];
  }
}

/** Share of requests first served in each cloud region (first placed node on the path). */
function entryShares(e: Expr, geo: GeoModel): Map<string, number> {
  switch (e.k) {
    case 'visit': {
      const p = geo.nodePlace.get(e.nodeId);
      return p ? new Map([[p.id, 1]]) : entryShares(e.then, geo);
    }
    case 'seq':
      for (const item of e.items) {
        const m = entryShares(item, geo);
        if (m.size > 0) return m;
      }
      return new Map();
    case 'choice': {
      const out = new Map<string, number>();
      for (const o of e.options) {
        for (const [k, v] of entryShares(o.expr, geo)) out.set(k, (out.get(k) ?? 0) + o.p * v);
      }
      return out;
    }
    case 'async':
    case 'empty':
      return new Map();
  }
}

interface EdgeNet {
  /** Σ λ and Σ λ·ms over traversals; plain sums for zero-traffic edges. */
  w: number;
  msW: number;
  n: number;
  ms: number;
  internetRps: number;
  interRegionRps: number;
  /** Explain of the heaviest traversal. */
  explain: string;
  explainW: number;
}

function collectNet(
  e: Expr,
  lambda: number,
  acc: Map<string, EdgeNet>,
  errors: ReadonlyMap<string, number>,
): void {
  switch (e.k) {
    case 'visit': {
      if (e.edgeId !== undefined && e.net) {
        const a = acc.get(e.edgeId) ?? {
          w: 0,
          msW: 0,
          n: 0,
          ms: 0,
          internetRps: 0,
          interRegionRps: 0,
          explain: '',
          explainW: -1,
        };
        a.w += lambda;
        a.msW += lambda * e.net.ms;
        a.n += 1;
        a.ms += e.net.ms;
        if (e.net.cls === 'internet') a.internetRps += lambda;
        if (e.net.cls === 'inter-region') a.interRegionRps += lambda;
        if (lambda > a.explainW) {
          a.explain = e.net.explain;
          a.explainW = lambda;
        }
        acc.set(e.edgeId, a);
      }
      collectNet(e.then, lambda * (1 - (errors.get(e.nodeId) ?? 0)), acc, errors);
      return;
    }
    case 'seq':
      for (const item of e.items) collectNet(item, lambda, acc, errors);
      return;
    case 'choice':
      for (const o of e.options) collectNet(o.expr, lambda * o.p, acc, errors);
      return;
    case 'async':
      collectNet(e.expr, lambda, acc, errors);
      return;
    case 'empty':
      return;
  }
}

/** The board provider's price table (falls back to generic list prices). */
function pricingOf(registry: ComponentSource, providerId: string | undefined): Pricing {
  const p = registry.get(providerId ?? 'generic', 'provider');
  return p ? { ...p.pricing } : { ...FALLBACK_PRICING };
}

export function simulate(
  input: SimInput,
  registry: ComponentSource,
  opts: Partial<EngineOptions> = {},
): SimResult {
  const options: EngineOptions = { ...DEFAULT_ENGINE_OPTIONS, ...opts };
  const { graph, scenario } = input;
  const model = compile(graph, registry);
  const geo = buildGeoModel(model, graph, scenario, registry, input.providerId);
  const flows = scenario.flows.length > 0 ? scenario.flows : [inferFlow(options)];
  const loads = generateLoad(scenario, flows);
  const plan = route(loads, model, options, geo);
  const routed: RoutedFlow[] = plan.flows.map((f) => ({ ...f, rps: isEmpty(f.expr) ? 0 : f.rps }));

  // Queueing + retries/timeouts/rejections (fixed point) — shared with every timeline tick.
  const ev = evaluate(model, routed, options, scenario.durationSec);
  const { stats, errors, edgeRps } = ev;

  for (const node of model.nodes.values()) {
    const s = stats.get(node.id);
    if (!s) continue;
    for (const b of behaviorsOf(node.behaviors)) {
      b.finish?.({
        node,
        stats: s,
        model,
        options,
        durationSec: scenario.durationSec,
        statsOf: (id) => stats.get(id),
      });
    }
  }

  const pricing = pricingOf(registry, input.providerId);
  let systemCost = 0;
  const perNode: Record<string, NodeMetrics> = {};
  for (const [id, s] of stats) {
    const cost = nodeCost(s.node, s, pricing, scenario.peakMultiplier);
    s.costPerMonth = cost.costPerMonth;
    if (s.node.kind === 'service') s.explain.costPerMonth = cost.explain;
    systemCost += cost.costPerMonth;
    const t = s.responseMs.mean;
    perNode[id] = {
      utilization: s.utilization,
      rpsIn: s.lambda,
      rpsOut: s.servedRps,
      queueDepth: s.queueDepth,
      latencyMs: {
        p50: t * expQuantileFactor(0.5),
        p95: t * expQuantileFactor(0.95),
        p99: t * expQuantileFactor(0.99),
      },
      errorRate: s.errorRate,
      ...(s.hitRate !== undefined ? { hitRate: s.hitRate } : {}),
      costPerMonth: s.costPerMonth,
      explain: s.explain,
    };
  }

  // Network per edge (S10): rps-weighted mean hop RTT, egress cost, replication lag.
  const netAcc = new Map<string, EdgeNet>();
  for (const f of routed) collectNet(f.expr, f.rps, netAcc, errors);
  const geoFindings: Finding[] = [];
  const bytesPerRequest = scenario.payloadBytes.req + scenario.payloadBytes.res;
  const perEdge: Record<string, EdgeMetrics> = {};
  for (const [id, e] of model.edges) {
    const rps = edgeRps.get(id) ?? 0;
    const net = netAcc.get(id);
    let latency = net ? (net.w > 0 ? net.msW / net.w : net.ms / net.n) : 0;
    const explain: Record<string, string> = {
      rps: `Requests per second routed over this connection = ${fmt(rps)}`,
      bytesPerSec: `rps × (request + response bytes) = ${fmt(rps)} × ${fmt(bytesPerRequest)} = ${fmt(rps * bytesPerRequest)} B/s`,
      latencyMs: net
        ? `${net.explain}${net.n > 1 ? ` (shown: mean over user regions weighted by rps = ${fmt(latency)} ms)` : ''}. Handshakes and protocol overhead come with protocols (S14).`
        : geo.active
          ? 'Both ends are in the same place (same region, or an unplaced component next to its caller): no propagation delay. Handshakes come with protocols (S14).'
          : 'No component is placed in a region, so network distance is 0 ms. Put servers in a Region group to simulate it.',
    };

    // Egress: internet (to users / edge) and inter-region transfer, at the AVERAGE rate.
    let cost = 0;
    if (net && (net.internetRps > 0 || net.interRegionRps > 0)) {
      const peak = scenario.peakMultiplier;
      const gb = (r: number, bytes: number) => ((r / peak) * bytes * SECONDS_PER_MONTH) / 1e9;
      const internetGb = gb(net.internetRps, scenario.payloadBytes.res);
      const interGb = gb(net.interRegionRps, bytesPerRequest);
      const interPrice = pricing.egressUsdPerGb * INTER_REGION_PRICE_FACTOR;
      cost = internetGb * pricing.egressUsdPerGb + interGb * interPrice;
      const parts: string[] = [];
      if (internetGb > 0)
        parts.push(
          `internet: ${fmt(net.internetRps)} rps ÷ peak ${fmt(peak)} × ${fmt(scenario.payloadBytes.res)} B response × ${fmt(SECONDS_PER_MONTH)} s = ${fmt(internetGb)} GB × $${fmt(pricing.egressUsdPerGb)}/GB`,
        );
      if (interGb > 0)
        parts.push(
          `inter-region: ${fmt(net.interRegionRps)} rps ÷ peak ${fmt(peak)} × ${fmt(bytesPerRequest)} B × ${fmt(SECONDS_PER_MONTH)} s = ${fmt(interGb)} GB × $${fmt(interPrice)}/GB`,
        );
      explain.costPerMonth = `Egress per month = ${parts.join(' + ')} = $${fmt(cost)}`;
    }

    // Replication lag: data store → data store across places.
    const src = model.nodes.get(e.source);
    const tgt = model.nodes.get(e.target);
    const a = geo.nodePlace.get(e.source);
    const b = geo.nodePlace.get(e.target);
    if (src && tgt && isDataStore(src) && isDataStore(tgt) && a && b) {
      const hop = netBetween(a, b);
      const ts = stats.get(tgt.id);
      const apply = (ts?.wqMs ?? 0) + tgt.serviceTimeMs.write;
      const lag = hop.ms / 2 + apply;
      latency = lag;
      explain.latencyMs = explain.replicationLagMs =
        `Replication lag ≈ one-way delay + apply = RTT/2 + (Wq + S_write) = ${fmt(hop.ms)}/2 + (${fmt(ts?.wqMs ?? 0)} + ${fmt(tgt.serviceTimeMs.write)}) = ${fmt(lag)} ms` +
        (hop.explain ? ` (${hop.explain})` : '');
      if (a.id !== b.id) {
        geoFindings.push(
          engineFinding(
            'engine.route',
            'info',
            'Cross-region replication lag',
            `"${src.label}" (${a.id}) → "${tgt.label}" (${b.id}): changes arrive ≈ ${fmt(lag)} ms later, so reads from "${tgt.label}" can be that stale${e.sync ? '; this edge is synchronous, so every write also waits a full RTT' : ''}.`,
            [e.id, src.id, tgt.id],
          ),
        );
      }
    }

    systemCost += cost;
    perEdge[id] = {
      rps,
      latencyMs: { p50: latency, p95: latency, p99: latency },
      handshakeMs: 0,
      bytesPerSec: rps * bytesPerRequest,
      errorRate: errors.get(e.target) ?? 0,
      costPerMonth: cost,
      explain,
    };
  }

  const units = ev.units;

  const perFlow: Record<string, FlowMetrics> = {};
  let totalRps = 0;
  let okRps = 0;
  for (const flowId of new Set(units.map((u) => u.f.flowId))) {
    const mine = units.filter((u) => u.f.flowId === flowId);
    const m = mixUnits(mine, options.maxBranches);
    perFlow[flowId] = { ...percentiles(m.dist), rps: m.w, errorRate: m.errorRate };
    totalRps += m.w;
    okRps += m.w * (1 - m.errorRate);
  }

  const perRegion: Record<string, RegionMetrics> = {};
  for (const [regionId, users] of Object.entries(scenario.usersByRegion)) {
    const loadOf = (flowId: string) =>
      loads.find((l) => l.flow.id === flowId)?.byRegion.find((r) => r.regionId === regionId);
    const mine = units
      .filter((u) => u.f.regionId === undefined || u.f.regionId === regionId)
      .map((u) => ({ ...u, w: u.f.regionId === undefined ? (loadOf(u.f.flowId)?.rps ?? 0) : u.w }));
    if (mine.length === 0) continue;
    const m = mixUnits(mine, options.maxBranches);
    const pct = percentiles(m.dist);
    const name = userRegion(regionId)?.name ?? regionId;
    const shares = new Map<string, number>();
    for (const u of mine) {
      const uw = m.w > 0 ? u.w / m.w : 1 / mine.length;
      for (const [k, v] of entryShares(u.f.expr, geo)) shares.set(k, (shares.get(k) ?? 0) + uw * v);
    }
    const served = [...shares].sort((x, y) => y[1] - x[1]);
    const top = mine.reduce((x, y) => (y.w > x.w ? y : x));
    const hops = criticalHops(top.f.expr).filter((h) => h.ms > 0);
    const flowLoads = mine
      .map((u) => loadOf(u.f.flowId))
      .filter((l): l is NonNullable<typeof l> => l !== undefined);
    perRegion[regionId] = {
      name,
      users,
      rps: m.w,
      ...pct,
      errorRate: m.errorRate,
      networkMs: m.netMs,
      ...(served[0] ? { servedFrom: served[0][0] } : {}),
      explain: {
        rps:
          flowLoads.length > 0
            ? flowLoads.map((l) => l.explain).join('; ')
            : `No load from ${name}.`,
        networkMs: !geo.active
          ? 'No component is placed in a region, so network distance is 0 ms.'
          : hops.length > 0
            ? `Mean network time per request (weighted over flows and routes) = ${fmt(m.netMs)} ms. Main path: ${hops.map((h) => h.explain).join('; ')}`
            : `Mean network time per request = ${fmt(m.netMs)} ms (everything ${name} users reach is next to them).`,
        p50: `Mixture of this region's routes (queueing + network); ${fmt(m.netMs)} ms of the mean is network. p50 = ${fmt(pct.p50)} ms, p99 = ${fmt(pct.p99)} ms`,
        p99: `Mixture of this region's routes (queueing + network); p99 = ${fmt(pct.p99)} ms`,
        servedFrom:
          served.length > 0
            ? `Served from ${served.map(([k, v]) => `${k} ${fmt(v * 100)}%`).join(', ')}${geo.unhealthy.size > 0 ? ` (down: ${[...geo.unhealthy].join(', ')})` : ''}`
            : 'Not served from a placed region.',
        errorRate: `Share of ${name} requests that fail = ${fmt(m.errorRate * 100)}%`,
      },
    };
  }

  const bottlenecks = [...stats.values()]
    .filter((s) => s.node.kind === 'service' && s.utilization >= BOTTLENECK_UTILIZATION)
    .sort((a, b) => b.utilization - a.utilization || a.node.index - b.node.index)
    .map((s) => s.node.id);

  // S11: failures over time — only when the scenario has chaos events.
  const tl =
    options.timeline && scenario.events.length > 0
      ? runTimeline({ model, graph, scenario, geo, loads, options })
      : undefined;

  return {
    perNode,
    perEdge,
    perFlow,
    perRegion,
    ...(tl ? { timeline: tl.timeline, timelineEvents: tl.markers } : {}),
    system: {
      rps: totalRps,
      availability: totalRps > 0 ? okRps / totalRps : 1,
      costPerMonth: systemCost,
      bottlenecks,
    },
    findings: [
      ...model.issues,
      ...geo.issues,
      ...plan.issues,
      ...geoFindings,
      ...(tl?.findings ?? []),
    ],
  };
}
