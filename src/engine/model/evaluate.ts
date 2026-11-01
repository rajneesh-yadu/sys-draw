/**
 * Pipeline steps 4–6 for one set of conditions: load propagation (with retries), per-node
 * queueing (fixed point on errors), and latency/error composition per routed flow.
 *
 * Shared by the analytical run (`simulate`, no perturbation) and every tick of the chaos timeline
 * (S11), so both use exactly the same formulas.
 *
 * Resilience on an edge (EdgeConfig):
 * - one attempt over edge e to visit v succeeds with a = (1 − err_v) × (1 − P_timeout) × success(downstream)
 *   (0 when a network partition cuts the hop or the edge's circuit breaker is open);
 * - P_timeout ≈ e^(−τ / T̄): exponential tail of v's mean response T̄ (queueing + downstream + network);
 * - with r retries: expected attempts A = Σ_{k=0..r} (1 − a)^k = (1 − (1 − a)^(r+1)) / a, so the
 *   target sees λ × A (retry storms), and success = 1 − (1 − a)^(r+1);
 * - latency of a retried call: a mixture over the attempt that finally answers, each failed
 *   attempt costing τ (timeouts) or T̄ (fast failures) plus backoff (fixed 100 ms, exp 100·2^(k−1)).
 * Timed-out work is not cancelled downstream (it still loads the target).
 */
import type { NetHop } from '../geo/distance';
import { nodeQueueing } from '../queueing/node';
import type { RoutedFlow } from './route';
import type { Expr } from './expr';
import { type Dist, fixedDist, mixDist, stageDist, sumDist, ZERO_DIST } from './latency';
import type { CompiledEdge, CompiledNode, EngineOptions, Model, NodeStats, Op } from './types';

/** Base delay between retries for `fixed` / `exp` backoff (ms). */
export const RETRY_BACKOFF_BASE_MS = 100;

type Rps = { read: number; write: number };

/** What chaos does to one tick. Every field is optional; `{}` = the analytical run. */
export interface Perturbation {
  /** Nodes that are down: every call to them fails at once, they do no work. */
  down?: ReadonlySet<string>;
  /** Nodes whose writes fail (disk full); reads still work. */
  writeDown?: ReadonlySet<string>;
  /** Replacement compiled nodes (slower service, other replicas, hot shard…). */
  nodes?: ReadonlyMap<string, CompiledNode>;
  /** Extra queueing wait per node (backlog carried over from earlier ticks), ms. */
  extraWaitMs?: ReadonlyMap<string, number>;
  /** Extra response latency per node that does not use capacity (injected delay, cold starts), ms. */
  nodeAddedMs?: ReadonlyMap<string, number>;
  /** Extra latency per edge traversal (packet loss retransmits, injected delay), ms. */
  edgeAddedMs?: ReadonlyMap<string, number>;
  /** Edges whose circuit breaker is open: calls fail fast without reaching the target. */
  openEdges?: ReadonlySet<string>;
  /** True when a network hop is cut (partition between two regions). */
  partitioned?: (hop: NetHop) => boolean;
}

export interface EdgeAttempts {
  /** Attempts sent over the edge (incl. retries and fail-fast calls), per second. */
  w: number;
  /** Of which failed. */
  fail: number;
  /** Requests that wanted the edge before retries (to measure retry amplification). */
  first: number;
}

export interface Unit {
  f: RoutedFlow;
  w: number;
  dist: Dist;
  errorRate: number;
  netMs: number;
}

export interface Evaluation {
  stats: Map<string, NodeStats>;
  /** Node error rates from queueing (rejections) — feeds the next fixed point / tick. */
  errors: Map<string, number>;
  edgeRps: Map<string, number>;
  edgeAttempts: Map<string, EdgeAttempts>;
  units: Unit[];
  /** Effective error of a call to `nodeId` for `op` (down, disk full, rejections). */
  errOf(nodeId: string, op: Op): number;
}

const RETRY_EPS = 1e-12;

function backoffMs(kind: string | undefined, k: number): number {
  if (kind === 'fixed') return RETRY_BACKOFF_BASE_MS;
  if (kind === 'exp') return RETRY_BACKOFF_BASE_MS * 2 ** (k - 1);
  return 0;
}

/** Expected attempts with r retries when one attempt succeeds with probability a. */
export function expectedAttempts(a: number, retries: number): number {
  if (retries <= 0) return 1;
  if (a <= RETRY_EPS) return retries + 1;
  return (1 - (1 - a) ** (retries + 1)) / a;
}

/** Probability a call with r retries finally succeeds. */
export function retrySuccess(a: number, retries: number): number {
  return 1 - (1 - a) ** (Math.max(0, retries) + 1);
}

