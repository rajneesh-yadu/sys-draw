/**
 * "Push to scenario": turn an estimate into a shallow Scenario patch the store's
 * `updateScenario` command can apply. The engine generates load as
 *   λ = users × rpsPerUser × share × peakMultiplier (× daily-cycle factor)
 * so with users = DAU and rpsPerUser = actions/user/day ÷ 86 400 the simulated average equals the
 * estimator's QPS_avg, and peakMultiplier = peak factor gives its QPS_peak.
 */
import { SECONDS_PER_DAY, newId, type Flow, type Scenario } from '@/core';
import { formatCount, type Estimate } from './estimate';

/** User region used when the scenario has no users yet. */
export const DEFAULT_USER_REGION = 'north-america';

export type ScenarioPatch = Pick<
  Scenario,
  'usersByRegion' | 'flows' | 'peakMultiplier' | 'diurnal' | 'payloadBytes'
>;

export interface ScenarioPush {
  patch: ScenarioPatch;
  /** One-line summary for a notice, e.g. "100M users · 2 flows · peak ×2 → 11.6k avg rps". */
  summary: string;
  /** What was assumed or changed beyond the plain numbers. */
  notes: string[];
}

export interface ScenarioPushOptions {
  /** Id for a flow created when the scenario has none (default `flow_estimator`). */
  newFlowId?: () => string;
  /** Region that gets every user when the scenario has none (default `north-america`). */
  defaultRegionId?: string;
}

/** A flow writes when any step on its path is a write; an empty path follows the graph as a read. */
export function isWriteFlow(flow: Flow): boolean {
  return flow.path.some((s) => s.op === 'write');
}

/**
 * Spread `total` users over the scenario's regions in their current proportions (whole users, rounded down;
 * the remainder goes to the biggest region). No users yet → all in `defaultRegionId`.
 */
export function distributeUsers(
  current: Readonly<Record<string, number>>,
  total: number,
  defaultRegionId: string = DEFAULT_USER_REGION,
): Record<string, number> {
  const entries = Object.entries(current);
  const sum = entries.reduce((s, [, u]) => s + u, 0);
  if (sum <= 0) {
    const ids = entries.length > 0 ? entries.map(([id]) => id) : [defaultRegionId];
    // No proportions to keep: split evenly.
    return spread(
      ids.map((id) => [id, 1]),
      ids.length,
      total,
    );
  }
  return spread(entries, sum, total);
}

function spread(
  weights: readonly (readonly [string, number])[],
  sum: number,
  total: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  let assigned = 0;
  let biggest = weights[0]?.[0] ?? DEFAULT_USER_REGION;
  let biggestWeight = -1;
  for (const [id, w] of weights) {
    const u = Math.floor((total * w) / sum);
    out[id] = u;
    assigned += u;
    if (w > biggestWeight) {
      biggest = id;
      biggestWeight = w;
    }
  }
  out[biggest] = Math.max(0, (out[biggest] ?? 0) + Math.round(total) - assigned);
  return out;
}

/** Split `total` share over flows in proportion to their current shares (equal if all are 0). */
function reshare(flows: readonly Flow[], total: number): Map<string, number> {
  const sum = flows.reduce((s, f) => s + f.share, 0);
  return new Map(
    flows.map((f) => [f.id, sum > 0 ? (total * f.share) / sum : total / flows.length]),
  );
}

/** Build the scenario patch for an estimate. Pure; never mutates `scenario`. */
export function scenarioPatchFromEstimate(
  est: Estimate,
  scenario: Scenario,
  options: ScenarioPushOptions = {},
): ScenarioPush {
  const { inputs } = est;
  const notes: string[] = [];
  const rpsPerUser = inputs.actionsPerUserPerDay / SECONDS_PER_DAY;

  const usersByRegion = distributeUsers(
    scenario.usersByRegion,
    inputs.dau,
    options.defaultRegionId ?? DEFAULT_USER_REGION,
  );
  const regionCount = Object.keys(usersByRegion).length;
  notes.push(
    regionCount > 1
      ? `${formatCount(inputs.dau)} daily users spread over ${regionCount} regions in their current proportions.`
      : `${formatCount(inputs.dau)} daily users in ${Object.keys(usersByRegion)[0] ?? DEFAULT_USER_REGION}.`,
  );

  let flows: Flow[];
  if (scenario.flows.length === 0) {
    flows = [
      {
        id: options.newFlowId?.() ?? newId('flow', 'estimator'),
        name: 'All traffic (estimator)',
        share: 1,
        rpsPerUser,
        path: [],
      },
    ];
    notes.push(
      'Added one flow that follows the graph; add read and write flows to model the read:write split.',
    );
  } else {
    const writes = scenario.flows.filter(isWriteFlow);
    const reads = scenario.flows.filter((f) => !isWriteFlow(f));
    let shares: Map<string, number>;
    if (writes.length > 0 && reads.length > 0) {
      shares = new Map([
        ...reshare(reads, est.readFraction),
        ...reshare(writes, est.writeFraction),
      ]);
      notes.push(
        `Flow shares set to the read:write split (${reads.length} read, ${writes.length} write flow${writes.length === 1 ? '' : 's'}).`,
      );
    } else {
      shares = reshare(scenario.flows, 1);
      notes.push(
        `Every flow is a ${writes.length > 0 ? 'write' : 'read'}, so all traffic goes through them; the read:write split only sets payload sizes.`,
      );
    }
    flows = scenario.flows.map((f) => ({ ...f, rpsPerUser, share: shares.get(f.id) ?? 0 }));
  }

  if (scenario.diurnal) {
    notes.push('Daily cycle turned off: the peak factor already models the busiest hour.');
  }

  const payloadBytes = {
    req: Math.round(est.writeFraction * inputs.objectSizeBytes),
    res: Math.round(est.readFraction * inputs.objectSizeBytes),
  };
  notes.push(
    'Payloads set to the average per request (writes upload an object, reads download one), so simulated bandwidth matches the estimate.',
  );

  const summary =
    `${formatCount(inputs.dau)} users · ${flows.length} flow${flows.length === 1 ? '' : 's'} · ` +
    `peak ×${formatCount(inputs.peakFactor)} → ${formatCount(est.qps.avg)} avg rps, ` +
    `${formatCount(est.qps.peak)} peak rps`;

  return {
    patch: {
      usersByRegion,
      flows,
      peakMultiplier: inputs.peakFactor,
      diurnal: false,
      payloadBytes,
    },
    summary,
    notes,
  };
}
