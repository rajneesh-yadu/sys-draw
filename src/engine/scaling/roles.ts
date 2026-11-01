/**
 * Scaling roles: registry config fields opt into the scaling/cost model with
 * `.meta({ scaling: '<role>' })`, so the engine never hard-codes a component's field names
 * (a new database only has to tag its own fields).
 */
import type { ComponentDefinition } from '@/core';

export const SCALING_ROLES = [
  /** Number of shards / partitions the data (and its traffic) is split into. */
  'shards',
  /** 0–1: share of traffic on the hottest shard (0 = even). */
  'keySkew',
  /** Read-only copies of a single-writer store (per shard). */
  'readReplicas',
  /** Boolean: a billed standby per shard that serves no traffic (e.g. Multi-AZ). */
  'standby',
  /** Data stored, in GB (total over all shards, one copy). */
  'storageGb',
  /** Copies of the stored data billed for storage (replication factor). */
  'storageCopies',
  /** Platform-managed scale-out limit (serverless concurrency). */
  'maxInstances',
  /** Always-on instances billed even when idle (provisioned concurrency). */
  'minInstances',
] as const;
export type ScalingRole = (typeof SCALING_ROLES)[number];

type Introspectable = {
  meta?: () => Record<string, unknown> | undefined;
  def?: { type?: string; innerType?: unknown };
};

/** Role tags on one field, looking through optional/default/nullable wrappers. */
function roleOf(field: unknown): ScalingRole | undefined {
  let cur = field as Introspectable | undefined;
  for (let i = 0; cur && i < 8; i++) {
    const role = cur.meta?.()?.scaling;
    if (typeof role === 'string' && (SCALING_ROLES as readonly string[]).includes(role)) {
      return role as ScalingRole;
    }
    cur = cur.def?.innerType as Introspectable | undefined;
  }
  return undefined;
}

const cache = new WeakMap<ComponentDefinition, ReadonlyMap<ScalingRole, string>>();

/** Role → config key for a component definition (cached per definition). */
export function scalingFields(def: ComponentDefinition): ReadonlyMap<ScalingRole, string> {
  let map = cache.get(def);
  if (map) return map;
  const m = new Map<ScalingRole, string>();
  for (const [key, field] of Object.entries(def.configSchema.shape)) {
    const role = roleOf(field);
    if (role !== undefined && !m.has(role)) m.set(role, key);
  }
  map = m;
  cache.set(def, map);
  return map;
}

/** Numeric value of a role (booleans count as 0/1); undefined if the component has no such field. */
export function roleValue(
  def: ComponentDefinition | undefined,
  config: Readonly<Record<string, unknown>>,
  role: ScalingRole,
): number | undefined {
  if (!def) return undefined;
  const key = scalingFields(def).get(role);
  if (key === undefined) return undefined;
  const v = config[key];
  if (typeof v === 'boolean') return v ? 1 : 0;
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
