/**
 * Pure judging helpers shared by the modes: SLO values from a result, rubric checks, review
 * rules on a graph and the scorecard maths. No React, no store access.
 */
import type { Registry, RuleContext, RuleDefinition } from '@/registry';
import type { Finding, Graph, Scenario, SimResult } from '@/store';
import type { Problem, SloTarget } from './types';

const OPS: Record<SloTarget['op'], string> = { lt: '<', lte: '≤', gt: '>', gte: '≥' };

export function holds(v: number, op: SloTarget['op'], target: number): boolean {
  return op === 'lt'
    ? v < target
    : op === 'lte'
      ? v <= target
      : op === 'gt'
        ? v > target
        : v >= target;
}

/**
 * The value an SLO reads from a result. Flow SLOs read that flow; system-wide latency is the
 * worst flow, system error rate the rps-weighted mean. Undefined = the result has no such value
 * (e.g. the flow does not exist on this board).
 */
export function sloValue(r: SimResult, slo: SloTarget): number | undefined {
  if (slo.flowId) {
    const f = r.perFlow[slo.flowId];
    if (!f) return undefined;
    if (slo.metric === 'p50' || slo.metric === 'p95' || slo.metric === 'p99') return f[slo.metric];
    if (slo.metric === 'errorRate') return f.errorRate;
    if (slo.metric === 'rps') return f.rps;
    // Availability / cost are system-wide even when a flow is named.
  }
  const flows = Object.values(r.perFlow);
  switch (slo.metric) {
    case 'availability':
      return r.system.availability;
    case 'costPerMonth':
      return r.system.costPerMonth;
    case 'rps':
      return r.system.rps;
    case 'p50':
    case 'p95':
    case 'p99': {
      const m = slo.metric;
      return flows.length ? Math.max(...flows.map((f) => f[m])) : undefined;
    }
    case 'errorRate': {
      const rps = flows.reduce((s, f) => s + f.rps, 0);
      return rps > 0 ? flows.reduce((s, f) => s + f.errorRate * f.rps, 0) / rps : undefined;
    }
  }
}

