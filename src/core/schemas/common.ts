/**
 * Shared enums and primitives referenced by DATA-MODEL.md but not spelled out there.
 * Closed sets (providers, modes, categories) are enums; open sets that grow with the
 * registry (regions, behaviors, protocols) are validated id strings.
 */
import { z } from 'zod';
import { RegistryIdSchema } from '../ids';

export const PROVIDER_IDS = ['generic', 'aws', 'gcp', 'azure'] as const;
export const ProviderIdSchema = z.enum(PROVIDER_IDS);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

export const MODE_IDS = ['sandbox', 'guided', 'interview', 'debug', 'learn', 'chaos'] as const;
export const ModeIdSchema = z.enum(MODE_IDS);
export type ModeId = z.infer<typeof ModeIdSchema>;

/** Matches the registry/components/<category>/ folders. */
export const CATEGORIES = [
  'clients',
  'compute',
  'network',
  'storage',
  'database',
  'cache',
  'messaging',
  'security',
  'observability',
] as const;
export const CategorySchema = z.enum(CATEGORIES);
export type Category = z.infer<typeof CategorySchema>;

/**
 * Cloud regions (`us-east-1`, `ap-south-1`) and user regions (`north-america`, `india`) come from the
 * geo table (engine/geo), so core only checks the shape.
 */
export const RegionIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Expected a region id like "us-east-1" or "europe"');
export type RegionId = z.infer<typeof RegionIdSchema>;

/** Behaviors named in ENGINE.md. New behaviors are new files, so the schema accepts any camelCase id. */
export const KNOWN_BEHAVIOR_IDS = [
  'loadBalancer',
  'cache',
  'queue',
  'replicatedStore',
  'shardedStore',
  'cdn',
  'rateLimiter',
  'serverless',
  'circuitBreaker',
] as const;
export const BehaviorIdSchema = z
  .string()
  .regex(/^[a-z][A-Za-z0-9]*$/, 'Expected a camelCase behavior id like "loadBalancer"');
export type BehaviorId = z.infer<typeof BehaviorIdSchema>;

/** Protocol ids in an edge's stack, e.g. `tcp`, `tls13`, `http2` (or dotted `proto.http2`). */
export const ProtocolIdSchema = RegistryIdSchema;

export const IsoDateTimeSchema = z.iso.datetime({
  offset: true,
  message: 'Expected an ISO-8601 date-time like "2026-10-31T12:00:00Z"',
});

export const NonEmptyStringSchema = z.string().trim().min(1, 'Must not be empty');
export const NonNegativeNumberSchema = z.number().finite().nonnegative();
export const PositiveNumberSchema = z.number().finite().positive();
export const RatioSchema = z.number().min(0, 'Must be ≥ 0').max(1, 'Must be ≤ 1');
export const PositiveIntSchema = z.number().int().positive();
export const NonNegativeIntSchema = z.number().int().nonnegative();

export const LatencyPercentilesSchema = z.object({
  p50: NonNegativeNumberSchema,
  p95: NonNegativeNumberSchema,
  p99: NonNegativeNumberSchema,
});
export type LatencyPercentiles = z.infer<typeof LatencyPercentilesSchema>;

/** Metric name → human-readable formula with its inputs ("ρ = λ/(cμ) = 900/(2×500) = 0.9"). */
export const ExplainSchema = z.record(z.string(), z.string());
