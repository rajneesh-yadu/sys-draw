/** Non-functional budget (ARCHITECTURE.md): a 300-node analytical run well under 1 s. */
import { describe, expect, it } from 'vitest';
import { simulate } from './simulate';
import {
  edge,
  geoTestRegistry,
  graph,
  node,
  scenario,
  testRegistry as reg,
  worldUsers,
} from './test-fixtures';

describe('performance', () => {
  it('simulates 300 nodes (LB ×20 → 296 servers → shared cache + db) in < 1 s', () => {
    const apps = Array.from({ length: 296 }, (_, i) => `app${i}`);
    const g = graph(
      [
        node('c', 'client.test'),
        node('lb', 'network.lb', 20),
        ...apps.map((a) => node(a, 'compute.app')),
        node('cache', 'cache.test', 4),
        node('db', 'database.test', 4),
      ],
      [edge('c', 'lb'), ...apps.flatMap((a) => [edge('lb', a), edge(a, 'cache'), edge(a, 'db')])],
    );
    const t0 = performance.now();
    const r = simulate({ graph: g, scenario: scenario(10_000) }, reg, { defaultRpsPerUser: 1 });
    const ms = performance.now() - t0;
    expect(Object.keys(r.perNode)).toHaveLength(300);
    expect(r.perNode.node_db?.rpsIn).toBeCloseTo(10_000 * 0.2, 6);
    expect(ms).toBeLessThan(1000);
  });

  it('geo: the same 300 nodes in two regions, users in every user region, in < 1 s', () => {
    const apps = Array.from({ length: 296 }, (_, i) => `app${i}`);
    const region = (i: number) => (i % 2 === 0 ? 'grp_use' : 'grp_aps');
    const base = graph(
      [
        node('c', 'client.test'),
        { ...node('lb', 'network.lb', 20), groupId: 'grp_use' },
        ...apps.map((a, i) => ({ ...node(a, 'compute.app'), groupId: region(i) })),
        { ...node('cache', 'cache.test', 4), groupId: 'grp_use' },
        { ...node('db', 'database.test', 4), groupId: 'grp_use' },
      ],
      [edge('c', 'lb'), ...apps.flatMap((a) => [edge('lb', a), edge(a, 'cache'), edge(a, 'db')])],
    );
    const g = {
      ...base,
      groups: [
        { id: 'grp_use', kind: 'region' as const, label: 'US', regionId: 'us-east' },
        { id: 'grp_aps', kind: 'region' as const, label: 'IN', regionId: 'ap-south' },
      ],
    };
    const t0 = performance.now();
    const r = simulate(
      { graph: g, scenario: scenario(0, [], { usersByRegion: worldUsers(9000), diurnal: true }) },
      geoTestRegistry,
      { defaultRpsPerUser: 1 },
    );
    const ms = performance.now() - t0;
    expect(Object.keys(r.perRegion ?? {})).toHaveLength(9);
    expect(ms).toBeLessThan(1000);
  });
});
