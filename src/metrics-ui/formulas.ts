/**
 * "Show formula" text for every number the drawer displays. Node and edge numbers use
 * `SimResult.explain` verbatim; system and flow numbers have no explain field in SimResult, so
 * their formula is stated here with the inputs read from the result and scenario (no new metrics).
 */
import {
  formatPercent,
  formatRps,
  formatUsd,
  type FlowMetrics,
  type NodeMetrics,
  type Scenario,
  type SimResult,
} from '@/store';

/** Id the engine gives its inferred flow when the scenario defines none (engine `INFERRED_FLOW_ID`). */
export const INFERRED_FLOW_ID = 'flow_inferred';
export const INFERRED_FLOW_NAME = 'All traffic (inferred from clients)';

export function flowName(flowId: string, scenario: Scenario): string {
  const f = scenario.flows.find((x) => x.id === flowId);
  if (f) return f.name;
  return flowId === INFERRED_FLOW_ID ? INFERRED_FLOW_NAME : flowId;
}

function totalUsers(scenario: Scenario): number {
  return Object.values(scenario.usersByRegion).reduce((s, u) => s + u, 0);
}

export interface SystemFormulas {
  rps: string;
  errorRate: string;
  availability: string;
  costPerMonth: string;
}

export function systemFormulas(result: SimResult, scenario: Scenario): SystemFormulas {
  const flows = Object.entries(result.perFlow);
  const terms = flows.map(([, f]) => formatRps(f.rps).replace(' rps', ''));
  const sum =
    flows.length > 1
      ? `Σ flow rates = ${terms.join(' + ')} = ${formatRps(result.system.rps)}`
      : `Rate of the only flow = ${formatRps(result.system.rps)}`;
  const served = result.system.rps * result.system.availability;
  const nodeCost = Object.values(result.perNode).reduce((s, m) => s + m.costPerMonth, 0);
  const edgeCost = Object.values(result.perEdge).reduce((s, m) => s + m.costPerMonth, 0);
  return {
    rps: `${flows.length === 0 ? 'No flows: 0 rps' : sum} at peak (each flow: λ = users × rpsPerUser × share × peak, with ${totalUsers(scenario).toLocaleString('en-US')} users and peak × ${scenario.peakMultiplier}).`,
    errorRate: `error rate = 1 − availability = 1 − ${formatPercent(result.system.availability)} = ${formatPercent(1 - result.system.availability)}`,
    availability: `availability = successful rps / offered rps = Σ λ_flow × (1 − error_flow) / Σ λ_flow = ${formatRps(served)} / ${formatRps(result.system.rps)} = ${formatPercent(result.system.availability)}. A flow succeeds only if every component on its path does.`,
    costPerMonth:
      edgeCost > 0
        ? `Σ component cost + Σ connection egress = ${formatUsd(nodeCost)} + ${formatUsd(edgeCost)} = ${formatUsd(result.system.costPerMonth)} per month. Select a component or hover a connection for its own formula.`
        : `Σ component cost per month = ${formatUsd(result.system.costPerMonth)}. Select a component to see its own formula.`,
  };
}

export type FlowField = 'rps' | 'p50' | 'p95' | 'p99' | 'errorRate';

const PERCENTILE_NOTE =
  'End-to-end latency of the flow: the components on its path add as a shifted exponential (shift = Σ mean response times − θ, tail θ = √Σ Tᵢ²); load-balancer splits and cache hit/miss mix paths, and the percentile is solved on the mixture CDF.';