export function formatSloValue(metric: SloTarget['metric'], v: number): string {
  if (metric === 'availability' || metric === 'errorRate') {
    const pct = v * 100;
    return `${pct >= 99 ? pct.toFixed(pct >= 99.99 ? 3 : 2) : pct.toFixed(1)}%`;
  }
  if (metric === 'costPerMonth') return `$${Math.round(v).toLocaleString('en-US')}/month`;
  if (metric === 'rps') return `${Math.round(v).toLocaleString('en-US')} rps`;
  if (v > 60_000) return '> 60 s (saturated)';
  if (v >= 10_000) return `${(v / 1000).toFixed(1)} s`;
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`;
}

/** "p99 < 200 ms (Redirect)". */
export function sloLabel(slo: SloTarget, scenario?: Scenario): string {
  const flow = slo.flowId
    ? (scenario?.flows.find((f) => f.id === slo.flowId)?.name ?? slo.flowId)
    : undefined;
  const metric = slo.metric === 'costPerMonth' ? 'cost' : slo.metric;
  return `${metric} ${OPS[slo.op]} ${formatSloValue(slo.metric, slo.value)}${flow ? ` (${flow})` : ''}`;
}

export interface SloCheck {
  slo: SloTarget;
  label: string;
  value: number | undefined;
  passed: boolean;
  /** "840 ms" or "no result yet" / "flow not on this board". */
  actual: string;
}

export function checkSlo(slo: SloTarget, result: SimResult | null, scenario?: Scenario): SloCheck {
  const label = sloLabel(slo, scenario);
  if (!result) return { slo, label, value: undefined, passed: false, actual: 'no result yet' };
  const value = sloValue(result, slo);
  if (value === undefined)
    return { slo, label, value, passed: false, actual: 'flow not on this board' };
  return {
    slo,
    label,
    value,
    passed: holds(value, slo.op, slo.value),
    actual: formatSloValue(slo.metric, value),
  };
}

/** Every SLO in a problem's rubric, checked against a result. */
export function checkProblemSlos(
  problem: Problem,
  result: SimResult | null,
  scenario?: Scenario,
): SloCheck[] {
  return problem.rubric.flatMap((r) =>
    r.slo ? [checkSlo(r.slo, result, scenario ?? problem.scenario)] : [],
  );
}

// ---------- review rules ----------

export function ruleContext(
  registry: Registry,
  graph: Graph,
  scenario?: Scenario,
  result?: SimResult | null,
): RuleContext {
  return {
    graph,
    ...(scenario ? { scenario } : {}),
    ...(result ? { result } : {}),
    components: { get: (id) => registry.get(id, 'component') },
    protocols: { get: (id) => registry.get(id, 'protocol') },
  };
}

/** Findings of the given rules (unknown ids are skipped; a throwing rule reports nothing). */
export function runRules(
  registry: Registry,
  ruleIds: readonly string[],
  graph: Graph,
  scenario?: Scenario,
  result?: SimResult | null,
): Finding[] {
  const ctx = ruleContext(registry, graph, scenario, result);
  return ruleIds.flatMap((id) => {
    const rule = registry.get(id, 'rule') as RuleDefinition | undefined;
    if (!rule) return [];
    try {
      return rule.check(ctx);
    } catch {
      return [];
    }
  });
}

export function ruleTitle(registry: Registry, id: string): string {
  return (registry.get(id, 'rule') as RuleDefinition | undefined)?.title ?? id;
}

// ---------- rubric ----------

export interface RubricLine {
  label: string;
  weight: number;
  passed: boolean;
  detail: string;
}

/** Each rubric item judged: SLOs against the result, rules against the graph. */
export function judgeRubric(
  registry: Registry,
  problem: Problem,
  graph: Graph,
  scenario: Scenario,
  result: SimResult | null,
): RubricLine[] {
  return problem.rubric.map((item) => {
    const parts: string[] = [];
    let passed = true;
    const labels: string[] = [];
    if (item.slo) {
      const c = checkSlo(item.slo, result, scenario);
      labels.push(c.label);
      parts.push(c.actual);
      passed &&= c.passed;
    }
    if (item.ruleId) {
      labels.push(`passes “${ruleTitle(registry, item.ruleId)}”`);
      // An empty or never-simulated design passes no rule by default (nothing to judge yet).
      if (graph.nodes.length === 0 || result === null) {
        parts.push(graph.nodes.length === 0 ? 'nothing on the board yet' : 'no result yet');
        passed = false;
      } else {
        const findings = runRules(registry, [item.ruleId], graph, scenario, result);
        parts.push(findings.length === 0 ? 'no findings' : (findings[0]?.title ?? 'failing'));
        passed &&= findings.length === 0;
      }
    }
    return { label: labels.join(', '), weight: item.weight, passed, detail: parts.join('; ') };
  });
}

/** Weighted share of rubric lines passed (0–1); 0 for an empty rubric. */
export function rubricShare(lines: readonly RubricLine[]): number {
  const total = lines.reduce((s, l) => s + l.weight, 0);
  return total > 0 ? lines.reduce((s, l) => s + (l.passed ? l.weight : 0), 0) / total : 0;
}

/**
 * Cost score: full marks up to 1.25× the reference design's monthly cost, falling linearly to 0
 * at 3×. Undefined when either cost is unknown.
 */
export const COST_FULL_MARKS_RATIO = 1.25;
export const COST_ZERO_RATIO = 3;
export function costShare(cost: number | undefined, referenceCost: number | undefined) {
  if (cost === undefined || referenceCost === undefined || referenceCost <= 0) return undefined;
  const ratio = cost / referenceCost;
  if (ratio <= COST_FULL_MARKS_RATIO) return 1;
  if (ratio >= COST_ZERO_RATIO) return 0;
  return (COST_ZERO_RATIO - ratio) / (COST_ZERO_RATIO - COST_FULL_MARKS_RATIO);
}

// ---------- load ----------

/** Peak requests/s a scenario asks for: Σ users × rps/user × share × peak multiplier. */
export function scenarioPeakRps(s: Scenario): number {
  const users = Object.values(s.usersByRegion).reduce((a, b) => a + b, 0);
  return s.flows.reduce((sum, f) => sum + users * f.rpsPerUser * f.share * s.peakMultiplier, 0);
}

/** Highest node utilisation in a result (0 when there are no nodes). */
export function maxUtilization(r: SimResult): { nodeId: string; utilization: number } | undefined {
  let best: { nodeId: string; utilization: number } | undefined;
  for (const [nodeId, m] of Object.entries(r.perNode)) {
    if (!best || m.utilization > best.utilization) best = { nodeId, utilization: m.utilization };
  }
  return best;
}
