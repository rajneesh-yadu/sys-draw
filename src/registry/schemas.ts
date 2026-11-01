/**
 * Schemas for the registry entry kinds core does not define (provider, rule, lesson), plus the
 * registry's stricter view of a problem (docs required). Component and protocol schemas live in core.
 */
import { z } from 'zod';
import {
  FindingSeveritySchema,
  GraphSchema,
  NonEmptyStringSchema,
  NonNegativeNumberSchema,
  PositiveNumberSchema,
  ProblemDefinitionSchema,
  ProviderIdSchema,
  RegionIdSchema,
  RegistryIdSchema,
  type ComponentDefinition,
  type Finding,
  type Graph,
  type GroupKind,
  type ProtocolDefinition,
  type SecurityGroupSettings,
  type Scenario,
  type SimResult,
} from '@/core';

// ---------- Provider ----------

export const ProviderRegionSchema = z.strictObject({
  id: RegionIdSchema, // provider's own region code, e.g. 'us-east-1' or 'us-east'
  name: NonEmptyStringSchema, // 'US East (N. Virginia)'
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  /**
   * The generic provider's region id for the same metro (S12), e.g. AWS 'us-east-1' → 'us-east'.
   * Switching a board's provider maps regions through it. Omit on the generic provider itself.
   */
  genericId: RegionIdSchema.optional(),
});
export type ProviderRegion = z.infer<typeof ProviderRegionSchema>;

/** ISO calendar date (YYYY-MM-DD) the price table was compiled for; prices are approximate. */
export const AsOfDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected an "as of" date like "2026-10-01"');

/** One VM size of a provider's instance family, mapped to a generic size id ('small', 'mem-large'). */
export const ProviderInstanceSizeSchema = z.strictObject({
  /** Generic instance type id used on nodes and in component presets, e.g. 'small'. */
  size: NonEmptyStringSchema,
  /** The provider's name for it, e.g. 'm7i.large'. */
  name: NonEmptyStringSchema,
  vCpu: PositiveNumberSchema,
  memGb: PositiveNumberSchema,
  /** On-demand list price in the provider's reference region (see pricing.region). */
  costUsdPerHour: NonNegativeNumberSchema,
});
export type ProviderInstanceSize = z.infer<typeof ProviderInstanceSizeSchema>;

export const ProviderInstanceFamilySchema = z.strictObject({
  id: NonEmptyStringSchema, // 'general', 'memory'
  name: NonEmptyStringSchema, // 'General purpose (M7i)'
  sizes: z.array(ProviderInstanceSizeSchema).min(1),
});
export type ProviderInstanceFamily = z.infer<typeof ProviderInstanceFamilySchema>;

/**
 * What a service limit is compared with (engine, S12):
 * - `config`: the node's config field `field` (e.g. Lambda `concurrencyLimit` > 1000);
 * - `rps`: the node's arrival rate (total, reads or writes) per node, per shard (hottest) or per replica.
 * Without a check the limit is shown for reference only.
 */
export const LimitCheckSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('config'), field: NonEmptyStringSchema }),
  z.strictObject({
    kind: z.literal('rps'),
    metric: z.enum(['total', 'read', 'write']),
    per: z.enum(['node', 'shard', 'replica']),
  }),
]);
export type LimitCheck = z.infer<typeof LimitCheckSchema>;

export const ServiceLimitSchema = z.strictObject({
  id: NonEmptyStringSchema,
  /** 'Concurrent executions per region' */
  label: NonEmptyStringSchema,
  value: PositiveNumberSchema,
  unit: NonEmptyStringSchema,
  /** True for a default quota you can ask to raise; false for a hard limit of the service. */
  adjustable: z.boolean(),
  check: LimitCheckSchema.optional(),
  /** Only applies when the node's config field equals this value (e.g. SQS FIFO throughput). */
  when: z
    .strictObject({
      field: NonEmptyStringSchema,
      equals: z.union([z.string(), z.number(), z.boolean()]),
    })
    .optional(),
  note: z.string().optional(),
});
export type ServiceLimit = z.infer<typeof ServiceLimitSchema>;

