/**
 * S23 — anti-pattern sample board "Clinic patient portal" (registry problem
 * `problem.antipattern-patient-portal`, tags `sample` + `anti-pattern`). The broken board ships as
 * the problem's debug variant; the corrected board is its reference. These checks pin the
 * teaching contract: it loads, it is valid data, it simulates with visible symptoms, the existing
 * rules report exactly the issues NOTES.md documents (every severity included), and the corrected
 * board clears them.
 */
import { describe, expect, it } from 'vitest';
import { BoardSchema, type Graph } from '@/core';
import { reviewDesign, simulate } from '@/engine';
import { debugStatus, matchVariant, type DebugCase } from '@/modes';
import { filterProblems, findProblem, listProblems, startProblem } from '@/problems';
import { registry } from '@/registry';
import { reviewSecurity } from '@/security';
import { checkConnection, checkProtocolStack, createAppStores } from '@/store';

const ID = 'problem.antipattern-patient-portal';
const sample = findProblem(registry, ID)!;
const variant = sample.debugVariants[0]!;
const broken: Graph = variant.graph;
const fixed: Graph = sample.referenceSolutions[0]!;
const run = (graph: Graph) =>
  simulate({ graph, scenario: sample.scenario, providerId: 'generic' }, registry);
const review = (graph: Graph) =>
  reviewDesign({ graph, scenario: sample.scenario, result: run(graph), registry }).findings;

/**
 * rule id → severity → count, as NOTES.md documents them (22 findings). The notes themselves are
 * checked against the same rule ids in registry/problems/antipattern-patient-portal/notes.test.ts.
 */
const EXPECTED: Record<
  string,
  Partial<Record<'critical' | 'error' | 'warning' | 'info', number>>
> = {
  'rule.db-internet-reachable': { critical: 2 },
  'rule.open-admin-ports': { critical: 2 },
  'rule.overloaded-node': { critical: 1, error: 1 },
  'rule.plaintext-edge': { error: 1, warning: 3 },
  'rule.spof': { error: 3 },
  'rule.unbounded-retries': { error: 1 },
  'rule.no-cache-hot-read': { warning: 1 },
  'rule.no-timeout-sync-call': { warning: 1 },
  'rule.missing-service-auth': { warning: 1 },
  'rule.no-rate-limit-public-api': { warning: 1 },
  'rule.single-region-data': { warning: 1 },
  'rule.no-circuit-breaker': { info: 1 },
  'rule.secrets-in-config': { info: 1 },
  'rule.no-autoscaling': { info: 1 },
};

function tally(findings: { ruleId: string; severity: string }[]) {
  const out: Record<string, Record<string, number>> = {};
  for (const f of findings) {
    const r = (out[f.ruleId] ??= {});
    r[f.severity] = (r[f.severity] ?? 0) + 1;
  }
  return out;
}