export function flowFormula(field: FlowField, flow: FlowMetrics, scenario: Scenario): string {
  switch (field) {
    case 'rps':
      return `λ = users × rpsPerUser × share × peak, with ${totalUsers(scenario).toLocaleString('en-US')} users and peak × ${scenario.peakMultiplier} = ${formatRps(flow.rps)}`;
    case 'p50':
      return `p50: half the requests finish faster. ${PERCENTILE_NOTE}`;
    case 'p95':
      return `p95: 1 request in 20 is slower. ${PERCENTILE_NOTE}`;
    case 'p99':
      return `p99: 1 request in 100 is slower — the tail users notice. ${PERCENTILE_NOTE}`;
    case 'errorRate':
      return `error = 1 − Π (1 − error of each component on the path), weighted across branches = ${formatPercent(flow.errorRate)}`;
  }
}

export type NodeField =
  | 'utilization'
  | 'rpsIn'
  | 'rpsOut'
  | 'queueDepth'
  | 'p50'
  | 'p95'
  | 'p99'
  | 'errorRate'
  | 'hitRate'
  | 'costPerMonth';

/** Node formulas come from the engine's explain map; fall back to a plain definition. */
export function nodeFormula(field: NodeField, m: NodeMetrics): string {
  const e = m.explain;
  switch (field) {
    case 'utilization':
      return e.utilization ?? 'ρ = λ / (c·μ): share of capacity in use.';
    case 'rpsIn':
      return e.rpsIn ?? 'λ: requests per second arriving.';
    case 'rpsOut':
      return e.errorRate && m.errorRate > 0
        ? `Served = λ × (1 − error). ${e.errorRate}`
        : 'Served rps = arriving rps (no rejections).';
    case 'queueDepth':
      return [e.queueDepth, e.lag].filter(Boolean).join(' ') || 'Requests waiting (Lq).';
    case 'p50':
    case 'p95':
    case 'p99':
      return e.latencyMs ?? 'Response time at this component.';
    case 'errorRate':
      return e.errorRate ?? 'No rejections.';
    case 'hitRate':
      return e.hitRate ?? 'Share of reads answered from cache.';
    case 'costPerMonth':
      return e.costPerMonth ?? 'Instances × hourly price × 730 h.';
  }
}

/** Bottlenecks in result order, with utilisation, for the clickable list. */
export function bottleneckRows(
  result: SimResult,
  labelOf: (nodeId: string) => string | undefined,
): { nodeId: string; label: string; utilization: number; formula: string }[] {
  return result.system.bottlenecks.flatMap((nodeId) => {
    const m = result.perNode[nodeId];
    if (!m) return [];
    return [
      {
        nodeId,
        label: labelOf(nodeId) ?? nodeId,
        utilization: m.utilization,
        formula: nodeFormula('utilization', m),
      },
    ];
  });
}

export type RegionMetrics = NonNullable<SimResult['perRegion']>[string];
export type RegionField = 'rps' | 'servedFrom' | 'networkMs' | 'p50' | 'p99' | 'errorRate';

/** Per-user-region formulas come from the engine's explain map (S10). */
export function regionFormula(field: RegionField, m: RegionMetrics): string {
  const e = m.explain;
  switch (field) {
    case 'rps':
      return e.rps ?? 'λ = users × rpsPerUser × share × peak.';
    case 'servedFrom':
      return e.servedFrom ?? 'Cloud region that answers these users.';
    case 'networkMs':
      return (
        e.networkMs ??
        'Network time per request: RTT = 2 × 1.5 × distance / 200 km/ms + 1 ms per hop, + last mile.'
      );
    case 'p50':
      return e.p50 ?? 'Half of this region’s requests finish faster (queueing + network).';
    case 'p99':
      return e.p99 ?? '1 request in 100 from this region is slower.';
    case 'errorRate':
      return e.errorRate ?? 'Share of this region’s requests that fail.';
  }
}

/** Regions in result order, busiest first, with users > 0 or traffic. */
export function regionRows(result: SimResult): { id: string; m: RegionMetrics }[] {
  return Object.entries(result.perRegion ?? {})
    .map(([id, m]) => ({ id, m }))
    .sort((a, b) => b.m.users - a.m.users || a.id.localeCompare(b.id));
}