/** Provider-specific data for one component (keyed by component id in `services`). */
export const ProviderServiceSchema = z.strictObject({
  /** Lucide icon shown on nodes on this provider's boards (replaces the component's icon). */
  icon: NonEmptyStringSchema.optional(),
  /** Prefix for instance names from the families, e.g. 'db.' → 'db.m7i.large'. */
  instanceNamePrefix: z.string().optional(),
  /** Managed-service premium over the family price (RDS ≈ 1.7× EC2). Default 1. */
  instancePriceMultiplier: PositiveNumberSchema.optional(),
  /** Prices for the component's own instance type ids that are not family sizes ('managed', '1024mb'). */
  instancePrices: z
    .record(
      NonEmptyStringSchema,
      z.strictObject({ name: NonEmptyStringSchema, costUsdPerHour: NonNegativeNumberSchema }),
    )
    .optional(),
  /** Overrides pricing.requestsUsdPerMillion for this service ($0/h managed services). */
  requestsUsdPerMillion: NonNegativeNumberSchema.optional(),
  /** Overrides pricing.storageUsdPerGbMonth for this service. */
  storageUsdPerGbMonth: NonNegativeNumberSchema.optional(),
  limits: z.array(ServiceLimitSchema).optional(),
  /**
   * For a component only this provider offers: the component other providers should use instead
   * (shown when switching away), e.g. Spanner → 'database.sql'.
   */
  nearest: RegistryIdSchema.optional(),
  /** One line on how this provider's product differs from the generic model. */
  note: z.string().optional(),
});
export type ProviderService = z.infer<typeof ProviderServiceSchema>;

export const ProviderDefinitionSchema = z
  .strictObject({
    id: ProviderIdSchema,
    name: NonEmptyStringSchema,
    shortName: NonEmptyStringSchema,
    regions: z.array(ProviderRegionSchema).min(1, 'Define at least one region'),
    defaultRegionId: RegionIdSchema,
    /** Price table used by engine/cost on top of each component's instance prices. */
    pricing: z.strictObject({
      /** Date the price table was compiled for (S12): every price table carries one. Approximate. */
      asOf: AsOfDateSchema,
      /** Region whose list prices are used, e.g. 'us-east-1'. */
      region: RegionIdSchema,
      /** Multiplies the component's own instance prices when no family/service price applies. */
      instancePriceMultiplier: PositiveNumberSchema,
      egressUsdPerGb: NonNegativeNumberSchema,
      storageUsdPerGbMonth: NonNegativeNumberSchema,
      requestsUsdPerMillion: NonNegativeNumberSchema,
    }),
    /** VM families by generic size (S12). Empty on the generic provider (component prices apply). */
    instanceFamilies: z.array(ProviderInstanceFamilySchema).default([]),
    /** Per-component icons, prices and service limits (S12), keyed by component id. */
    services: z.record(RegistryIdSchema, ProviderServiceSchema).default({}),
    docs: z.strictObject({
      summary: NonEmptyStringSchema,
      howItWorks: z.string(),
      tradeoffs: z.array(z.string()),
    }),
  })
  .superRefine((p, ctx) => {
    const ids = new Set<string>();
    p.regions.forEach((r, i) => {
      if (ids.has(r.id))
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate region id "${r.id}"`,
          path: ['regions', i, 'id'],
        });
      ids.add(r.id);
    });
    const sizes = new Set<string>();
    p.instanceFamilies.forEach((f, fi) =>
      f.sizes.forEach((sz, si) => {
        if (sizes.has(sz.size))
          ctx.addIssue({
            code: 'custom',
            message: `Generic size "${sz.size}" is mapped twice`,
            path: ['instanceFamilies', fi, 'sizes', si, 'size'],
          });
        sizes.add(sz.size);
      }),
    );
    if (!ids.has(p.pricing.region)) {
      ctx.addIssue({
        code: 'custom',
        message: `pricing.region "${p.pricing.region}" is not one of the provider's regions`,
        path: ['pricing', 'region'],
      });
    }
    if (!ids.has(p.defaultRegionId)) {
      ctx.addIssue({
        code: 'custom',
        message: `defaultRegionId "${p.defaultRegionId}" is not one of the provider's regions`,
        path: ['defaultRegionId'],
      });
    }
  });
export type ProviderDefinition = z.infer<typeof ProviderDefinitionSchema>;

// ---------- Review rule ----------

export const RULE_CATEGORIES = [
  'reliability',
  'performance',
  'scalability',
  'security',
  'cost',
] as const;
export type RuleCategory = (typeof RULE_CATEGORIES)[number];

