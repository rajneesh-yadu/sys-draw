/** Public API smoke tests against the real registry. */
import { describe, expect, it } from 'vitest';
import { SimResultSchema, type EdgeInstance, type Graph, type NodeInstance } from '@/core';
import { registry } from '@/registry';
import { BEHAVIORS, compile, INFERRED_FLOW_ID, runSimulation, simulate } from './index';
import { scenario } from './test-fixtures';

function n(id: string, defId: string, instanceType: string, replicas = 1): NodeInstance {
  return {
    id,
    defId,
    label: id,
    position: { x: 0, y: 0 },
    ...(defId.startsWith('client.') ? {} : { groupId: 'grp_r' }),
    config: {},
    scaling: { replicas, instanceType },
  };
}
function e(id: string, source: string, target: string): EdgeInstance {
  return { id, source, target, protocolStack: ['tcp', 'http2'], sync: true, config: {} };
}

const g: Graph = {
  groups: [{ id: 'grp_r', kind: 'region', label: 'US East', regionId: 'us-east-1' }],
  nodes: [
    n('node_c', 'client.app', 'browser'),
    n('node_lb', 'network.load-balancer', 'standard'),
    n('node_a', 'compute.app-server', 'medium', 2),
    n('node_db', 'database.sql', 'medium'),
  ],
  edges: [
    e('edge_1', 'node_c', 'node_lb'),
    e('edge_2', 'node_lb', 'node_a'),
    e('edge_3', 'node_a', 'node_db'),
  ],
};

describe('engine public API', () => {
  it('ships the three S07 behaviors', () => {
    expect([...BEHAVIORS.keys()].sort()).toEqual(['cache', 'loadBalancer', 'queue']);
  });

  it('compiles real components and attaches regions', () => {
    const m = compile(g, registry);
    expect(m.nodes.get('node_a')?.regionId).toBe('us-east-1');
    expect(m.nodes.get('node_c')?.kind).toBe('source');
    expect(m.nodes.get('node_a')?.serversPerInstance).toBe(200);
    expect(m.issues).toEqual([]);
  });

  it('simulates a real board', () => {
    const r = simulate({ graph: g, scenario: scenario(1000) }, registry);
    expect(SimResultSchema.safeParse(r).success).toBe(true);
    expect(r.perNode.node_db?.rpsIn).toBeCloseTo(100, 9);
    // LB: c = 50 000 ⇒ no queueing, T = S = 0.5 ms
    expect(r.perNode.node_lb?.latencyMs.p50).toBeCloseTo(0.5 * Math.LN2, 6);
  });

  it('runSimulation falls back to in-thread without Web Workers', async () => {
    const board = { graph: g, scenario: scenario(1000), providerId: 'generic' as const };
    const r = await runSimulation(board);
    expect(r).toEqual(simulate(board, registry));
    expect(r.perFlow[INFERRED_FLOW_ID]?.rps).toBeCloseTo(100, 9);
  });
});
