/**
 * Pipeline step 2 — generate load. Per flow: λ = users × rpsPerUser × share × peakMultiplier.
 * (Per-region diurnal curves need local time zones: S10 geo.)
 */
import type { Flow, Scenario } from '@/core';
import { fmt } from './format';
import type { EngineOptions } from './types';

/** Id of the flow created when a scenario has none. A flow with an empty path follows the graph. */
export const INFERRED_FLOW_ID = 'flow_inferred';

export interface FlowLoad {
  flow: Flow;
  /** Arrival rate at peak (rps). */
  rps: number;
  explain: string;
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
  return flows.map((flow) => {
    const rps = users * flow.rpsPerUser * flow.share * peak;
    return {
      flow,
      rps,
      explain: `λ = users × rpsPerUser × share × peak = ${fmt(users)} × ${fmt(flow.rpsPerUser)} × ${fmt(flow.share)} × ${fmt(peak)} = ${fmt(rps)} rps`,
    };
  });
}
