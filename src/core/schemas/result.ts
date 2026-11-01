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

/** S11: a node's state at one tick of a time-stepped run. */
export const NODE_TICK_STATES = ['up', 'degraded', 'down'] as const;
export const NodeTickSchema = z.object({
  utilization: NonNegativeNumberSchema,
  rpsIn: NonNegativeNumberSchema,
  errorRate: RatioSchema,
  p99Ms: NonNegativeNumberSchema,
  /** Replicas taking traffic (autoscaling changes it over time). */
  replicas: NonNegativeNumberSchema,
  state: z.enum(NODE_TICK_STATES),
});
export type NodeTick = z.infer<typeof NodeTickSchema>;

export const BREAKER_STATES = ['closed', 'open', 'half-open'] as const;
export const EdgeTickSchema = z.object({
  rps: NonNegativeNumberSchema,
  errorRate: RatioSchema,
  breaker: z.enum(BREAKER_STATES).optional(),
});
export type EdgeTick = z.infer<typeof EdgeTickSchema>;

export const TimePointSchema = z.object({
  tSec: NonNegativeNumberSchema,
  rps: NonNegativeNumberSchema,
  p50Ms: NonNegativeNumberSchema,
  p99Ms: NonNegativeNumberSchema,
  errorRate: RatioSchema,
  availability: RatioSchema,
  // S11 (optional, so older results still validate):
  nodes: z.record(z.string(), NodeTickSchema).optional(),
  edges: z.record(z.string(), EdgeTickSchema).optional(),
  /** Chaos events in effect at this tick. */
  activeEventIds: z.array(z.string()).optional(),
});
export type TimePoint = z.infer<typeof TimePointSchema>;

/** S11: something worth a marker on the timeline chart. */
export const TIMELINE_MARKER_KINDS = [
  'chaos-start',
  'chaos-end',
  'detected',
  'failover',
  'breaker-open',
  'breaker-close',
  'scale-out',
  'scale-in',
] as const;
export const TimelineMarkerSchema = z.object({
  tSec: NonNegativeNumberSchema,
  kind: z.enum(TIMELINE_MARKER_KINDS),
  label: NonEmptyStringSchema,
  targetIds: z.array(z.string()),
  /** The chaos event this marker belongs to, when there is one. */
  eventId: z.string().optional(),
});
export type TimelineMarker = z.infer<typeof TimelineMarkerSchema>;

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
  /** S11: markers for the timeline (chaos events, health-check removals, breakers, autoscaling). */
  timelineEvents: z.array(TimelineMarkerSchema).optional(),
});
export type SimResult = z.infer<typeof SimResultSchema>;
