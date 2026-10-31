/**
 * Pipeline step 4 — per-node queueing. Each replica is an M/M/c queue (c = concurrency per
 * instance) receiving λ / replicas. Reads and writes share the queue; μ comes from the mean
 * service time over the mix. Saturation follows the component's `saturationBehavior`.
 */
import { fmt, pct } from '../model/format';
import type { CompiledNode, EngineOptions, NodeStats } from '../model/types';
import { mmc } from './mmc';

export function nodeQueueing(
  node: CompiledNode,
  rps: { read: number; write: number },
  options: EngineOptions,
  durationSec: number,
): NodeStats {
  const lambda = rps.read + rps.write;
  const { read: sRead, write: sWrite } = node.serviceTimeMs;

  if (node.kind !== 'service') {
    const what = node.kind === 'source' ? 'Clients generate traffic' : 'Unknown component';
    return {
      node,
      rps: { ...rps },
      lambda,
      servedRps: lambda,
      lambdaPerInstance: lambda / node.replicas,
      meanServiceMs: 0,
      muPerServer: Infinity,
      capacityRps: Infinity,
      utilization: 0,
      waitProbability: 0,
      wqMs: 0,
      queueDepth: 0,
      errorRate: 0,
      responseMs: { read: 0, write: 0, mean: 0 },
      saturated: false,
      explain: {
        rpsIn: `λ = ${fmt(lambda)} rps`,
        latencyMs: `${what}; no queueing modelled here (0 ms).`,
      },
    };
  }

  const meanServiceMs = lambda > 0 ? (rps.read * sRead + rps.write * sWrite) / lambda : sRead;
  const mu = 1000 / meanServiceMs;
  const c = node.serversPerInstance;
  const replicas = node.replicas;
  const lambdaI = lambda / replicas;
  const capacityI = c * mu;
  const capacityRps = capacityI * replicas;
  const utilization = lambdaI / capacityI;
  const saturated = utilization >= options.rhoCap;

  // Evaluate the queue at min(ρ, rhoCap): M/M/c has no steady state at ρ ≥ 1.
  const evalLambda = saturated ? options.rhoCap * capacityI : lambdaI;
  const q = mmc(evalLambda, mu, c);
  let wqMs = q.wqMs;
  let lqI = q.lq;
  let errorRate = 0;
  const explain: Record<string, string> = {};

  const sMix =
    rps.read > 0 && rps.write > 0
      ? `S̄ = (λr·Sr + λw·Sw)/λ = (${fmt(rps.read)}×${fmt(sRead)} + ${fmt(rps.write)}×${fmt(sWrite)})/${fmt(lambda)} = ${fmt(meanServiceMs)} ms`
      : `S = ${fmt(meanServiceMs)} ms`;
  explain.rpsIn = `λ = ${fmt(rps.read)} read + ${fmt(rps.write)} write = ${fmt(lambda)} rps`;
  explain.utilization =
    `ρ = λ/(c·μ) per instance = ${fmt(lambdaI)}/(${fmt(c)}×${fmt(mu)}) = ${fmt(utilization)}` +
    ` (λ per instance = ${fmt(lambda)}/${replicas} replicas; μ = 1000/S̄ = ${fmt(mu)} rps; ${sMix})`;

  if (saturated) {
    const excess = Math.max(0, lambdaI - capacityI);
    if (node.saturationBehavior === 'queue') {
      // Fluid backlog: the queue grows at (λ − cμ) for the whole run; average wait = half the final.
      const backlogWaitMs = ((excess * durationSec) / (2 * capacityI)) * 1000;
      wqMs += backlogWaitMs;
      lqI += (excess * durationSec) / 2;
      explain.saturation =
        `Saturated (ρ ≥ ${fmt(options.rhoCap)}): requests queue. Backlog grows at λ − cμ = ${fmt(excess)} rps per instance; ` +
        `extra wait ≈ (λ − cμ)·D/(2cμ) = ${fmt(backlogWaitMs)} ms over D = ${fmt(durationSec)} s.`;
    } else if (node.saturationBehavior === 'reject') {
      errorRate = Math.max(0, 1 - capacityRps / lambda);
      explain.saturation = `Saturated (ρ ≥ ${fmt(options.rhoCap)}): excess requests are rejected.`;
    } else {
      explain.saturation = `Saturated (ρ ≥ ${fmt(options.rhoCap)}): the component degrades (slower/partial answers) instead of failing.`;
    }
  }

  const responseMs = { read: wqMs + sRead, write: wqMs + sWrite, mean: wqMs + meanServiceMs };
  explain.latencyMs =
    `T = Wq + S̄ = ${fmt(wqMs)} + ${fmt(meanServiceMs)} = ${fmt(responseMs.mean)} ms; ` +
    `Wq = C(c,a)/(cμ − λ) with c = ${fmt(c)}, a = λ/μ = ${fmt(evalLambda / mu)}, C = ${fmt(q.waitProbability)}` +
    (saturated ? ` (evaluated at ρ = ${fmt(options.rhoCap)})` : '') +
    `. Percentiles assume an exponential tail: p50 = T·ln 2, p95 = T·ln 20, p99 = T·ln 100.`;
  explain.queueDepth = `Lq = C·ρ/(1−ρ) per instance × ${replicas} replicas = ${fmt(lqI * replicas)}`;
  explain.errorRate =
    errorRate > 0
      ? `error = 1 − capacity/λ = 1 − ${fmt(capacityRps)}/${fmt(lambda)} = ${pct(errorRate)}`
      : 'No rejections.';
  explain.costPerMonth = 'Cost model arrives with scaling (S09).';

  return {
    node,
    rps: { ...rps },
    lambda,
    servedRps: lambda * (1 - errorRate),
    lambdaPerInstance: lambdaI,
    meanServiceMs,
    muPerServer: mu,
    capacityRps,
    utilization,
    waitProbability: q.waitProbability,
    wqMs,
    queueDepth: lqI * replicas,
    errorRate,
    responseMs,
    saturated,
    explain,
  };
}
