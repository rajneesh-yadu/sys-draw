/** Traffic and conditions to simulate (DATA-MODEL.md → "Traffic & results"). */
import { z } from 'zod';
import { idSchema } from '../ids';
import {
  NonEmptyStringSchema,
  NonNegativeNumberSchema,
  PositiveNumberSchema,
  RatioSchema,
  RegionIdSchema,
} from './common';

export const FLOW_OPS = ['read', 'write'] as const;

export const FlowStepSchema = z.object({
  nodeId: idSchema('node'),
  op: z.enum(FLOW_OPS),
  cacheable: z.boolean().optional(),
});
export type FlowStep = z.infer<typeof FlowStepSchema>;

export const FlowSchema = z.object({
  id: idSchema('flow'),
  name: NonEmptyStringSchema,
  /** Fraction of total traffic, 0–1. Shares summing to 1 is a review rule, not a save-blocker. */
  share: RatioSchema,
  rpsPerUser: NonNegativeNumberSchema,
  path: z.array(FlowStepSchema),
});
export type Flow = z.infer<typeof FlowSchema>;

// ---------- Chaos events ----------
// DATA-MODEL.md names ChaosEvent without fields; this union covers the conditions listed in
// ENGINE.md / NETWORK-SECURITY.md. Adding a new `kind` is additive and needs no migration.

const chaosBase = {
  id: idSchema('event'),
  atSec: NonNegativeNumberSchema,
  /** Omit for "until the end of the run". */
  durationSec: PositiveNumberSchema.optional(),
};

export const ChaosEventSchema = z.discriminatedUnion('kind', [
  z.object({ ...chaosBase, kind: z.literal('nodeOutage'), nodeId: idSchema('node') }),
  /** An AZ, region, VPC… group goes down with everything inside it. */
  z.object({ ...chaosBase, kind: z.literal('groupOutage'), groupId: idSchema('group') }),
  z.object({ ...chaosBase, kind: z.literal('regionOutage'), regionId: RegionIdSchema }),
  z.object({
    ...chaosBase,
    kind: z.literal('trafficSpike'),
    multiplier: PositiveNumberSchema,
    regionId: RegionIdSchema.optional(),
  }),
  z.object({
    ...chaosBase,
    kind: z.literal('packetLoss'),
    lossRate: RatioSchema,
    edgeId: idSchema('edge').optional(),
  }),
  z.object({
    ...chaosBase,
    kind: z.literal('latencyInjection'),
    addedMs: PositiveNumberSchema,
    edgeId: idSchema('edge').optional(),
    nodeId: idSchema('node').optional(),
  }),
  z.object({
    ...chaosBase,
    kind: z.literal('networkPartition'),
    regionA: RegionIdSchema,
    regionB: RegionIdSchema,
  }),
]);
export type ChaosEvent = z.infer<typeof ChaosEventSchema>;
export type ChaosEventKind = ChaosEvent['kind'];

export const ScenarioSchema = z.object({
  /** Concurrent users per user region. */
  usersByRegion: z.record(RegionIdSchema, NonNegativeNumberSchema),
  flows: z.array(FlowSchema),
  peakMultiplier: PositiveNumberSchema,
  diurnal: z.boolean(),
  payloadBytes: z.object({ req: NonNegativeNumberSchema, res: NonNegativeNumberSchema }),
  events: z.array(ChaosEventSchema),
  seed: z.number().int(),
  durationSec: PositiveNumberSchema,
});
export type Scenario = z.infer<typeof ScenarioSchema>;
