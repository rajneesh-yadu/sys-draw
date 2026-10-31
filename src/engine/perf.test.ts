/** Non-functional budget (ARCHITECTURE.md): a 300-node analytical run well under 1 s. */
import { describe, expect, it } from 'vitest';
import { simulate } from './simulate';
import { edge, graph, node, scenario, testRegistry as reg } from './test-fixtures';

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
});
