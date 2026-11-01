/** S20: "Push to scenario" — estimate → Scenario patch. */
import { describe, expect, it } from 'vitest';
import { ScenarioSchema, type Flow, type Scenario } from '@/core';
import {
  DEFAULT_ESTIMATOR_INPUTS,
  distributeUsers,
  estimate,
  isWriteFlow,
  scenarioPatchFromEstimate,
} from './index';

const scenario = (patch: Partial<Scenario> = {}): Scenario => ({
  usersByRegion: { 'north-america': 1000 },
  flows: [],
  peakMultiplier: 2,
  diurnal: true,
  payloadBytes: { req: 1000, res: 10_000 },
  events: [],
  seed: 1,
  durationSec: 60,
  ...patch,
});
const flow = (id: string, share: number, op: 'read' | 'write'): Flow => ({
  id,
  name: id,
  share,
  rpsPerUser: 0.01,
  path: [
    { nodeId: 'node_api', op: 'read' },
    ...(op === 'write' ? [{ nodeId: 'node_db', op }] : []),
  ],
});
/** Engine load formula without the daily cycle: Σ users × rpsPerUser × share. */
const avgRps = (s: Scenario) => {
  const users = Object.values(s.usersByRegion).reduce((a, b) => a + b, 0);
  return s.flows.reduce((sum, f) => sum + users * f.rpsPerUser * f.share, 0);
};

const est = estimate(DEFAULT_ESTIMATOR_INPUTS); // 100M DAU, 10/day, 10:1, 10 KB, peak 2

describe('scenarioPatchFromEstimate', () => {
  it('F12: the pushed scenario generates the estimated average QPS', () => {
    const before = scenario();
    const { patch, summary } = scenarioPatchFromEstimate(est, before);
    const after = ScenarioSchema.parse({ ...before, ...patch });
    expect(avgRps(after)).toBeCloseTo(11_574.074, 2);
    expect(after.peakMultiplier).toBe(2);
    expect(after.diurnal).toBe(false);
    expect(summary).toBe('100M users · 1 flow · peak ×2 → 11.6k avg rps, 23.1k peak rps');
    expect(before.flows).toEqual([]); // not mutated
  });

  it('adds one graph-following flow when there are none', () => {
    const { patch, notes } = scenarioPatchFromEstimate(est, scenario(), {
      newFlowId: () => 'flow_x',
    });
    expect(patch.flows).toEqual([
      {
        id: 'flow_x',
        name: 'All traffic (estimator)',
        share: 1,
        rpsPerUser: 10 / 86_400,
        path: [],
      },
    ]);
    expect(notes.join(' ')).toMatch(/Added one flow/);
    expect(scenarioPatchFromEstimate(est, scenario()).patch.flows[0]?.id).toBe('flow_estimator');
  });

  it('splits shares between read and write flows by the ratio, keeping relative weights', () => {
    const s = scenario({
      flows: [
        flow('flow_feed', 0.6, 'read'),
        flow('flow_profile', 0.2, 'read'),
        flow('flow_post', 0.2, 'write'),
      ],
    });
    const { patch } = scenarioPatchFromEstimate(est, s);
    const share = (id: string) => patch.flows.find((f) => f.id === id)?.share;
    expect(share('flow_feed')).toBeCloseTo((10 / 11) * 0.75, 10);
    expect(share('flow_profile')).toBeCloseTo((10 / 11) * 0.25, 10);
    expect(share('flow_post')).toBeCloseTo(1 / 11, 10);
    expect(avgRps({ ...s, ...patch })).toBeCloseTo(11_574.074, 2);
    // Names and paths are kept.
    expect(patch.flows.map((f) => f.name)).toEqual(['flow_feed', 'flow_profile', 'flow_post']);
  });

  it('gives all traffic to the flows when they are all reads (equal split if shares are 0)', () => {
    const s = scenario({ flows: [flow('flow_a', 0, 'read'), flow('flow_b', 0, 'read')] });
    const { patch, notes } = scenarioPatchFromEstimate(est, s);
    expect(patch.flows.map((f) => f.share)).toEqual([0.5, 0.5]);
    expect(notes.join(' ')).toMatch(/Every flow is a read/);
  });

  it('keeps region proportions and sets payloads to the per-request average', () => {
    const s = scenario({ usersByRegion: { 'north-america': 3000, europe: 1000 } });
    const { patch } = scenarioPatchFromEstimate(est, s);
    expect(patch.usersByRegion).toEqual({ 'north-america': 75_000_000, europe: 25_000_000 });
    expect(patch.payloadBytes).toEqual({ req: 909, res: 9091 }); // 10 KB × 1/11, × 10/11
  });
});

describe('distributeUsers', () => {
  it('puts everyone in the default region when there are no users', () => {
    expect(distributeUsers({}, 500)).toEqual({ 'north-america': 500 });
    expect(distributeUsers({ europe: 0, asia: 0 }, 5)).toEqual({ europe: 3, asia: 2 });
  });
  it('gives the rounding remainder to the biggest region so the total is exact', () => {
    const out = distributeUsers({ a: 1, b: 1, c: 1 }, 100);
    expect(Object.values(out).reduce((x, y) => x + y, 0)).toBe(100);
  });
});

describe('isWriteFlow', () => {
  it('is true when any step writes', () => {
    expect(isWriteFlow(flow('flow_a', 1, 'write'))).toBe(true);
    expect(isWriteFlow(flow('flow_a', 1, 'read'))).toBe(false);
  });
});
