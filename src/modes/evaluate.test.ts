/** S18: SLO lookup, rubric judging and the cost score (hand-computed). */
import { describe, expect, it } from 'vitest';
import { registry } from '@/registry';
import type { SimResult } from '@/store';
import {
  checkSlo,
  costShare,
  formatSloValue,
  judgeRubric,
  rubricShare,
  scenarioPeakRps,
  sloLabel,
  sloValue,
} from './evaluate';
import { problem, simulateBoard } from './test-utils';

const result = {
  perNode: {},
  perEdge: {},
  perFlow: {
    flow_a: { p50: 10, p95: 40, p99: 80, rps: 300, errorRate: 0.01 },
    flow_b: { p50: 20, p95: 90, p99: 150, rps: 100, errorRate: 0.05 },
  },
  system: { rps: 400, availability: 0.995, costPerMonth: 1234, bottlenecks: [] },
  findings: [],
} satisfies SimResult;

describe('sloValue', () => {
  it('reads flow metrics, worst-flow latency and rps-weighted errors', () => {
    expect(sloValue(result, { metric: 'p99', op: 'lt', value: 1, flowId: 'flow_a' })).toBe(80);
    expect(sloValue(result, { metric: 'p99', op: 'lt', value: 1 })).toBe(150);
    // (0.01 × 300 + 0.05 × 100) / 400 = 0.02
    expect(sloValue(result, { metric: 'errorRate', op: 'lt', value: 1 })).toBeCloseTo(0.02, 10);
    expect(sloValue(result, { metric: 'availability', op: 'gte', value: 1 })).toBe(0.995);
    expect(sloValue(result, { metric: 'costPerMonth', op: 'lt', value: 1 })).toBe(1234);
    expect(
      sloValue(result, { metric: 'p99', op: 'lt', value: 1, flowId: 'flow_x' }),
    ).toBeUndefined();
  });

  it('checks and labels', () => {
    const c = checkSlo({ metric: 'p99', op: 'lt', value: 100, flowId: 'flow_b' }, result);
    expect(c).toMatchObject({ passed: false, actual: '150 ms' });
    expect(checkSlo({ metric: 'availability', op: 'gte', value: 0.99 }, result).passed).toBe(true);
    expect(checkSlo({ metric: 'p99', op: 'lt', value: 1 }, null).actual).toBe('no result yet');
    expect(sloLabel({ metric: 'availability', op: 'gte', value: 0.999 })).toBe(
      'availability ≥ 99.90%',
    );
    expect(formatSloValue('p99', 289_024)).toBe('> 60 s (saturated)');
    expect(formatSloValue('p99', 12_345)).toBe('12.3 s');
  });
});

describe('rubric and cost', () => {
  it('the URL shortener reference passes its whole rubric', () => {
    const p = problem('problem.url-shortener');
    const g = p.referenceSolutions[0]!;
    const lines = judgeRubric(registry, p, g, p.scenario, simulateBoard(g, p.scenario));
    expect(lines.every((l) => l.passed)).toBe(true);
    expect(rubricShare(lines)).toBe(1);
    // Without a result nothing can be judged, rule lines included.
    expect(rubricShare(judgeRubric(registry, p, g, p.scenario, null))).toBe(0);
  });

  it('cost share: full ≤ 1.25×, zero ≥ 3×, linear between', () => {
    expect(costShare(100, 100)).toBe(1);
    expect(costShare(125, 100)).toBe(1);
    expect(costShare(300, 100)).toBe(0);
    expect(costShare(212.5, 100)).toBeCloseTo(0.5, 10);
    expect(costShare(undefined, 100)).toBeUndefined();
  });

  it('peak rps = users × rps/user × share × peak', () => {
    // URL shortener: 900k users × 0.017 × (0.99 + 0.01) × 2 = 30,600
    expect(scenarioPeakRps(problem('problem.url-shortener').scenario)).toBeCloseTo(30_600, 6);
  });
});
