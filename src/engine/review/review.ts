/**
 * S19 — design review engine. Runs every registry rule whose `appliesTo` matches the board, adds
 * the engine's own findings from the simulation result (compile/route/limits/chaos), and returns
 * one list worst-first, each finding with its rule title, category and one-click fix label.
 * Pure: no React, no store; the app calls it on the main thread (fix plans hold functions'
 * output, not functions, so only the plan labels cross into the UI).
 */
import type { Finding, FindingSeverity, Graph, Scenario, SimResult } from '@/core';
import type { FixPlan, Registry, RuleCategory, RuleContext, RuleDefinition } from '@/registry';

export const REVIEW_SEVERITY_RANK: Record<FindingSeverity, number> = {
  critical: 3,
  error: 2,
  warning: 1,
  info: 0,
};

/** Category of the engine's own findings (they have no registry rule). */
const ENGINE_CATEGORY: Record<string, RuleCategory> = {
  'engine.compile': 'reliability',
  'engine.route': 'reliability',
  'engine.chaos': 'reliability',
  'engine.limits': 'scalability',
};
const ENGINE_TITLE: Record<string, string> = {
  'engine.compile': 'Simulation: design problem',
  'engine.route': 'Simulation: routing problem',
  'engine.chaos': 'Simulation: failure scenario',
  'engine.limits': 'Simulation: provider limit',
};

export interface ReviewInput {
  graph: Graph;
  scenario?: Scenario | undefined;
  /** Latest simulation of this board; rules that need it are skipped without one. */
  result?: SimResult | null | undefined;
  registry: Registry;
  /** Only these rule categories (default: all). */
  categories?: readonly RuleCategory[] | undefined;
}

export interface ReviewFinding extends Finding {
  /** Stable key (rule id + targets + title) for lists and fix requests. */
  key: string;
  ruleTitle: string;
  category: RuleCategory;
  /** 'rule' = a registry review rule, 'engine' = reported by the simulation itself. */
  source: 'rule' | 'engine';
  /** Label of the one-click fix, when the rule offers a safe one for this finding. */
  fixLabel?: string | undefined;
}

export interface DesignReview {
  findings: ReviewFinding[];
  /** Rules that ran on this board. */
  checked: string[];
  /** Rules skipped, with why (not relevant to the board, or missing a result/scenario). */
  skipped: { ruleId: string; reason: string }[];
}

export function reviewContext(input: ReviewInput): RuleContext {
  const { registry } = input;
  return {
    graph: input.graph,
    ...(input.scenario ? { scenario: input.scenario } : {}),
    ...(input.result ? { result: input.result } : {}),
    components: { get: (id) => registry.get(id, 'component') },
    protocols: { get: (id) => registry.get(id, 'protocol') },
  };
}

/** Every review rule in the registry (all categories, sorted by id). */
export function designRules(registry: Registry): RuleDefinition[] {
  return registry
    .list({ kind: 'rule' })
    .filter((r): r is RuleDefinition => 'check' in r && typeof r.check === 'function');
}

/** Why a rule does not apply to this board, or undefined when it does. */
export function ruleSkipReason(rule: RuleDefinition, ctx: RuleContext): string | undefined {
  const a = rule.appliesTo;
  if (!a) return undefined;
  if (a.needs?.includes('result') && !ctx.result) return 'needs a simulation result';
  if (a.needs?.includes('scenario') && !ctx.scenario) return 'needs a traffic scenario';
  const filters = [a.categories, a.tags, a.defIds].filter((x) => x !== undefined);
  if (filters.length === 0) return undefined;
  const matches = ctx.graph.nodes.some((n) => {
    const def = ctx.components.get(n.defId);
    if (!def) return false;
    return (
      (a.categories?.includes(def.category) ?? false) ||
      (a.tags?.some((t) => def.tags.includes(t)) ?? false) ||
      (a.defIds?.includes(def.id) ?? false)
    );
  });
  if (matches) return undefined;
  const wanted = [...(a.categories ?? []), ...(a.tags ?? []), ...(a.defIds ?? [])];
  return `no ${wanted.join(' / ')} component on the board`;
}

export function reviewKey(f: Finding): string {
  return `${f.ruleId}:${f.targetIds.join(',')}:${f.title}`;
}

function safeFix(rule: RuleDefinition, ctx: RuleContext, f: Finding): FixPlan | undefined {
  try {
    const plan = rule.fix?.(ctx, f);
    return plan && plan.steps.length > 0 ? plan : undefined;
  } catch {
    return undefined;
  }
}

function runRule(rule: RuleDefinition, ctx: RuleContext): Finding[] {
  try {
    return rule.check(ctx);
  } catch (err) {
    return [
      {
        ruleId: rule.id,
        severity: 'info',
        title: `${rule.title}: check failed`,
        message: err instanceof Error ? err.message : String(err),
        targetIds: [],
      },
    ];
  }
}

/** Ids a result may mention that no longer exist on the board (the graph changed since). */
function onBoard(graph: Graph, f: Finding): boolean {
  const ids = new Set<string>([
    ...graph.nodes.map((n) => n.id),
    ...graph.edges.map((e) => e.id),
    ...graph.groups.map((g) => g.id),
  ]);
  return f.targetIds.every((id) => !/^(node|edge|grp)_/.test(id) || ids.has(id));
}

/** Runs the review. A rule that throws is reported as an info finding, never a crash. */
export function reviewDesign(input: ReviewInput): DesignReview {
  const ctx = reviewContext(input);
  const wanted = input.categories ? new Set(input.categories) : undefined;
  const findings: ReviewFinding[] = [];
  const checked: string[] = [];
  const skipped: DesignReview['skipped'] = [];
  for (const rule of designRules(input.registry)) {
    if (wanted && !wanted.has(rule.category)) continue;
    const reason = ruleSkipReason(rule, ctx);
    if (reason) {
      skipped.push({ ruleId: rule.id, reason });
      continue;
    }
    checked.push(rule.id);
    for (const f of runRule(rule, ctx)) {
      findings.push({
        ...f,
        key: reviewKey(f),
        ruleTitle: rule.title,
        category: rule.category,
        source: 'rule',
        fixLabel: safeFix(rule, ctx, f)?.label,
      });
    }
  }
  for (const f of input.result?.findings ?? []) {
    const category = ENGINE_CATEGORY[f.ruleId] ?? 'reliability';
    if (wanted && !wanted.has(category)) continue;
    if (!onBoard(input.graph, f)) continue;
    findings.push({
      ...f,
      key: reviewKey(f),
      ruleTitle: ENGINE_TITLE[f.ruleId] ?? 'Simulation',
      category,
      source: 'engine',
    });
  }
  const seen = new Set<string>();
  const unique = findings.filter((f) => !seen.has(f.key) && seen.add(f.key));
  unique.sort(
    (a, b) =>
      REVIEW_SEVERITY_RANK[b.severity] - REVIEW_SEVERITY_RANK[a.severity] ||
      a.category.localeCompare(b.category) ||
      a.ruleId.localeCompare(b.ruleId) ||
      a.title.localeCompare(b.title),
  );
  return { findings: unique, checked, skipped };
}

/** The fix plan of one finding (by key, re-checked on the current board), if its rule has one. */
export function designFix(input: ReviewInput, key: string): FixPlan | undefined {
  const ctx = reviewContext(input);
  for (const rule of designRules(input.registry)) {
    if (!rule.fix || ruleSkipReason(rule, ctx)) continue;
    const f = runRule(rule, ctx).find((x) => reviewKey(x) === key);
    if (f) return safeFix(rule, ctx, f);
  }
  return undefined;
}
