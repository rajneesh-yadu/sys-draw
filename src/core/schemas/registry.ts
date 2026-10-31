/**
 * Registry entry schemas (DATA-MODEL.md → "Registry entries" and the Problem entry).
 * Registry files are hand-written, so these use strict objects: a typo like `defualts` fails loudly.
 * The `define*` helpers and lookups belong to the registry module (S03).
 */
import { z } from 'zod';
import { RegistryIdSchema } from '../ids';
import {
  BehaviorIdSchema,
  CategorySchema,
  NonEmptyStringSchema,
  NonNegativeIntSchema,
  NonNegativeNumberSchema,
  PositiveIntSchema,
  PositiveNumberSchema,
  ProtocolIdSchema,
  PROVIDER_IDS,
} from './common';
import { GraphSchema } from './graph';
import { ScenarioSchema } from './scenario';

export const InstanceTypeSchema = z.strictObject({
  id: NonEmptyStringSchema, // e.g. 'm6i.large' or 'small'
  vCpu: PositiveNumberSchema,
  memGb: PositiveNumberSchema,
  netGbps: PositiveNumberSchema,
  costUsdPerHour: NonNegativeNumberSchema,
});
export type InstanceType = z.infer<typeof InstanceTypeSchema>;

export const SCALE_CURVES = ['linear', 'sublinear', 'single-writer'] as const;
export const SATURATION_BEHAVIORS = ['queue', 'reject', 'degrade'] as const;

export const PerfModelSchema = z.strictObject({
  serviceTimeMs: z.strictObject({ read: PositiveNumberSchema, write: PositiveNumberSchema }),
  maxConcurrencyPerInstance: PositiveIntSchema,
  scaleCurve: z.enum(SCALE_CURVES),
  saturationBehavior: z.enum(SATURATION_BEHAVIORS),
});
export type PerfModel = z.infer<typeof PerfModelSchema>;

export const PORT_DIRECTIONS = ['in', 'out', 'both'] as const;

export const PortSchema = z.strictObject({
  id: NonEmptyStringSchema,
  direction: z.enum(PORT_DIRECTIONS),
  protocols: z.array(ProtocolIdSchema),
});
export type Port = z.infer<typeof PortSchema>;

/** Every registry entry carries docs; an empty summary is rejected (ARCHITECTURE.md convention). */
export const ComponentDocsSchema = z.strictObject({
  summary: NonEmptyStringSchema,
  howItWorks: z.string(),
  tradeoffs: z.array(z.string()),
  interviewTips: z.array(z.string()),
});

const ProviderNamesSchema = z.partialRecord(z.enum(PROVIDER_IDS), NonEmptyStringSchema);