describe('S23 anti-pattern sample — clinic patient portal', () => {
  it('is discoverable and clearly labelled as intentionally broken', () => {
    const all = listProblems(registry);
    expect(filterProblems(all, { tag: 'anti-pattern' }).map((p) => p.id)).toEqual([ID]);
    expect(filterProblems(all, { tag: 'sample' }).map((p) => p.id)).toContain(ID);
    expect(sample.title).toMatch(/^Anti-pattern sample:.*intentionally insecure/);
    expect(sample.docs.summary).toMatch(/intentionally broken/);
    expect(variant.title).toMatch(/anti-pattern sample/i);
    expect(sample.requirements.nonFunctional.join(' ')).toMatch(/INTENTIONALLY BROKEN/);
    // No company style: a broken design is not attributed to a real company.
    expect(sample.tags.some((t) => t.startsWith('company:'))).toBe(false);
  });

  it('loads the broken board in Debug mode in one step, with its scenario', () => {
    const { boardStore, workspaceStore } = createAppStores();
    const res = startProblem(workspaceStore, sample, { mode: 'debug', start: 'debug' });
    expect(res.ok).toBe(true);
    const ws = workspaceStore.getState();
    expect(BoardSchema.safeParse(ws.data.boards[ws.activeBoardId]).success).toBe(true);
    const doc = boardStore.getState().doc;
    expect(doc.graph).toEqual(broken);
    expect(doc.scenario).toEqual(sample.scenario);
    expect(matchVariant(sample, doc.graph)?.id).toBe(variant.id);
  });

  it('is valid data: every edge is drawable and the engine reports no design-data problems', () => {
    for (const g of [broken, fixed]) {
      for (const e of g.edges) {
        const others = { ...g, edges: g.edges.filter((x) => x.id !== e.id) };
        const c = checkConnection(registry, others, { source: e.source, target: e.target });
        expect(c.ok, `${e.id}: ${c.ok ? '' : c.reason}`).toBe(true);
        expect(checkProtocolStack(registry, g, e, e.protocolStack), e.id).toBeNull();
      }
      const engineFindings = review(g).filter((f) => f.source === 'engine');
      expect(engineFindings.map((f) => f.title)).toEqual([]);
      // Positions are distinct, so nothing hides behind another node.
      const at = new Set(g.nodes.map((n) => `${n.position.x},${n.position.y}`));
      expect(at.size).toBe(g.nodes.length);
    }
    // Security groups never block the board's own traffic: findings come from the design choices.
    expect(review(broken).some((f) => f.ruleId === 'rule.security-group-blocks')).toBe(false);
  });

  it('simulates with meaningful symptoms: a saturated portal, a hot database, breached SLOs', () => {
    const r = run(broken);
    expect(r.perNode.node_portal!.utilization).toBeGreaterThanOrEqual(1);
    expect(r.perNode.node_records!.utilization).toBeGreaterThanOrEqual(0.85);
    expect(r.system.bottlenecks).toEqual(expect.arrayContaining(['node_portal', 'node_records']));
    expect(r.perFlow.flow_appts!.p99).toBeGreaterThan(300);
    expect(r.perFlow.flow_labs!.p99).toBeGreaterThan(400);
    for (const f of Object.values(r.perFlow)) expect(f.rps).toBeGreaterThan(0);
  });

  it('the review reports exactly the documented issues, at every severity', () => {
    const findings = review(broken);
    expect(tally(findings)).toEqual(EXPECTED);
    const severities = new Set(findings.map((f) => f.severity));
    for (const s of ['critical', 'error', 'warning', 'info']) expect(severities).toContain(s);
    // The security panel shows the threat findings too.
    const sec = reviewSecurity({ graph: broken, scenario: sample.scenario, registry });
    expect(new Set(sec.map((f) => f.ruleId))).toEqual(
      new Set([
        'rule.db-internet-reachable',
        'rule.open-admin-ports',
        'rule.plaintext-edge',
        'rule.missing-service-auth',
        'rule.no-rate-limit-public-api',
        'rule.single-region-data',
        'rule.secrets-in-config',
      ]),
    );
  });

  it('the corrected board clears every issue except the documented single-region warning', () => {
    const findings = review(fixed);
    expect(findings.map((f) => `${f.severity} ${f.ruleId}`)).toEqual([
      'warning rule.single-region-data',
    ]);
    const r = run(fixed);
    for (const [id, n] of Object.entries(r.perNode)) expect(n.utilization, id).toBeLessThan(0.6);
    const c: DebugCase = { problem: sample, variant };
    const ctx = {
      boardId: 'board_test',
      graph: fixed,
      scenario: sample.scenario,
      problem: sample,
      result: r,
      registry,
      nowMs: 0,
    };
    expect(debugStatus(c, ctx).healthy).toBe(true);
    expect(debugStatus(c, { ...ctx, graph: broken, result: run(broken) }).healthy).toBe(false);
  });
});