/** P(response time > τ) for an exponential tail with mean T̄. */
export function timeoutProbability(timeoutMs: number | undefined, meanMs: number): number {
  if (timeoutMs === undefined || !(meanMs > 0)) return 0;
  return Math.exp(-timeoutMs / meanMs);
}

/**
 * Queueing results reused across timeline ticks: same compiled node object + same read/write
 * rps ⇒ same NodeStats (nodeQueueing is pure). Never mutate stats taken from it.
 */
export type QueueingCache = WeakMap<CompiledNode, Map<string, NodeStats>>;

export function evaluate(
  model: Model,
  routed: readonly RoutedFlow[],
  options: EngineOptions,
  durationSec: number,
  pert: Perturbation = {},
  seedErrors?: ReadonlyMap<string, number>,
  queueCache?: QueueingCache,
): Evaluation {
  const queue = (node: CompiledNode, rps: Rps): NodeStats => {
    if (!queueCache) return nodeQueueing(node, rps, options, durationSec);
    let m = queueCache.get(node);
    if (!m) queueCache.set(node, (m = new Map()));
    const key = `${rps.read}|${rps.write}`;
    let s = m.get(key);
    if (!s) m.set(key, (s = nodeQueueing(node, rps, options, durationSec)));
    return s;
  };
  const down = pert.down ?? new Set<string>();
  const writeDown = pert.writeDown ?? new Set<string>();
  const openEdges = pert.openEdges ?? new Set<string>();
  const nodeOf = (id: string) => pert.nodes?.get(id) ?? model.nodes.get(id);

  let errors = new Map<string, number>(seedErrors ?? []);
  let stats = new Map<string, NodeStats>();
  const errOf = (id: string, op: Op) =>
    down.has(id) ? 1 : op === 'write' && writeDown.has(id) ? 1 : (errors.get(id) ?? 0);

  // Per-iteration memo (Expr identity → value); cleared whenever errors or stats change.
  let succMemo = new WeakMap<Expr, number>();
  let meanMemo = new WeakMap<Expr, number>();
  let attemptMemo = new WeakMap<Expr, number>();

  const edgeOf = (e: Expr & { k: 'visit' }): CompiledEdge | undefined =>
    e.edgeId !== undefined ? model.edges.get(e.edgeId) : undefined;
  const hopCut = (e: Expr & { k: 'visit' }) =>
    e.net !== undefined && pert.partitioned !== undefined && pert.partitioned(e.net);

  /** Mean latency of one attempt of a visit, without retries at its own edge (ms). */
  const visitMean = (e: Expr & { k: 'visit' }): number => {
    const s = stats.get(e.nodeId);
    const own = down.has(e.nodeId) ? 0 : (s?.responseMs[e.op] ?? 0);
    return (
      own +
      (pert.nodeAddedMs?.get(e.nodeId) ?? 0) +
      (e.edgeId !== undefined ? (pert.edgeAddedMs?.get(e.edgeId) ?? 0) : 0) +
      (e.net?.ms ?? 0) +
      meanOf(e.then)
    );
  };

  /** Mean latency of an expression, retries included (ms). */
  const meanOf = (e: Expr): number => {
    const m = meanMemo.get(e);
    if (m !== undefined) return m;
    let v: number;
    switch (e.k) {
      case 'visit': {
        const edge = edgeOf(e);
        if (edge && openEdges.has(edge.id)) {
          v = 0;
          break;
        }
        const one = visitMean(e);
        const r = edge?.config.retries ?? 0;
        const a = attempt(e);
        v = r > 0 && a < 1 - RETRY_EPS ? one * expectedAttempts(a, r) : one;
        break;
      }
      case 'seq':
        v = e.items.reduce((s, item) => s + meanOf(item), 0);
        break;
      case 'choice':
        v = e.options.reduce((s, o) => s + o.p * meanOf(o.expr), 0);
        break;
      case 'async':
      case 'empty':
        v = 0;
    }
    meanMemo.set(e, v);
    return v;
  };

  /** One attempt over the visit's edge succeeds with this probability. */
  const attempt = (e: Expr & { k: 'visit' }): number => {
    const m = attemptMemo.get(e);
    if (m !== undefined) return m;
    const edge = edgeOf(e);
    let a: number;
    if ((edge && openEdges.has(edge.id)) || hopCut(e)) a = 0;
    else {
      a = (1 - errOf(e.nodeId, e.op)) * succ(e.then);
      const tau = edge?.config.timeoutMs;
      if (tau !== undefined && a > 0) a *= 1 - timeoutProbability(tau, visitMean(e));
    }
    attemptMemo.set(e, a);
    return a;
  };

  /** Probability a request through `e` succeeds (async work never fails the caller). */
  const succ = (e: Expr): number => {
    const m = succMemo.get(e);
    if (m !== undefined) return m;
    let v: number;
    switch (e.k) {
      case 'visit':
        v = retrySuccess(attempt(e), edgeOf(e)?.config.retries ?? 0);
        break;
      case 'seq':
        v = e.items.reduce((s, item) => s * succ(item), 1);
        break;
      case 'choice':
        v = e.options.reduce((s, o) => s + o.p * succ(o.expr), 0);
        break;
      case 'async':
      case 'empty':
        v = 1;
    }
    succMemo.set(e, v);
    return v;
  };

  let edgeRps = new Map<string, number>();
  let edgeAttempts = new Map<string, EdgeAttempts>();

  const propagate = (e: Expr, lambda: number, nodeRps: Map<string, Rps>): void => {
    if (lambda <= 0) return;
    switch (e.k) {
      case 'visit': {
        const edge = edgeOf(e);
        const open = edge !== undefined && openEdges.has(edge.id);
        const a = attempt(e);
        const A = open ? 1 : expectedAttempts(a, edge?.config.retries ?? 0);
        const L = lambda * A;
        if (edge) {
          const rec = edgeAttempts.get(edge.id) ?? { w: 0, fail: 0, first: 0 };
          rec.w += L;
          rec.fail += L * (1 - a);
          rec.first += lambda;
          edgeAttempts.set(edge.id, rec);
        }
        if (open || hopCut(e)) return; // never reaches the target
        const r = nodeRps.get(e.nodeId);
        if (r) r[e.op] += L;
        if (e.edgeId !== undefined) edgeRps.set(e.edgeId, (edgeRps.get(e.edgeId) ?? 0) + L);
        propagate(e.then, L * (1 - errOf(e.nodeId, e.op)), nodeRps);
        return;
      }
      case 'seq':
        for (const item of e.items) propagate(item, lambda, nodeRps);
        return;
      case 'choice':
        for (const o of e.options) propagate(o.expr, lambda * o.p, nodeRps);
        return;
      case 'async':
        propagate(e.expr, lambda, nodeRps);
        return;
      case 'empty':
        return;
    }
  };

  // Fixed point: rejections (and retries) change downstream load, which changes rejections.
  // A DAG without retries converges in ≤ depth iterations; feedback loops (retry storms) are damped.
  for (let iter = 0; iter < 64; iter++) {
    const nodeRps = new Map<string, Rps>();
    for (const id of model.nodes.keys()) nodeRps.set(id, { read: 0, write: 0 });
    edgeRps = new Map();
    edgeAttempts = new Map();
    for (const f of routed) propagate(f.expr, f.rps, nodeRps);
    stats = new Map();
    for (const base of model.nodes.values()) {
      const node = nodeOf(base.id) ?? base;
      const rps = nodeRps.get(node.id) ?? { read: 0, write: 0 };
      stats.set(node.id, perturbStats(queue(node, rps), pert, down));
    }
    const next = new Map([...stats].map(([id, s]) => [id, s.errorRate]));
    const converged = [...next].every(([id, x]) => Math.abs(x - (errors.get(id) ?? 0)) < 1e-12);
    if (converged) {
      errors = next;
      break;
    }
    errors =
      iter < 16
        ? next
        : new Map([...next].map(([id, x]) => [id, 0.5 * x + 0.5 * (errors.get(id) ?? 0)]));
    succMemo = new WeakMap();
    meanMemo = new WeakMap();
    attemptMemo = new WeakMap();
  }
  // Final memo for the stats/errors we keep.
  succMemo = new WeakMap();
  meanMemo = new WeakMap();
  attemptMemo = new WeakMap();

  const latencyOf = (e: Expr): Dist => {
    const mb = options.maxBranches;
    switch (e.k) {
      case 'visit': {
        const edge = edgeOf(e);
        if (edge && openEdges.has(edge.id)) return ZERO_DIST; // fail fast
        if (hopCut(e)) return ZERO_DIST;
        const s = stats.get(e.nodeId);
        const own = down.has(e.nodeId) ? 0 : (s?.responseMs[e.op] ?? 0);
        let d: Dist = own > 0 ? stageDist(own) : ZERO_DIST;
        const fixed =
          (e.net?.ms ?? 0) +
          (e.edgeId !== undefined ? (pert.edgeAddedMs?.get(e.edgeId) ?? 0) : 0) +
          (pert.nodeAddedMs?.get(e.nodeId) ?? 0);
        if (fixed > 0) d = sumDist(d, fixedDist(fixed), mb);
        d = sumDist(d, latencyOf(e.then), mb);
        const r = edge?.config.retries ?? 0;
        const a = attempt(e);
        if (r <= 0 || a >= 1 - RETRY_EPS) return d;
        // Which attempt answers: k = 1..r+1 with P ∝ (1−a)^(k−1)·a; failures end at k = r+1.
        const tau = edge?.config.timeoutMs;
        const meanAttempt = visitMean(e);
        const pTo = timeoutProbability(tau, meanAttempt);
        const fail = 1 - a;
        const toShare = tau !== undefined && fail > 0 ? Math.min(1, pTo / fail) : 0;
        const failedCost =
          toShare * (tau ?? 0) + (1 - toShare) * Math.min(meanAttempt, tau ?? Infinity);
        const parts: { p: number; dist: Dist }[] = [];
        let wait = 0;
        for (let k = 1; k <= r + 1; k++) {
          const p = (1 - a) ** (k - 1) * (k === r + 1 ? 1 : a);
          parts.push({ p, dist: wait > 0 ? sumDist(d, fixedDist(wait), mb) : d });
          wait += failedCost + backoffMs(edge?.config.backoff, k);
        }
        return mixDist(parts, mb);
      }
      case 'seq':
        return e.items.reduce<Dist>((acc, item) => sumDist(acc, latencyOf(item), mb), ZERO_DIST);
      case 'choice':
        return mixDist(
          e.options.map((o) => ({ p: o.p, dist: latencyOf(o.expr) })),
          mb,
        );
      case 'async':
      case 'empty':
        return ZERO_DIST;
    }
  };

  const units: Unit[] = routed.map((f) => ({
    f,
    w: f.rps,
    dist: latencyOf(f.expr),
    errorRate: Math.min(1, Math.max(0, 1 - succ(f.expr))),
    netMs: netMean(f.expr),
  }));

  return { stats, errors, edgeRps, edgeAttempts, units, errOf };
}

