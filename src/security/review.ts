/**
 * Threat review (S16): runs every registry rule in the `security` category over a board and
 * returns its findings, worst first, with the label of each finding's one-click fix.
 */
import type { Finding, FindingSeverity, Graph, Scenario, SimResult } from '@/core';
import type { FixPlan, Registry, RuleContext, RuleDefinition } from '@/registry';

export const SEVERITY_RANK: Record<FindingSeverity, number> = {
  critical: 3,
  error: 2,
  warning: 1,
  info: 0,
};

export interface SecurityReviewInput {
  graph: Graph;
  scenario?: Scenario | undefined;
  result?: SimResult | undefined;
  registry: Registry;
}

export interface SecurityFinding extends Finding {
  /** Stable key for lists and fix requests: rule id + targets. */
  key: string;
  ruleTitle: string;
  /** Label of the one-click fix, when the rule can fix this finding. */
  fixLabel?: string | undefined;
}

export function ruleContext(input: SecurityReviewInput): RuleContext {
  const { registry } = input;
  return {
    graph: input.graph,
    ...(input.scenario ? { scenario: input.scenario } : {}),
    ...(input.result ? { result: input.result } : {}),
    components: { get: (id) => registry.get(id, 'component') },
    protocols: { get: (id) => registry.get(id, 'protocol') },
  };
}

/** The registry's security rules, by id. */
export function securityRules(registry: Registry): RuleDefinition[] {
  return registry
    .list({ kind: 'rule' })
    .filter(
      (r): r is RuleDefinition => 'check' in r && (r as RuleDefinition).category === 'security',
    );
}

export function findingKey(f: Finding): string {
  return `${f.ruleId}:${f.targetIds.join(',')}:${f.title}`;
}

function safeFix(rule: RuleDefinition, ctx: RuleContext, f: Finding): FixPlan | undefined {
  try {
    return rule.fix?.(ctx, f);
  } catch {
    return undefined;
  }
}

/** Runs the security rules. A rule that throws is reported as an info finding, not a crash. */
export function reviewSecurity(input: SecurityReviewInput): SecurityFinding[] {
  const ctx = ruleContext(input);
  const out: SecurityFinding[] = [];
  for (const rule of securityRules(input.registry)) {
    let found: Finding[];
    try {
      found = rule.check(ctx);
    } catch (err) {
      found = [
        {
          ruleId: rule.id,
          severity: 'info',
          title: `${rule.title}: check failed`,
          message: err instanceof Error ? err.message : String(err),
          targetIds: [],
        },
      ];
    }
    for (const f of found) {
      out.push({
        ...f,
        key: findingKey(f),
        ruleTitle: rule.title,
        fixLabel: safeFix(rule, ctx, f)?.label,
      });
    }
  }
  return out.sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      a.ruleId.localeCompare(b.ruleId) ||
      a.title.localeCompare(b.title),
  );
}

/** The fix plan for one finding (looked up by key on the current board), if its rule has one. */
export function securityFix(input: SecurityReviewInput, key: string): FixPlan | undefined {
  const ctx = ruleContext(input);
  for (const rule of securityRules(input.registry)) {
    if (!rule.fix) continue;
    let found: Finding[];
    try {
      found = rule.check(ctx);
    } catch {
      continue;
    }
    const f = found.find((x) => findingKey(x) === key);
    if (f) return safeFix(rule, ctx, f);
  }
  return undefined;
}
