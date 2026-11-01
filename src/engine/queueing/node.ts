/**
 * Pipeline step 4 — per-node queueing. The node's traffic is spread over instance pools
 * (scaling/pools.ts: replicas, primary + read replicas, shards, hash imbalance); each instance is
 * an M/M/c queue (c = concurrency per instance) with μ from its read/write mix. The node reports
 * its BUSIEST instance's utilisation; latency is the traffic-weighted mean over instances.
 * Saturation follows the component's `saturationBehavior`, per instance.
 * Autoscaling: replicas = the policy's steady state for this load (scaling/autoscale.ts).
 */
import { fmt, pct } from '../model/format';
import type { CompiledNode, EngineOptions, NodeStats } from '../model/types';
import { desiredReplicas } from '../scaling/autoscale';
import {
  buildPools,
  capacityForMix,
  describePools,
  poolUtilization,
  readersPerShard,
} from '../scaling/pools';
import { mmc } from './mmc';

type Rps = { read: number; write: number };

/** Replicas in effect: configured, or the autoscaler's steady state for this load. */
export function effectiveReplicas(
  node: CompiledNode,
  rps: Rps,
): { replicas: number; explain?: string } {
  const policy = node.autoscale;
  if (!policy || node.scale.platform) return { replicas: node.replicas };
  // Instances needed so AVERAGE utilisation ≤ target: ⌈(work ÷ c) / target⌉, spread over shards.
  const S = node.serviceTimeMs;
  const work = (rps.read * S.read + rps.write * S.write) / 1000;
  const rho1 = work / node.serversPerInstance; // average ρ if one instance did all the work
  const instances = desiredReplicas(rho1, { ...policy, min: 1, max: Number.MAX_SAFE_INTEGER });
  const perShard = Math.ceil(instances / node.scale.shards);
  // Single-writer: instances per shard = 1 primary + readReplicas + (replicas − 1).
  const want = node.scale.singleWriter ? perShard - node.scale.readReplicas : perShard;
  const replicas = Math.min(policy.max, Math.max(policy.min, want));
  return {
    replicas,
    explain:
      `Autoscaling (target ${pct(policy.targetUtil)} average utilisation, ${policy.min}–${policy.max} replicas): ` +
      `work ÷ c = ${fmt(rho1)} instance-loads ⇒ ⌈${fmt(rho1)}/${fmt(policy.targetUtil)}⌉ = ${instances} instances` +
      `${node.scale.shards > 1 ? ` over ${node.scale.shards} shards` : ''} ⇒ replicas = ${replicas}` +
      (replicas === policy.max && want > policy.max
        ? ' (capped at max — add capacity or raise max)'
        : '') +
      `. Steady state at this load; warm-up (${fmt(policy.warmupSec)} s) matters in time-series runs.` +
      (node.scale.singleWriter ? ' Replicas of a single-writer store add read capacity only.' : ''),
  };
}

