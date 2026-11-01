/** Simulation output (DATA-MODEL.md → SimResult). Cached on boards, never authoritative. */
import { z } from 'zod';
import { RegistryIdSchema } from '../ids';
import {
  ExplainSchema,
  LatencyPercentilesSchema,
  NonEmptyStringSchema,
  NonNegativeNumberSchema,
  RatioSchema,
} from './common';

export const NodeMetricsSchema = z.object({
  utilization: NonNegativeNumberSchema, // may exceed 1 when saturated
  rpsIn: NonNegativeNumberSchema,
  rpsOut: NonNegativeNumberSchema,
  queueDepth: NonNegativeNumberSchema,
  latencyMs: LatencyPercentilesSchema,
  errorRate: RatioSchema,
  hitRate: RatioSchema.optional(),
  costPerMonth: NonNegativeNumberSchema,
  explain: ExplainSchema,
});
export type NodeMetrics = z.infer<typeof NodeMetricsSchema>;

/** Not spelled out in DATA-MODEL.md; mirrors NodeMetrics for the network cost step. */
export const EdgeMetricsSchema = z.object({
  rps: NonNegativeNumberSchema,
  latencyMs: LatencyPercentilesSchema,
  handshakeMs: NonNegativeNumberSchema,
  bytesPerSec: NonNegativeNumberSchema,
  errorRate: RatioSchema,
  costPerMonth: NonNegativeNumberSchema,
  explain: ExplainSchema,
});
export type EdgeMetrics = z.infer<typeof EdgeMetricsSchema>;

export const FlowMetricsSchema = z.object({
  p50: NonNegativeNumberSchema,
  p95: NonNegativeNumberSchema,
  p99: NonNegativeNumberSchema,
  rps: NonNegativeNumberSchema,
  errorRate: RatioSchema,
});
export type FlowMetrics = z.infer<typeof FlowMetricsSchema>;

/**
 * Per user region (S10): what users in one `Scenario.usersByRegion` area experience. Optional in
 * SimResult, so results cached before S10 still validate.
 */
export const RegionMetricsSchema = z.object({
  name: NonEmptyStringSchema,
  users: NonNegativeNumberSchema,
  rps: NonNegativeNumberSchema,
  p50: NonNegativeNumberSchema,
  p95: NonNegativeNumberSchema,
  p99: NonNegativeNumberSchema,
  errorRate: RatioSchema,
  /** Mean network time per request on the critical path (propagation + last mile), ms. */
  networkMs: NonNegativeNumberSchema,
  /** Cloud region that serves most of this region's requests; absent when nothing is placed. */
  servedFrom: z.string().optional(),
  explain: ExplainSchema,
});
export type RegionMetrics = z.infer<typeof RegionMetricsSchema>;

export const FINDING_SEVERITIES = ['info', 'warning', 'error', 'critical'] as const;
export const FindingSeveritySchema = z.enum(FINDING_SEVERITIES);
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;

/** Output of a review rule (SPOF, missing cache, DB reachable from internet, …). */
export const FindingSchema = z.object({
  ruleId: RegistryIdSchema,
  severity: FindingSeveritySchema,
  title: NonEmptyStringSchema,
  message: NonEmptyStringSchema,
  /** Node / edge / group ids the finding points at (for canvas highlighting). */
  targetIds: z.array(z.string()),
  fix: z.string().optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const TimePointSchema = z.object({
  tSec: NonNegativeNumberSchema,
  rps: NonNegativeNumberSchema,
  p50Ms: NonNegativeNumberSchema,
  p99Ms: NonNegativeNumberSchema,
  errorRate: RatioSchema,
  availability: RatioSchema,
});
export type TimePoint = z.infer<typeof TimePointSchema>;

export const SimResultSchema = z.object({
  perNode: z.record(z.string(), NodeMetricsSchema),
  perEdge: z.record(z.string(), EdgeMetricsSchema),
  perFlow: z.record(z.string(), FlowMetricsSchema),
  /** Keyed by user region id (S10). */
  perRegion: z.record(z.string(), RegionMetricsSchema).optional(),
  system: z.object({
    rps: NonNegativeNumberSchema,
    availability: RatioSchema,
    costPerMonth: NonNegativeNumberSchema,
    bottlenecks: z.array(z.string()),
  }),
  findings: z.array(FindingSchema),
  timeline: z.array(TimePointSchema).optional(),
});
export type SimResult = z.infer<typeof SimResultSchema>;