/** Applies down / disk-full / backlog wait to a node's queueing result. */
function perturbStats(s: NodeStats, pert: Perturbation, down: ReadonlySet<string>): NodeStats {
  const id = s.node.id;
  if (down.has(id)) {
    return {
      ...s,
      servedRps: 0,
      utilization: 0,
      waitProbability: 0,
      wqMs: 0,
      queueDepth: 0,
      errorRate: 1,
      responseMs: { read: 0, write: 0, mean: 0 },
      saturated: false,
      explain: { ...s.explain, errorRate: 'Down (chaos event): every call fails at once.' },
    };
  }
  const wait = pert.extraWaitMs?.get(id) ?? 0;
  let out = s;
  if (wait > 0) {
    out = {
      ...out,
      wqMs: out.wqMs + wait,
      queueDepth: out.queueDepth + (wait / 1000) * Math.min(out.lambda, out.capacityRps),
      responseMs: {
        read: out.responseMs.read + wait,
        write: out.responseMs.write + wait,
        mean: out.responseMs.mean + wait,
      },
    };
  }
  if (pert.writeDown?.has(id) && out.rps.write > 0) {
    out = {
      ...out,
      servedRps: Math.max(0, out.servedRps - out.rps.write * (1 - out.errorRate)),
      explain: {
        ...out.explain,
        writes: 'Disk full (chaos event): every write fails; reads work.',
      },
    };
  }
  return out;
}