export function nodeQueueing(
  node: CompiledNode,
  rps: Rps,
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
      replicas: node.replicas,
      pools: [],
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
      costPerMonth: 0,
      explain: {
        rpsIn: `λ = ${fmt(lambda)} rps`,
        latencyMs: `${what}; no queueing modelled here (0 ms).`,
      },
    };
  }

  const auto = effectiveReplicas(node, rps);
  const replicas = auto.replicas;
  const pools = buildPools(node.scale, replicas, node.serversPerInstance);
  const capacityRps = capacityForMix(pools, rps, node.serviceTimeMs);

  let busiest = 0; // index of the busiest pool
  let utilization = 0;
  let wqSumR = 0; // Σ count·share·Wq for reads / writes
  let wqSumW = 0;
  let waitSum = 0;
  let wqSum = 0;
  let lqTotal = 0;
  let served = 0;
  let saturated = false;
  let backlogNote = '';
  const per = pools.map((p, i) => {
    const lr = rps.read * p.readShare;
    const lw = rps.write * p.writeShare;
    const li = lr + lw;
    const sMean =
      li > 0
        ? (lr * sRead + lw * sWrite) / li
        : p.writeShare > 0 && p.readShare === 0
          ? sWrite
          : sRead;
    const mu = 1000 / sMean;
    const c = p.servers;
    const capI = c * mu;
    const rho = poolUtilization(p, rps, node.serviceTimeMs);
    const sat = rho >= options.rhoCap;
    const q = mmc(sat ? options.rhoCap * capI : li, mu, c);
    let wq = q.wqMs;
    let lq = q.lq;
    let err = 0;
    if (sat) {
      saturated = true;
      const excess = Math.max(0, li - capI);
      if (node.saturationBehavior === 'queue') {
        const backlogWaitMs = ((excess * durationSec) / (2 * capI)) * 1000;
        wq += backlogWaitMs;
        lq += (excess * durationSec) / 2;
        if (backlogNote === '') {
          backlogNote =
            `Saturated (ρ ≥ ${fmt(options.rhoCap)}): requests queue. Backlog grows at λ − cμ = ${fmt(excess)} rps per ${p.label}; ` +
            `extra wait ≈ (λ − cμ)·D/(2cμ) = ${fmt(backlogWaitMs)} ms over D = ${fmt(durationSec)} s.`;
        }
      } else if (node.saturationBehavior === 'reject') {
        err = li > 0 ? Math.max(0, 1 - capI / li) : 0;
      }
    }
    if (i === 0 || rho > utilization) {
      busiest = i;
      utilization = rho;
    }
    const trafficShare = lambda > 0 ? (p.count * li) / lambda : p.count * p.readShare;
    wqSumR += p.count * p.readShare * wq;
    wqSumW += p.count * p.writeShare * wq;
    wqSum += trafficShare * wq;
    waitSum += trafficShare * q.waitProbability;
    lqTotal += p.count * lq;
    served += p.count * li * (1 - err);
    return {
      li,
      sMean,
      mu,
      c,
      rho,
      wq,
      err,
      a: (sat ? options.rhoCap * capI : li) / mu,
      C: q.waitProbability,
    };
  });

  const errorRate = lambda > 0 ? Math.min(1, Math.max(0, 1 - served / lambda)) : 0;
  const responseMs = {
    read: wqSumR + sRead,
    write: wqSumW + sWrite,
    mean:
      lambda > 0
        ? (rps.read * (wqSumR + sRead) + rps.write * (wqSumW + sWrite)) / lambda
        : wqSumR + sRead,
  };
  const b = per[busiest] ?? {
    li: 0,
    sMean: sRead,
    mu: 1000 / sRead,
    c: node.serversPerInstance,
    rho: 0,
    wq: 0,
    a: 0,
    C: 0,
  };
  const bp = pools[busiest];
  const meanServiceMs = lambda > 0 ? (rps.read * sRead + rps.write * sWrite) / lambda : sRead;

  const explain: Record<string, string> = {};
  const sMix =
    rps.read > 0 && rps.write > 0
      ? `S̄ = (λr·Sr + λw·Sw)/λ = (${fmt(rps.read)}×${fmt(sRead)} + ${fmt(rps.write)}×${fmt(sWrite)})/${fmt(lambda)} = ${fmt(meanServiceMs)} ms`
      : `S = ${fmt(meanServiceMs)} ms`;
  explain.rpsIn = `λ = ${fmt(rps.read)} read + ${fmt(rps.write)} write = ${fmt(lambda)} rps`;
  const single = pools.length === 1 && bp !== undefined && bp.readShare === bp.writeShare;
  explain.utilization = single
    ? `ρ = λ/(c·μ) per instance = ${fmt(b.li)}/(${fmt(b.c)}×${fmt(b.mu)}) = ${fmt(utilization)}` +
      ` (λ per instance = ${fmt(lambda)}/${bp.count} ${bp.count === 1 ? 'instance' : 'replicas'}; μ = 1000/S̄ = ${fmt(b.mu)} rps; ${sMix})`
    : `ρ = λ/(c·μ) at the busiest instance (${bp?.label ?? '?'}) = ${fmt(b.li)}/(${fmt(b.c)}×${fmt(b.mu)}) = ${fmt(utilization)}` +
      ` (μ = 1000/S̄ = ${fmt(b.mu)} rps with S̄ = ${fmt(b.sMean)} ms for its mix)`;
  explain.capacity = `Max throughput for this read/write mix = λ at which the busiest instance reaches ρ = 1 = ${fmt(capacityRps)} rps.`;
  explain.scaling =
    `Instances: ${describePools(node.scale, pools)}` +
    (node.scale.verticalExplain ? ` Vertical: ${node.scale.verticalExplain}` : '') +
    (auto.explain ? ` ${auto.explain}` : '');
  if (saturated) {
    if (node.saturationBehavior === 'queue') explain.saturation = backlogNote;
    else if (node.saturationBehavior === 'reject')
      explain.saturation = `Saturated (ρ ≥ ${fmt(options.rhoCap)}): excess requests are rejected.`;
    else
      explain.saturation = `Saturated (ρ ≥ ${fmt(options.rhoCap)}): the component degrades (slower/partial answers) instead of failing.`;
  }
  explain.latencyMs =
    (single
      ? `T = Wq + S̄ = ${fmt(wqSum)} + ${fmt(meanServiceMs)} = ${fmt(responseMs.mean)} ms; ` +
        `Wq = C(c,a)/(cμ − λ) with c = ${fmt(b.c)}, a = λ/μ = ${fmt(b.a)}, C = ${fmt(b.C)}` +
        (saturated ? ` (evaluated at ρ = ${fmt(options.rhoCap)})` : '') +
        '. '
      : `T = traffic-weighted Σ (Wq + S) over instances = ${fmt(responseMs.mean)} ms (reads ${fmt(responseMs.read)}, writes ${fmt(responseMs.write)}); ` +
        `Wq per instance from M/M/c (Erlang C). `) +
    (node.scale.speedup !== 1
      ? `Service times S = S_base / ${fmt(node.scale.speedup)} (instance size). `
      : '') +
    `Percentiles assume an exponential tail: p50 = T·ln 2, p95 = T·ln 20, p99 = T·ln 100.`;
  explain.queueDepth = single
    ? `Lq = C·ρ/(1−ρ) per instance × ${bp.count} replicas = ${fmt(lqTotal)}`
    : `Lq = Σ instances × Lq per instance = ${fmt(lqTotal)}`;
  explain.errorRate =
    errorRate > 0
      ? single
        ? `error = 1 − capacity/λ = 1 − ${fmt(capacityRps)}/${fmt(lambda)} = ${pct(errorRate)}`
        : `error = rejected ÷ λ at saturated instances = ${pct(errorRate)}`
      : 'No rejections.';
  if (node.scale.singleWriter && rps.write > 0) {
    explain.writeCapacity =
      `Writes all go to the primary of their shard: write capacity ≈ shards × c × 1000/Sw = ` +
      `${node.scale.shards} × ${fmt(node.serversPerInstance)} × ${fmt(1000 / sWrite)} = ` +
      `${fmt(node.scale.shards * node.serversPerInstance * (1000 / sWrite))} rps (minus the reads the primary also serves), ` +
      `whatever the number of read replicas (${readersPerShard(node.scale, replicas)} per shard).`;
  }

  return {
    node,
    rps: { ...rps },
    lambda,
    servedRps: lambda * (1 - errorRate),
    replicas,
    pools,
    lambdaPerInstance: b.li,
    meanServiceMs,
    muPerServer: b.mu,
    capacityRps,
    utilization,
    waitProbability: waitSum,
    wqMs: wqSum,
    queueDepth: lqTotal,
    errorRate,
    responseMs,
    saturated,
    costPerMonth: 0,
    explain,
  };
}
