/**
 * One analytical run: compile → load → route → queueing (fixed point on rejections) →
 * behaviors finish → latency composition → SimResult. Pure and deterministic (no randomness;
 * `scenario.seed` matters only for later stochastic modes).
 */
import type { EdgeMetrics, FlowMetrics, NodeMetrics, SimResult } from '@/core';
import { behaviorsOf } from './behaviors';
import { compile, type ComponentSource } from './model/compile';
import { type Expr, isEmpty } from './model/expr';
import { fmt } from './model/format';
import {
  type Dist,
  fixedDist,
  mixDist,
  percentiles,
  stageDist,
  sumDist,
  ZERO_DIST,
} from './model/latency';
import { generateLoad, inferFlow } from './model/load';
import { route } from './model/route';
import {
  DEFAULT_ENGINE_OPTIONS,
  type EngineOptions,
  type NodeStats,
  type SimInput,
} from './model/types';
import { nodeQueueing } from './queueing/node';
import { expQuantileFactor } from './queueing/mmc';

/** Nodes at or above this utilisation are listed as bottlenecks. */
export const BOTTLENECK_UTILIZATION = 0.85;

type Rps = { read: number; write: number };

function propagate(
  e: Expr,
  lambda: number,
  nodeRps: Map<string, Rps>,
  edgeRps: Map<string, number>,
  errors: ReadonlyMap<string, number>,
): void {
  if (lambda <= 0) return;
  switch (e.k) {
    case 'visit': {
      const r = nodeRps.get(e.nodeId);
      if (r) r[e.op] += lambda;
      if (e.edgeId !== undefined) edgeRps.set(e.edgeId, (edgeRps.get(e.edgeId) ?? 0) + lambda);
      propagate(e.then, lambda * (1 - (errors.get(e.nodeId) ?? 0)), nodeRps, edgeRps, errors);
      return;
    }
    case 'seq':
      for (const item of e.items) propagate(item, lambda, nodeRps, edgeRps, errors);
      return;
    case 'choice':
      for (const o of e.options) propagate(o.expr, lambda * o.p, nodeRps, edgeRps, errors);
      return;
    case 'async':
      propagate(e.expr, lambda, nodeRps, edgeRps, errors);
      return;
    case 'empty':
      return;
  }
}

/** Probability a request succeeds; async work does not fail the caller. */
function successOf(e: Expr, errors: ReadonlyMap<string, number>): number {
  switch (e.k) {
    case 'visit':
      return (1 - (errors.get(e.nodeId) ?? 0)) * successOf(e.then, errors);
    case 'seq':
      return e.items.reduce((s, item) => s * successOf(item, errors), 1);
    case 'choice':
      return e.options.reduce((s, o) => s + o.p * successOf(o.expr, errors), 0);
    case 'async':
    case 'empty':
      return 1;
  }
}

function latencyOf(
  e: Expr,
  stats: ReadonlyMap<string, NodeStats>,
  edgeLatencyMs: (edgeId: string) => number,
  maxBranches: number,
): Dist {
  switch (e.k) {
    case 'visit': {
      const s = stats.get(e.nodeId);
      let d: Dist = s && s.responseMs[e.op] > 0 ? stageDist(s.responseMs[e.op]) : ZERO_DIST;
      if (e.edgeId !== undefined) {
        const net = edgeLatencyMs(e.edgeId);
        if (net > 0) d = sumDist(d, fixedDist(net), maxBranches);
      }
      return sumDist(d, latencyOf(e.then, stats, edgeLatencyMs, maxBranches), maxBranches);
    }
    case 'seq':
      return e.items.reduce<Dist>(
        (acc, item) =>
          sumDist(acc, latencyOf(item, stats, edgeLatencyMs, maxBranches), maxBranches),
        ZERO_DIST,
      );
    case 'choice':
      return mixDist(
        e.options.map((o) => ({
          p: o.p,
          dist: latencyOf(o.expr, stats, edgeLatencyMs, maxBranches),
        })),
        maxBranches,
      );
    case 'async':
    case 'empty':
      return ZERO_DIST;
  }
}

