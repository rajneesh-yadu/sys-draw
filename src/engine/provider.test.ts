/**
 * S12 — provider prices and limits through the whole pipeline, on the real registry.
 * Expected costs are hand-computed from the provider price tables (730 h/month, 2.628 M s/month).
 */
import { describe, expect, it } from 'vitest';
import type { ProviderId } from '@/core';
import { registry } from '@/registry';
import { simulate } from './simulate';
import { edge, flow, graph, node, scenario } from './test-fixtures';

function run(
  providerId: ProviderId,
  defId: string,
  rps: number,
  op: 'read' | 'write' = 'read',
  config: Record<string, unknown> = {},
  instanceType = 'small',
) {
  const g = graph(
    [node('c', 'client.app', 1, {}, 'browser'), node('x', defId, 1, config, instanceType)],
    [edge('c', 'x')],
  );
  return simulate(
    { graph: g, scenario: scenario(rps, [flow('f', ['c', 'x'], op)]), providerId },
    registry,
  );
}
const cost = (r: ReturnType<typeof run>) => r.perNode.node_x!.costPerMonth;
const limitTitles = (r: ReturnType<typeof run>) =>
  r.findings.filter((f) => f.ruleId === 'engine.limits').map((f) => f.title);

describe('provider prices', () => {
  it('app server: the same size costs each provider’s VM price', () => {
    expect(cost(run('generic', 'compute.app-server', 10))).toBeCloseTo(0.096 * 730, 6); // 70.08
    expect(cost(run('aws', 'compute.app-server', 10))).toBeCloseTo(0.1008 * 730, 6); // 73.584
    expect(cost(run('gcp', 'compute.app-server', 10))).toBeCloseTo(0.0971 * 730, 6); // 70.883
    const aws = run('aws', 'compute.app-server', 10).perNode.node_x!.explain.costPerMonth;
    expect(aws).toMatch(/m7i\.large at \$0\.1008\/h, AWS price table, us-east-1, as of 2026-10-01/);
  });

  it('RDS: db.m6i.large + gp3 storage', () => {
    // 0.171 × 730 = 124.83; 100 GB × 1 copy × $0.115 = 11.50
    expect(cost(run('aws', 'database.sql', 10))).toBeCloseTo(124.83 + 11.5, 6);
  });

  it('DynamoDB: priced per request, storage per copy', () => {
    // 100 rps × 2.628 M s = 262.8 M requests × $0.25/M = 65.70; 100 GB × 3 × $0.0833 = 24.99
    const r = run('aws', 'database.nosql', 100);
    expect(cost(r)).toBeCloseTo(65.7 + 24.99, 6);
    expect(r.perNode.node_x!.explain.costPerMonth).toMatch(/as of 2026-10-01, approximate/);
  });

  it('managed request price per service: API Gateway on AWS vs generic', () => {
    // 10 rps × 2.628 M = 26.28 M requests: × $3.50 = 91.98 (AWS) vs × $0.40 = 10.512 (generic)
    expect(cost(run('aws', 'network.api-gateway', 10, 'read', {}, 'managed'))).toBeCloseTo(
      91.98,
      6,
    );
    expect(cost(run('generic', 'network.api-gateway', 10, 'read', {}, 'managed'))).toBeCloseTo(
      10.512,
      6,
    );
  });
});

describe('provider limits', () => {
  const fn = (p: ProviderId, concurrencyLimit: number) =>
    run(p, 'compute.serverless-function', 1, 'read', { concurrencyLimit }, '1024mb');

  it('Lambda concurrency above the 1,000 default quota is a warning (AWS only at 1,000)', () => {
    expect(limitTitles(fn('aws', 2000))).toEqual([
      'AWS limit: Concurrent executions per region (default quota)',
    ]);
    expect(limitTitles(fn('aws', 1000))).toEqual([]);
    expect(limitTitles(fn('generic', 2000))).toEqual([]);
    // Cloud Run functions default max instances is 100
    expect(limitTitles(fn('gcp', 500))).toEqual([
      'GCP limit: Max instances per function (default)',
    ]);
    const f = fn('aws', 2000).findings.find((x) => x.ruleId === 'engine.limits')!;
    expect(f.severity).toBe('warning');
    expect(f.message).toMatch(
      /concurrencyLimit = 2000 exceeds 1000 executions.*request an increase/,
    );
  });

  it('DynamoDB per-partition writes: hottest shard = λ × max(1/S, skew)', () => {
    const ddb = (partitions: number, hotKeySkew = 0) =>
      limitTitles(run('aws', 'database.nosql', 1500, 'write', { partitions, hotKeySkew }));
    expect(ddb(1)).toContain('AWS limit: Writes per partition (≤ 1 KB)'); // 1500 > 1000
    expect(ddb(2)).not.toContain('AWS limit: Writes per partition (≤ 1 KB)'); // 750
    expect(ddb(4, 0.8)).toContain('AWS limit: Writes per partition (≤ 1 KB)'); // 1200
    const msg = run('aws', 'database.nosql', 1500, 'write', {
      partitions: 4,
      hotKeySkew: 0.8,
    }).findings.find((x) => x.title.includes('Writes per partition'))!.message;
    expect(msg).toMatch(
      /hottest shard = 1,?500 × 0\.8 = 1,?200 rps exceeds 1,?000 writes\/s.*hard limit/,
    );
  });

  it('a provider-only component on another cloud is flagged', () => {
    const r = run('aws', 'database.spanner', 10, 'read', {}, 'node');
    expect(limitTitles(r)).toEqual(['No AWS equivalent']);
    expect(limitTitles(run('gcp', 'database.spanner', 10, 'read', {}, 'node'))).toEqual([]);
  });
});