/** What a rule's `check` receives. The engine (S19) builds this; `components` is a registry lookup. */
export interface RuleContext {
  graph: Graph;
  scenario?: Scenario;
  result?: SimResult;
  components: { get(defId: string): ComponentDefinition | undefined };
  /** S16: protocol lookup (edge encryption, ports). Optional so older callers still type-check. */
  protocols?: { get(id: string): ProtocolDefinition | undefined } | undefined;
}
export type RuleCheck = (ctx: RuleContext) => Finding[];

/**
 * S16: one step of a one-click fix, as plain data (the app turns it into undoable store
 * commands). Ids in `groupId` may name a group created by an earlier `createGroup` step (`ref`).
 */
export type FixStep =
  | { kind: 'setGroupSecurity'; groupId: string; security: SecurityGroupSettings }
  | {
      kind: 'createGroup';
      /** Placeholder id later steps use; the app assigns the real id. */
      ref: string;
      groupKind: GroupKind;
      label: string;
      /** Nodes moved into the new group (out of their current group). */
      memberIds: string[];
      parentId?: string | undefined;
      security: SecurityGroupSettings;
    }
  | { kind: 'setEdgeStack'; edgeId: string; protocolStack: string[] }
  /** Put a new `defId` node in the middle of an edge (client → WAF → entry). */
  | { kind: 'insertOnEdge'; edgeId: string; defId: string; label: string }
  /** Add a `defId` node next to `near` and connect each of `connectFrom` to it. */
  | { kind: 'addNode'; defId: string; label: string; near: string; connectFrom: string[] };

export interface FixPlan {
  /** Button / undo label, e.g. "Move Orders DB into a private data subnet". */
  label: string;
  steps: FixStep[];
}
/** Builds the one-click fix for one of the rule's findings (undefined = no automatic fix). */
export type RuleFix = (ctx: RuleContext, finding: Finding) => FixPlan | undefined;

export const RuleDefinitionSchema = z.strictObject({
  id: RegistryIdSchema, // 'rule.spof'
  title: NonEmptyStringSchema,
  category: z.enum(RULE_CATEGORIES),
  /** Default severity of the findings this rule emits. */
  severity: FindingSeveritySchema,
  tags: z.array(z.string()),
  check: z.custom<RuleCheck>((v) => typeof v === 'function', {
    message: 'check must be a function (ctx) => Finding[]',
  }),
  /** S16: optional one-click fix for a finding. */
  fix: z
    .custom<RuleFix>((v) => typeof v === 'function', {
      message: 'fix must be a function (ctx, finding) => FixPlan | undefined',
    })
    .optional(),
  docs: z.strictObject({
    summary: NonEmptyStringSchema,
    why: z.string(),
    howToFix: z.string(),
  }),
});
export type RuleDefinition = z.infer<typeof RuleDefinitionSchema>;

// ---------- Lesson (Learn mode) ----------

export const LessonQuizItemSchema = z
  .strictObject({
    question: NonEmptyStringSchema,
    options: z.array(NonEmptyStringSchema).min(2, 'A quiz question needs at least two options'),
    answerIndex: z.number().int().nonnegative(),
    explanation: z.string(),
  })
  .refine((q) => q.answerIndex < q.options.length, {
    message: 'answerIndex must point at one of the options',
    path: ['answerIndex'],
  });

export const LessonDefinitionSchema = z.strictObject({
  id: RegistryIdSchema, // 'lesson.consistent-hashing'
  title: NonEmptyStringSchema,
  level: z.number().int().min(1).max(5),
  tags: z.array(z.string()),
  /** Registry ids this lesson teaches (components, protocols, rules). */
  related: z.array(RegistryIdSchema),
  steps: z
    .array(
      z.strictObject({
        title: NonEmptyStringSchema,
        body: NonEmptyStringSchema,
        /** Node/edge ids on the mini-board to highlight during this step. */
        focusIds: z.array(z.string()).optional(),
      }),
    )
    .min(1, 'A lesson needs at least one step'),
  quiz: z.array(LessonQuizItemSchema),
  /** Mini-board to try the concept on. */
  board: GraphSchema.optional(),
  docs: z.strictObject({ summary: NonEmptyStringSchema }),
});
export type LessonDefinition = z.infer<typeof LessonDefinitionSchema>;

// ---------- Problem (docs required in the registry) ----------

export const RegistryProblemSchema = ProblemDefinitionSchema.extend({
  docs: z.strictObject({ summary: NonEmptyStringSchema }),
});
export type RegistryProblemDefinition = z.infer<typeof RegistryProblemSchema>;