export function simulate(
  input: SimInput,
  registry: ComponentSource,
  opts: Partial<EngineOptions> = {},
): SimResult {
  const options: EngineOptions = { ...DEFAULT_ENGINE_OPTIONS, ...opts };
  const { graph, scenario } = input;
  const model = compile(graph, registry);
  const flows = scenario.flows.length > 0 ? scenario.flows : [inferFlow(options)];
  const plan = route(generateLoad(scenario, flows), model, options);
  const routed = plan.flows.map((f) => ({ ...f, rps: isEmpty(f.expr) ? 0 : f.rps }));

  // Rejections upstream reduce load downstream: iterate until error rates settle (DAG ⇒ ≤ depth).
  let errors: Map<string, number> = new Map();
  let stats = new Map<string, NodeStats>();
  let edgeRps = new Map<string, number>();
  for (let iter = 0; iter < 64; iter++) {
    const nodeRps = new Map<string, Rps>();
    for (const id of model.nodes.keys()) nodeRps.set(id, { read: 0, write: 0 });
    edgeRps = new Map();
    for (const f of routed) propagate(f.expr, f.rps, nodeRps, edgeRps, errors);
    stats = new Map();
    for (const node of model.nodes.values()) {
      const rps = nodeRps.get(node.id) ?? { read: 0, write: 0 };
      stats.set(node.id, nodeQueueing(node, rps, options, scenario.durationSec));
    }
    const next = new Map([...stats].map(([id, s]) => [id, s.errorRate]));
    const converged = [...next].every(([id, e]) => Math.abs(e - (errors.get(id) ?? 0)) < 1e-12);
    errors = next;
    if (converged) break;
  }

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

  const perNode: Record<string, NodeMetrics> = {};
  for (const [id, s] of stats) {
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
      costPerMonth: 0,
      explain: s.explain,
    };
  }

  const bytesPerRequest = scenario.payloadBytes.req + scenario.payloadBytes.res;
  const perEdge: Record<string, EdgeMetrics> = {};
  for (const [id, e] of model.edges) {
    const rps = edgeRps.get(id) ?? 0;
    perEdge[id] = {
      rps,
      latencyMs: { p50: 0, p95: 0, p99: 0 },
      handshakeMs: 0,
      bytesPerSec: rps * bytesPerRequest,
      errorRate: errors.get(e.target) ?? 0,
      costPerMonth: 0,
      explain: {
        rps: `Requests per second routed over this connection = ${fmt(rps)}`,
        bytesPerSec: `rps × (request + response bytes) = ${fmt(rps)} × ${fmt(bytesPerRequest)} = ${fmt(rps * bytesPerRequest)} B/s`,
        latencyMs:
          'Network cost (distance, handshakes, protocol overhead) is added with geo (S10) and protocols (S14): 0 ms for now.',
      },
    };
  }

  const perFlow: Record<string, FlowMetrics> = {};
  let totalRps = 0;
  let okRps = 0;
  for (const f of routed) {
    const dist = latencyOf(f.expr, stats, () => 0, options.maxBranches);
    const errorRate = Math.min(1, Math.max(0, 1 - successOf(f.expr, errors)));
    perFlow[f.flowId] = { ...percentiles(dist), rps: f.rps, errorRate };
    totalRps += f.rps;
    okRps += f.rps * (1 - errorRate);
  }

  const bottlenecks = [...stats.values()]
    .filter((s) => s.node.kind === 'service' && s.utilization >= BOTTLENECK_UTILIZATION)
    .sort((a, b) => b.utilization - a.utilization || a.node.index - b.node.index)
    .map((s) => s.node.id);

  return {
    perNode,
    perEdge,
    perFlow,
    system: {
      rps: totalRps,
      availability: totalRps > 0 ? okRps / totalRps : 1,
      costPerMonth: 0,
      bottlenecks,
    },
    findings: [...model.issues, ...plan.issues],
  };
}
