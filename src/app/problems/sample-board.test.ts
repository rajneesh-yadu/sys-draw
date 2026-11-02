/**
 * S22 — sample reference board "E-commerce storefront & checkout" (registry problem
 * `problem.sample-ecommerce`, tag `sample`). Beyond the generic reference checks in
 * references.test.ts, the sample must be discoverable, broad (most component categories) without
 * idle filler, legible (left-to-right, no overlaps) and pass the whole design review cleanly.
 */
import { describe, expect, it } from 'vitest';
import type { Graph } from '@/core';
import { reviewDesign, simulate } from '@/engine';
import { filterProblems, findProblem, listProblems, startProblem } from '@/problems';
import { registry } from '@/registry';
import { createAppStores } from '@/store';

const ID = 'problem.sample-ecommerce';
const sample = findProblem(registry, ID)!;
const graph: Graph = sample.referenceSolutions[0]!;
const defOf = (defId: string) => registry.require(defId, 'component');

describe('S22 sample board — e-commerce storefront', () => {
  it('is discoverable in the problem library by its tag and title', () => {
    expect(sample).toBeDefined();
    const all = listProblems(registry);
    expect(filterProblems(all, { tag: 'sample' }).map((p) => p.id)).toContain(ID);
    expect(filterProblems(all, { query: 'sample board' }).map((p) => p.id)).toContain(ID);
    expect(sample.title).toMatch(/^Sample board:/);
    expect(sample.docs?.summary).toBeTruthy();
  });

  it('loads as a reference onto a new board in one step, with its scenario', () => {
    const { boardStore, workspaceStore } = createAppStores();
    const res = startProblem(workspaceStore, sample, { mode: 'sandbox', start: 'reference' });
    expect(res.ok).toBe(true);
    const doc = boardStore.getState().doc;
    expect(doc.graph).toEqual(graph);
    expect(doc.scenario.flows.map((f) => f.id)).toEqual(sample.scenario.flows.map((f) => f.id));
  });

  it('uses components from at least 8 of the 9 categories', () => {
    const used = new Set(graph.nodes.map((n) => defOf(n.defId).category));
    for (const c of [
      'clients',
      'network',
      'security',
      'compute',
      'cache',
      'database',
      'storage',
      'messaging',
      'observability',
    ])
      expect(used, c).toContain(c);
  });

  it('connects every node and puts every data-plane node on a scenario flow', () => {
    const linked = new Set(graph.edges.flatMap((e) => [e.source, e.target]));
    for (const n of graph.nodes) expect(linked.has(n.id), n.label).toBe(true);
    const onFlow = new Set(sample.scenario.flows.flatMap((f) => f.path.map((s) => s.nodeId)));
    // Control plane (DNS lookup, credentials, keys, roles), monitoring, ops access, the batched
    // analytics sink and the DR copy are reached by edges only: they carry no per-request load.
    const offFlow = graph.nodes.filter((n) => !onFlow.has(n.id)).map((n) => n.id);
    expect(offFlow.sort()).toEqual(
      [
        'node_dns',
        'node_metrics',
        'node_secrets',
        'node_kms',
        'node_iam',
        'node_bastion',
        'node_analytics',
      ].sort(),
    );
  });

  it('has a legible left-to-right layout', () => {
    const at = new Set(graph.nodes.map((n) => `${n.position.x},${n.position.y}`));
    expect(at.size).toBe(graph.nodes.length); // no two nodes on the same spot
    const x = (id: string) => graph.nodes.find((n) => n.id === `node_${id}`)!.position.x;
    expect(x('client')).toBe(Math.min(...graph.nodes.map((n) => n.position.x)));
    // Request flow reads left to right: user → edge → DMZ → services → data → async → DR.
    const order = ['client', 'shield', 'waf', 'gw', 'mesh', 'store', 'orders', 'stream', 'dr'];
    const xs = order.map(x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(new Set(xs).size).toBe(xs.length);
    for (const n of graph.nodes) expect(n.label.length, n.id).toBeLessThanOrEqual(50);
  });

  it('draws group boxes that do not overlap their siblings or cover outside nodes', () => {
    // A group box is drawn around its descendants; approximate each node as 200 × 100 px.
    const W = 200;
    const H = 100;
    const parentOf = (id: string | undefined) => graph.groups.find((g) => g.id === id)?.parentId;
    const inGroup = (n: Graph['nodes'][number], gid: string) => {
      for (let g = n.groupId; g !== undefined; g = parentOf(g)) if (g === gid) return true;
      return false;
    };
    const box = (gid: string) => {
      const ns = graph.nodes.filter((n) => inGroup(n, gid));
      return {
        x0: Math.min(...ns.map((n) => n.position.x)),
        y0: Math.min(...ns.map((n) => n.position.y)),
        x1: Math.max(...ns.map((n) => n.position.x + W)),
        y1: Math.max(...ns.map((n) => n.position.y + H)),
      };
    };
    type Box = ReturnType<typeof box>;
    const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
    for (const a of graph.groups)
      for (const b of graph.groups)
        if (a.id < b.id && a.parentId === b.parentId)
          expect(overlaps(box(a.id), box(b.id)), `${a.label} / ${b.label}`).toBe(false);
    for (const g of graph.groups)
      for (const n of graph.nodes) {
        if (inGroup(n, g.id)) continue;
        const p = {
          x0: n.position.x,
          y0: n.position.y,
          x1: n.position.x + W,
          y1: n.position.y + H,
        };
        expect(overlaps(box(g.id), p), `${n.label} inside ${g.label}`).toBe(false);
      }
  });

  it('places data stores in data subnets and edge services in the DMZ', () => {
    const zoneOf = (groupId: string | undefined) =>
      graph.groups.find((g) => g.id === groupId)?.security?.zone;
    for (const n of graph.nodes) {
      const cat = defOf(n.defId).category;
      if (cat === 'database' || cat === 'cache') expect(zoneOf(n.groupId), n.label).toBe('data');
    }
    for (const id of ['node_waf', 'node_gw', 'node_bastion'])
      expect(zoneOf(graph.nodes.find((n) => n.id === id)!.groupId), id).toBe('dmz');
    const regions = graph.groups.filter((g) => g.kind === 'region').map((g) => g.regionId);
    expect(regions).toEqual(['us-east', 'us-west-2']);
  });

  it('simulates at peak with headroom and passes the full design review', () => {
    const scenario = sample.scenario;
    const result = simulate({ graph, scenario, providerId: 'generic' }, registry);
    expect(result.system.bottlenecks).toEqual([]);
    for (const [id, n] of Object.entries(result.perNode))
      expect(n.utilization, id).toBeLessThan(0.75);
    expect(result.system.rps).toBeCloseTo(100_000, -2);
    const review = reviewDesign({ graph, scenario, result, registry });
    expect(review.findings.map((f) => `${f.severity}: ${f.title}`)).toEqual([]);
  });
});
