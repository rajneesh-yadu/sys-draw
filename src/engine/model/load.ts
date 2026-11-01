/**
 * Pipeline step 2 — generate load. Per flow and user region r:
 *   λ_r = users_r × rpsPerUser × share × peakMultiplier × f_r
 * f_r = 1 with the daily cycle off; with it on, the region's diurnal factor at the busiest UTC
 * moment (geo/diurnal.ts). The flow's λ is Σ λ_r.
 */
import type { Flow, Scenario } from '@/core';
import { userRegion } from '@/registry';
import { diurnalPeak } from '../geo/diurnal';
import { fmt } from './format';
import type { EngineOptions } from './types';

/** Id of the flow created when a scenario has none. A flow with an empty path follows the graph. */
export const INFERRED_FLOW_ID = 'flow_inferred';

export interface RegionLoad {
  /** User region id (a `usersByRegion` key). */
  regionId: string;
  users: number;
  /** Daily-cycle multiplier at the evaluated moment (1 when the cycle is off). */
  diurnal: number;
  rps: number;
  explain: string;
}

export interface FlowLoad {
  flow: Flow;
  /** Arrival rate at peak (rps) = Σ byRegion rps. */
  rps: number;
  explain: string;
  /** Per user region, in `usersByRegion` order (S10). */
  byRegion: RegionLoad[];
}

export function totalUsers(scenario: Scenario): number {
  return Object.values(scenario.usersByRegion).reduce((s, u) => s + u, 0);
}

/** Default flow inference: one read flow, share 1, starting at every client node. */
export function inferFlow(options: Pick<EngineOptions, 'defaultRpsPerUser'>): Flow {
  return {
    id: INFERRED_FLOW_ID,
    name: 'All traffic (inferred from clients)',
    share: 1,
    rpsPerUser: options.defaultRpsPerUser,
    path: [],
  };
}

export function generateLoad(
  scenario: Scenario,
  flows: readonly Flow[] = scenario.flows,
): FlowLoad[] {
  const users = totalUsers(scenario);
  const peak = scenario.peakMultiplier;
  const regions = Object.entries(scenario.usersByRegion).map(([id, u]) => ({
    id,
    users: u,
    utcOffsetHours: userRegion(id)?.utcOffsetHours,
  }));
  const day = diurnalPeak(regions, scenario.diurnal);
  return flows.map((flow) => {
    const byRegion = regions.map((r): RegionLoad => {
      const f = day.factors.get(r.id) ?? 1;
      const rps = r.users * flow.rpsPerUser * flow.share * peak * f;
      return {
        regionId: r.id,
        users: r.users,
        diurnal: f,
        rps,
        explain:
          `λ = users × rpsPerUser × share × peak${scenario.diurnal ? ' × daily cycle' : ''} = ` +
          `${fmt(r.users)} × ${fmt(flow.rpsPerUser)} × ${fmt(flow.share)} × ${fmt(peak)}` +
          `${scenario.diurnal ? ` × ${fmt(f)}` : ''} = ${fmt(rps)} rps` +
          (scenario.diurnal ? ` (${day.explain.get(r.id) ?? ''})` : ''),
      };
    });
    const rps = byRegion.reduce((s, r) => s + r.rps, 0);
    return {
      flow,
      rps,
      byRegion,
      explain: scenario.diurnal
        ? `λ = Σ regions users × rpsPerUser × share × peak × daily-cycle factor = ${fmt(rps)} rps (busiest moment of the day; ${fmt(users)} users at their local peaks)`
        : `λ = users × rpsPerUser × share × peak = ${fmt(users)} × ${fmt(flow.rpsPerUser)} × ${fmt(flow.share)} × ${fmt(peak)} = ${fmt(rps)} rps`,
    };
  });
}
