/**
 * Debug mode logic (pure): find a problem's broken variant, read its symptoms from the latest
 * result and review rules, and decide when it is fixed (the variant's rules pass and every SLO
 * of the problem's rubric holds again).
 */
import type { Registry } from '@/registry';
import type { BoardCommand, Graph } from '@/store';
import { checkProblemSlos, runRules, ruleTitle, type SloCheck } from './evaluate';
import type { ModeContext, Problem } from './types';

export type DebugVariant = Problem['debugVariants'][number];

export interface DebugCase {
  problem: Problem;
  variant: DebugVariant;
}

/** Every broken design that ships, easiest problem first. */
export function debugCases(registry: Registry): DebugCase[] {
  return registry
    .list({ kind: 'problem' })
    .slice()
    .sort((a, b) => a.level - b.level || a.title.localeCompare(b.title))
    .flatMap((problem) => problem.debugVariants.map((variant) => ({ problem, variant })));
}

export function findDebugCase(
  registry: Registry,
  problemId: string | undefined,
  variantId: string | undefined,
): DebugCase | undefined {
  if (!problemId) return undefined;
  const problem = registry.get(problemId, 'problem');
  const variant = problem?.debugVariants.find((v) => v.id === variantId);
  return problem && variant ? { problem, variant } : undefined;
}

const canon = (g: Graph) =>
  JSON.stringify({
    n: [...g.nodes].sort((a, b) => a.id.localeCompare(b.id)).map((n) => ({ ...n, position: 0 })),
    e: [...g.edges].sort((a, b) => a.id.localeCompare(b.id)),
    g: [...g.groups].sort((a, b) => a.id.localeCompare(b.id)),
  });

/** The variant this graph is (positions ignored) — e.g. a board started from Problems → Debug. */
export function matchVariant(problem: Problem | undefined, graph: Graph): DebugVariant | undefined {
  if (!problem) return undefined;
  const c = canon(graph);
  return problem.debugVariants.find((v) => canon(v.graph) === c);
}

/** One undo step: the broken design and the problem's scenario preset. */
export function loadVariantCommand(c: DebugCase): BoardCommand {
  return {
    type: 'batch',
    label: `Debug: ${c.variant.title}`,
    commands: [
      { type: 'replaceGraph', graph: structuredClone(c.variant.graph), label: 'Broken design' },
      { type: 'updateScenario', patch: structuredClone(c.problem.scenario) },
    ],
  };
}

export interface Symptom {
  kind: 'slo' | 'hot-node' | 'finding';
  text: string;
}

export interface DebugStatus {
  slos: SloCheck[];
  /** Findings of the variant's `fixedWhenRulesPass` rules. */
  findings: { ruleId: string; title: string }[];
  symptoms: Symptom[];
  /** Rules pass and every SLO holds (needs a result). */
  healthy: boolean;
}

export const HOT_NODE_UTILIZATION = 0.85;

export function debugStatus(c: DebugCase, ctx: ModeContext): DebugStatus {
  const slos = checkProblemSlos(c.problem, ctx.result, ctx.scenario);
  const ruleIds = c.variant.fixedWhenRulesPass ?? [];
  const findings = runRules(ctx.registry, ruleIds, ctx.graph, ctx.scenario, ctx.result).map(
    (f) => ({ ruleId: f.ruleId, title: f.title }),
  );
  const symptoms: Symptom[] = [];
  for (const s of slos)
    if (!s.passed && ctx.result)
      symptoms.push({ kind: 'slo', text: `${s.label} is breached: ${s.actual}` });
  if (ctx.result) {
    for (const [id, m] of Object.entries(ctx.result.perNode)) {
      if (m.utilization > HOT_NODE_UTILIZATION) {
        const label = ctx.graph.nodes.find((n) => n.id === id)?.label ?? id;
        symptoms.push({
          kind: 'hot-node',
          text: `${label} runs at ${Math.round(m.utilization * 100)} % utilisation`,
        });
      }
    }
  }
  for (const f of findings) symptoms.push({ kind: 'finding', text: `Review alert: ${f.title}` });
  const healthy = ctx.result !== null && findings.length === 0 && slos.every((s) => s.passed);
  return { slos, findings, symptoms, healthy };
}

/** Node/edge/group ids that differ between the broken design and the first reference. */
export function variantChanges(c: DebugCase): string[] {
  const ref = c.problem.referenceSolutions[0];
  if (!ref) return [];
  const out: string[] = [];
  const diff = <T extends { id: string }>(a: T[], b: T[], strip: (x: T) => unknown) => {
    const byId = new Map(b.map((x) => [x.id, JSON.stringify(strip(x))]));
    for (const x of a) if (byId.get(x.id) !== JSON.stringify(strip(x))) out.push(x.id);
    const ids = new Set(a.map((x) => x.id));
    for (const x of b) if (!ids.has(x.id)) out.push(x.id);
  };
  diff(c.variant.graph.nodes, ref.nodes, (n) => ({ ...n, position: 0 }));
  diff(c.variant.graph.edges, ref.edges, (e) => e);
  diff(c.variant.graph.groups, ref.groups, (g) => g);
  return out;
}

/** Hints from vague to explicit; each one shown costs points. */
export function debugHints(c: DebugCase, registry: Registry): string[] {
  const rules = c.variant.fixedWhenRulesPass ?? [];
  const where = variantChanges(c)
    .map((id) => {
      const g = c.variant.graph;
      const n = g.nodes.find((x) => x.id === id);
      if (n) return n.label;
      const e = g.edges.find((x) => x.id === id);
      if (e) {
        const l = (nid: string) => g.nodes.find((x) => x.id === nid)?.label ?? nid;
        return `the ${l(e.source)} → ${l(e.target)} connection`;
      }
      return g.groups.find((x) => x.id === id)?.label;
    })
    .filter((x): x is string => !!x);
  return [
    rules.length
      ? `The fault shows up in the security review (“${rules.map((r) => ruleTitle(registry, r)).join('”, “')}”), not in latency.`
      : 'The fault shows up in the metrics: find the node running hottest and ask why.',
    where.length
      ? `Look closely at ${where.join(' and ')}.`
      : 'Compare the design with what the requirements ask for.',
    c.variant.expectedFix,
  ];
}

export const DEBUG_HINT_COST = 25;
export function debugScore(hintsUsed: number): number {
  return Math.max(10, 100 - DEBUG_HINT_COST * hintsUsed);
}
