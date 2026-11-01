/**
 * Config-driven performance effects, declared as DATA on a component's config fields:
 *
 *   acks: z.enum(['0', '1', 'all']).meta({ perfEffect: {
 *     all: { writeAddMs: 2, why: 'waits for every in-sync follower' } } })
 *
 * For the option the node is configured with (booleans key as 'true' / 'false'):
 * - `read` / `write`: factor on the service time — both the work (capacity) and the wait;
 * - `readAddMs` / `writeAddMs`: extra wait only (network round trips, waiting for acks), no work.
 * Read by the `configPerf` behavior, so a new knob is a schema edit, not engine code.
 */
import { z } from 'zod';
import type { ComponentDefinition } from '@/core';

export const PerfEffectSchema = z.strictObject({
  read: z.number().positive().optional(),
  write: z.number().positive().optional(),
  readAddMs: z.number().min(0).optional(),
  writeAddMs: z.number().min(0).optional(),
  why: z.string().min(1),
});
export type PerfEffect = z.infer<typeof PerfEffectSchema>;
export const PerfEffectMapSchema = z.record(z.string(), PerfEffectSchema);

type Introspectable = {
  meta?: () => Record<string, unknown> | undefined;
  def?: { innerType?: unknown };
};

/** The `perfEffect` map on one field, looking through optional/default wrappers. */
export function perfEffectsOf(field: unknown): Record<string, PerfEffect> | undefined {
  let cur = field as Introspectable | undefined;
  for (let i = 0; cur && i < 8; i++) {
    const m = cur.meta?.()?.perfEffect;
    if (m !== undefined) {
      const parsed = PerfEffectMapSchema.safeParse(m);
      return parsed.success ? parsed.data : undefined;
    }
    cur = cur.def?.innerType as Introspectable | undefined;
  }
  return undefined;
}

export interface AppliedEffect extends PerfEffect {
  field: string;
  value: string;
}

/** Effects that apply for this config, in schema field order. */
export function activeEffects(
  def: ComponentDefinition | undefined,
  config: Readonly<Record<string, unknown>>,
): AppliedEffect[] {
  if (!def) return [];
  const out: AppliedEffect[] = [];
  for (const [field, schema] of Object.entries(def.configSchema.shape)) {
    const map = perfEffectsOf(schema);
    if (!map) continue;
    const v = config[field];
    if (v === undefined || v === null) continue;
    const value = String(v);
    const e = map[value];
    if (e) out.push({ ...e, field, value });
  }
  return out;
}