export const ComponentDefinitionSchema = z
  .strictObject({
    id: RegistryIdSchema,
    name: NonEmptyStringSchema,
    category: CategorySchema,
    tags: z.array(z.string()),
    icon: NonEmptyStringSchema,
    providerNames: ProviderNamesSchema.optional(),
    ports: z.array(PortSchema),
    configSchema: z.custom<z.ZodObject>((v) => v instanceof z.ZodObject, {
      message: 'configSchema must be a Zod object schema (z.object({...}))',
    }),
    defaults: z.record(z.string(), z.unknown()),
    instanceTypes: z.array(InstanceTypeSchema).min(1, 'Define at least one instance type'),
    perf: PerfModelSchema,
    behaviors: z.array(BehaviorIdSchema).optional(),
    docs: ComponentDocsSchema,
    security: z
      .strictObject({
        defaultPorts: z.array(z.number().int().min(0).max(65_535)),
        threats: z.array(z.string()),
        controls: z.array(z.string()),
      })
      .optional(),
  })
  .superRefine((def, ctx) => {
    const res = def.configSchema.safeParse(def.defaults);
    if (!res.success) {
      for (const issue of res.error.issues) {
        ctx.addIssue({
          code: 'custom',
          message: `defaults do not match configSchema: ${issue.message}`,
          path: ['defaults', ...issue.path.map((p) => (typeof p === 'symbol' ? String(p) : p))],
        });
      }
    }
    const portIds = new Set<string>();
    def.ports.forEach((p, i) => {
      if (portIds.has(p.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate port id "${p.id}"`,
          path: ['ports', i, 'id'],
        });
      }
      portIds.add(p.id);
    });
  });
export type ComponentDefinition = z.infer<typeof ComponentDefinitionSchema>;

export const OSI_LAYERS = [1, 2, 3, 4, 5, 6, 7] as const;

export const ProtocolDefinitionSchema = z.strictObject({
  id: ProtocolIdSchema,
  name: NonEmptyStringSchema,
  osiLayer: z.union(OSI_LAYERS.map((l) => z.literal(l))),
  handshakeRtts: NonNegativeNumberSchema,
  perMessageOverheadBytes: NonNegativeIntSchema,
  multiplexing: z.boolean(),
  reliable: z.boolean(),
  ordered: z.boolean(),
  encrypted: z.boolean(),
  /** Allowed lower protocols; empty for the bottom of a stack. */
  runsOn: z.array(ProtocolIdSchema),
  docs: z.strictObject({
    summary: NonEmptyStringSchema,
    handshakeSteps: z.array(z.string()),
    headerFields: z.array(z.string()),
    securityNotes: z.array(z.string()),
  }),
});
export type ProtocolDefinition = z.infer<typeof ProtocolDefinitionSchema>;

// ---------- Problem entry (defineProblem) ----------

export const SLO_METRICS = [
  'p50',
  'p95',
  'p99',
  'errorRate',
  'availability',
  'rps',
  'costPerMonth',
] as const;
export const SLO_OPS = ['lt', 'lte', 'gt', 'gte'] as const;

export const SloTargetSchema = z.strictObject({
  metric: z.enum(SLO_METRICS),
  op: z.enum(SLO_OPS),
  value: z.number().finite(),
  /** Flow the target applies to; omit for system-wide. */
  flowId: z.string().optional(),
  /** Load at which the target must hold, e.g. p99 < 200 ms at 50k rps. */
  atRps: PositiveNumberSchema.optional(),
});
export type SloTarget = z.infer<typeof SloTargetSchema>;

/** One rubric line: a review rule and/or an SLO target, with its weight. */
export const RubricItemSchema = z
  .strictObject({
    ruleId: RegistryIdSchema.optional(),
    slo: SloTargetSchema.optional(),
    weight: PositiveNumberSchema,
  })
  .refine((r) => r.ruleId !== undefined || r.slo !== undefined, {
    message: 'A rubric item needs a ruleId, an slo, or both',
  });
export type RubricItem = z.infer<typeof RubricItemSchema>;

export const DebugVariantSchema = z.strictObject({
  id: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  graph: GraphSchema,
  expectedFix: NonEmptyStringSchema,
  /** Rule ids whose findings must disappear for the fix to count. */
  fixedWhenRulesPass: z.array(RegistryIdSchema).optional(),
});
export type DebugVariant = z.infer<typeof DebugVariantSchema>;

export const ProblemDefinitionSchema = z.strictObject({
  id: RegistryIdSchema,
  title: NonEmptyStringSchema,
  level: z.number().int().min(1).max(5),
  tags: z.array(z.string()),
  requirements: z.strictObject({
    functional: z.array(NonEmptyStringSchema).min(1, 'List at least one functional requirement'),
    nonFunctional: z.array(NonEmptyStringSchema),
  }),
  scale: z.strictObject({
    dau: NonNegativeNumberSchema,
    /** Reads per write, e.g. 100 for a 100:1 read-heavy system. */
    readWriteRatio: PositiveNumberSchema,
    dataSizeBytes: NonNegativeNumberSchema,
  }),
  scenario: ScenarioSchema,
  hints: z.array(NonEmptyStringSchema),
  referenceSolutions: z.array(GraphSchema).min(1, 'Ship at least one reference solution'),
  rubric: z.array(RubricItemSchema),
  debugVariants: z.array(DebugVariantSchema),
  docs: z.strictObject({ summary: NonEmptyStringSchema }).optional(),
});
export type ProblemDefinition = z.infer<typeof ProblemDefinitionSchema>;
