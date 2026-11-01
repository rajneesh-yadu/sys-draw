/**
 * Autoscaling (target tracking on AVERAGE utilisation, like cloud autoscalers):
 *   desired replicas = clamp(⌈ρ₁ / target⌉, min, max)
 * where ρ₁ is the average utilisation the load would cause on ONE replica (work ÷ servers).
 *
 * - `steadyStateReplicas`: the analytical run (constant peak load) uses the replica count the
 *   policy settles at; warm-up does not matter there.
 * - `autoscaleTimeline`: for time-series runs (1 s ticks, S11): scale-out launches instances that
 *   take traffic only after `warmupSec`; scale-in waits `scaleInCooldownSec` of low load.
 */
import type { Autoscale } from '@/core';

/** Replicas needed so average utilisation ≤ target, clamped to [min, max]. */
export function desiredReplicas(oneReplicaUtil: number, policy: Autoscale): number {
  const need = oneReplicaUtil > 0 ? Math.ceil(oneReplicaUtil / policy.targetUtil - 1e-9) : 0;
  return Math.min(policy.max, Math.max(policy.min, need));
}

/** Steady state of the target-tracking policy under constant load. */
export function steadyStateReplicas(oneReplicaUtil: number, policy: Autoscale): number {
  return desiredReplicas(oneReplicaUtil, policy);
}

export interface AutoscaleTimelineOptions {
  /** Seconds per tick (default 1). */
  tickSec?: number;
  /** Max load one replica serves at ρ = 1 (rps). */
  capacityPerReplicaRps: number;
  /** Serving replicas at t = 0 (default policy.min). */
  initialReplicas?: number;
  /** Load must stay low this long before replicas are removed (default 60 s). */
  scaleInCooldownSec?: number;
}

export interface AutoscaleTick {
  tSec: number;
  loadRps: number;
  /** Replicas taking traffic this tick. */
  replicas: number;
  /** Replicas launched but still warming up. */
  warming: number;
  desired: number;
  /** Average utilisation of serving replicas (can exceed 1 while warming up). */
  utilization: number;
}

/** Deterministic tick-by-tick replay of the policy over a load series (one value per tick). */
export function autoscaleTimeline(
  policy: Autoscale,
  loadRps: readonly number[],
  opts: AutoscaleTimelineOptions,
): AutoscaleTick[] {
  const tick = opts.tickSec ?? 1;
  const cap = opts.capacityPerReplicaRps;
  const cooldown = opts.scaleInCooldownSec ?? 60;
  let serving = Math.min(policy.max, Math.max(policy.min, opts.initialReplicas ?? policy.min));
  let pending: { readyAt: number; count: number }[] = [];
  let lowSince: number | undefined;
  const out: AutoscaleTick[] = [];

  loadRps.forEach((load, i) => {
    const t = i * tick;
    // Warm-ups that finished join the pool.
    const ready = pending.filter((p) => p.readyAt <= t + 1e-9);
    pending = pending.filter((p) => p.readyAt > t + 1e-9);
    serving += ready.reduce((s, p) => s + p.count, 0);

    const desired = desiredReplicas(cap > 0 ? load / cap : 0, policy);
    const warming = pending.reduce((s, p) => s + p.count, 0);
    if (desired > serving + warming) {
      pending.push({ readyAt: t + policy.warmupSec, count: desired - serving - warming });
      lowSince = undefined;
      if (policy.warmupSec <= 0) {
        serving += pending.reduce((s, p) => s + p.count, 0);
        pending = [];
      }
    } else if (desired < serving) {
      lowSince ??= t;
      if (t - lowSince >= cooldown) {
        serving = Math.max(desired, policy.min);
        pending = [];
        lowSince = undefined;
      }
    } else {
      lowSince = undefined;
    }

    const w = pending.reduce((s, p) => s + p.count, 0);
    out.push({
      tSec: t,
      loadRps: load,
      replicas: serving,
      warming: w,
      desired,
      utilization: cap > 0 && serving > 0 ? load / (serving * cap) : 0,
    });
  });
  return out;
}