/** rps-weighted mixture of routed units (equal weights when nothing flows). */
export function mixUnits(
  units: readonly { w: number; dist: Dist; errorRate: number; netMs: number }[],
  maxBranches: number,
): { dist: Dist; errorRate: number; netMs: number; w: number } {
  const w = units.reduce((s, u) => s + u.w, 0);
  const weight = (u: { w: number }) => (w > 0 ? u.w / w : 1 / units.length);
  return {
    w,
    dist:
      units.length === 1
        ? (units[0] as { dist: Dist }).dist
        : mixDist(
            units.map((u) => ({ p: weight(u), dist: u.dist })),
            maxBranches,
          ),
    errorRate: units.reduce((s, u) => s + weight(u) * u.errorRate, 0),
    netMs: units.reduce((s, u) => s + weight(u) * u.netMs, 0),
  };
}

/** Mean network ms on the critical path (async work excluded). */
export function netMean(e: Expr): number {
  switch (e.k) {
    case 'visit':
      return (e.net?.ms ?? 0) + netMean(e.then);
    case 'seq':
      return e.items.reduce((s, item) => s + netMean(item), 0);
    case 'choice':
      return e.options.reduce((s, o) => s + o.p * netMean(o.expr), 0);
    case 'async':
    case 'empty':
      return 0;
  }
}
