/** S18 Debug mode: every shipped broken design shows symptoms, and restoring the fault fixes it. */
import { describe, expect, it } from 'vitest';
import { registry } from '@/registry';
import { checkConnection, checkProtocolStack, type Graph } from '@/store';
import debugMode, { type DebugState } from './controllers/debug';
import {
  debugCases,
  debugHints,
  debugScore,
  debugStatus,
  matchVariant,
  variantChanges,
  type DebugCase,
} from './debug';
import { problemCtx, simulateBoard } from './test-utils';

const cases = debugCases(registry);

/** The reference's version of every element the variant changed. */
function restore(c: DebugCase): Graph {
  const ref = c.problem.referenceSolutions[0]!;
  const g = structuredClone(c.variant.graph);
  for (const id of variantChanges(c)) {
    for (const k of ['nodes', 'edges', 'groups'] as const) {
      const fixed = (ref[k] as { id: string }[]).find((x) => x.id === id);
      const list = g[k] as { id: string }[];
      const i = list.findIndex((x) => x.id === id);
      if (fixed && i >= 0) list[i] = structuredClone(fixed);
    }
  }
  return g;
}

describe('debug variants (S18)', () => {
  it('ships at least five broken designs across problems', () => {
    expect(cases.length).toBeGreaterThanOrEqual(5);
    expect(new Set(cases.map((c) => c.problem.id)).size).toBeGreaterThanOrEqual(5);
  });

  describe.each(cases.map((c) => [`${c.problem.id} / ${c.variant.id}`, c] as const))(
    '%s',
    (_n, c) => {
      it('is drawable: every edge passes the connection and stack checks', () => {
        for (const e of c.variant.graph.edges) {
          const others = {
            ...c.variant.graph,
            edges: c.variant.graph.edges.filter((x) => x.id !== e.id),
          };
          const ok = checkConnection(registry, others, { source: e.source, target: e.target });
          expect(ok.ok, e.id).toBe(true);
          expect(
            checkProtocolStack(registry, c.variant.graph, e, e.protocolStack),
            e.id,
          ).toBeNull();
        }
      });

      it('is broken: symptoms show and it is not healthy', () => {
        const ctx = problemCtx(c.problem, c.variant.graph);
        const st = debugStatus(c, ctx);
        expect(st.healthy).toBe(false);
        expect(st.symptoms.length).toBeGreaterThan(0);
        expect(matchVariant(c.problem, c.variant.graph)?.id).toBe(c.variant.id);
        expect(variantChanges(c).length).toBeGreaterThan(0);
        expect(debugHints(c, registry)).toHaveLength(3);
      });

      it('is fixed by restoring what was broken', () => {
        const ctx = problemCtx(c.problem, restore(c));
        const st = debugStatus(c, ctx);
        expect(st.symptoms.map((s) => s.text)).toEqual([]);
        expect(st.healthy).toBe(true);
      });
    },
  );

  it('controller: broken result → fix → fixed (scored by hints)', () => {
    const c = cases.find((x) => x.problem.id === 'problem.url-shortener')!;
    const broken = problemCtx(c.problem, c.variant.graph);
    let s: DebugState = debugMode.onEnter(broken);
    expect(s.variantId).toBe(c.variant.id);
    expect(s.stale).toBe(true);
    s = debugMode.onSimResult(s, broken);
    expect(s.sawBroken).toBe(true);
    expect(debugMode.isComplete(s, broken)).toBe(false);
    s = debugMode.onAction!(s, { type: 'hint' }, broken);
    const fixedGraph = restore(c);
    const fixed = {
      ...broken,
      graph: fixedGraph,
      result: broken.result,
      nowMs: broken.nowMs + 5000,
    };
    s = debugMode.onGraphChange(s, fixed);
    expect(s.stale).toBe(true);
    // A result still for the broken graph (stale) would not count; a fresh one does.
    s = debugMode.onSimResult(s, { ...fixed, result: simulateBoard(fixedGraph, fixed.scenario) });
    expect(debugMode.isComplete(s, fixed)).toBe(true);
    expect(debugMode.score!(s, fixed)).toBe(debugScore(1));
    expect(debugMode.subject!(s, fixed)?.id).toBe('problem.url-shortener');
  });

  it('a healthy design loaded straight away is not "fixed" (it was never broken)', () => {
    const c = cases[0]!;
    const ctx = problemCtx(c.problem, c.problem.referenceSolutions[0]!);
    let s: DebugState = {
      problemId: c.problem.id,
      variantId: c.variant.id,
      stale: true,
      sawBroken: false,
      hintsUsed: 0,
    };
    s = debugMode.onSimResult(s, ctx);
    expect(debugMode.isComplete(s, ctx)).toBe(false);
  });
});
