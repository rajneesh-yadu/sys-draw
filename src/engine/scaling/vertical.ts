/**
 * Vertical scaling: a component's `perf.serviceTimeMs` is measured on its FIRST instance type
 * (the baseline). A bigger instance with k× the vCPUs serves requests f(k)× faster:
 *   linear        f(k) = k                                (stateless, embarrassingly parallel work)
 *   sublinear     f(k) = 1 / ((1 − p) + p/k), p = 0.9      (Amdahl's law: 10 % of the work is serial)
 *   single-writer f(k) = same as sublinear                  (a bigger primary helps, with limits;
 *                                                            replicas never add write capacity)
 */
import type { InstanceType, PerfModel } from '@/core';
import { fmt } from '../model/format';

/** Parallel fraction for Amdahl's law in the sublinear curves. */
export const AMDAHL_PARALLEL_FRACTION = 0.9;

export type ScaleCurve = PerfModel['scaleCurve'];

export function verticalSpeedup(curve: ScaleCurve, vcpuRatio: number): number {
  const k = vcpuRatio > 0 && Number.isFinite(vcpuRatio) ? vcpuRatio : 1;
  if (curve === 'linear') return k;
  const p = AMDAHL_PARALLEL_FRACTION;
  return 1 / (1 - p + p / k);
}

export interface VerticalScale {
  base: InstanceType | undefined;
  vcpuRatio: number;
  speedup: number;
  explain: string;
}

export function verticalScale(
  curve: ScaleCurve,
  base: InstanceType | undefined,
  chosen: InstanceType | undefined,
): VerticalScale {
  if (!base || !chosen) return { base, vcpuRatio: 1, speedup: 1, explain: '' };
  const k = chosen.vCpu / base.vCpu;
  const speedup = verticalSpeedup(curve, k);
  if (chosen.id === base.id || k === 1) {
    return {
      base,
      vcpuRatio: k,
      speedup,
      explain: `${chosen.id} is the baseline size (${fmt(chosen.vCpu)} vCPU): service times as measured.`,
    };
  }
  const law =
    curve === 'linear'
      ? `linear: f(k) = k`
      : `${curve}: Amdahl f(k) = 1/((1−p) + p/k), p = ${AMDAHL_PARALLEL_FRACTION}`;
  return {
    base,
    vcpuRatio: k,
    speedup,
    explain:
      `${chosen.id} has k = ${fmt(chosen.vCpu)}/${fmt(base.vCpu)} = ${fmt(k)}× the vCPU of the baseline ${base.id}; ` +
      `μ scales by f(k) = ${fmt(speedup)} (${law}), so S = S_base / ${fmt(speedup)}.`,
  };
}
