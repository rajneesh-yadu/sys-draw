/** Builds a node's ScaleSpec from its definition, config (scaling roles) and instance type. */
import type { ComponentDefinition, InstanceType } from '@/core';
import { EVEN_SPEC, type ScaleSpec } from './pools';
import { roleValue } from './roles';
import { verticalScale } from './vertical';

const int = (v: number | undefined, fallback: number, min: number) =>
  v === undefined ? fallback : Math.max(min, Math.round(v));

export function scaleSpecOf(
  def: ComponentDefinition | undefined,
  config: Readonly<Record<string, unknown>>,
  instanceType: InstanceType | undefined,
): ScaleSpec {
  if (!def) return { ...EVEN_SPEC };
  const v = verticalScale(def.perf.scaleCurve, def.instanceTypes[0], instanceType);
  const shards = int(roleValue(def, config, 'shards'), 1, 1);
  const skew = Math.min(1, Math.max(0, roleValue(def, config, 'keySkew') ?? 0));
  const singleWriter = def.perf.scaleCurve === 'single-writer';
  const maxInstances = roleValue(def, config, 'maxInstances');
  const copies = roleValue(def, config, 'storageCopies');
  return {
    vcpuRatio: v.vcpuRatio,
    speedup: v.speedup,
    verticalExplain: v.explain,
    singleWriter,
    readReplicas: singleWriter ? int(roleValue(def, config, 'readReplicas'), 0, 0) : 0,
    standby: int(roleValue(def, config, 'standby'), 0, 0),
    shards,
    hotShardShare: Math.max(1 / shards, skew),
    ...(maxInstances !== undefined
      ? {
          platform: {
            maxInstances: int(maxInstances, 1, 1),
            minInstances: int(roleValue(def, config, 'minInstances'), 0, 0),
          },
        }
      : {}),
    storageGb: Math.max(0, roleValue(def, config, 'storageGb') ?? 0),
    ...(copies !== undefined ? { storageCopies: Math.max(1, copies) } : {}),
  };
}
