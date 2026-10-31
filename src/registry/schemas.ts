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
  type Scenario,
  type SimResult,
} from '@/core';

// ---------- Provider ----------

export const ProviderRegionSchema = z.strictObject({
  id: RegionIdSchema, // provider's own region code, e.g. 'us-east-1' or 'us-east'
  name: NonEmptyStringSchema, // 'US East (N. Virginia)'
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});
export type ProviderRegion = z.infer<typeof ProviderRegionSchema>;

export const ProviderDefinitionSchema = z
  .strictObject({
    id: ProviderIdSchema,
    name: NonEmptyStringSchema,
    shortName: NonEmptyStringSchema,
    regions: z.array(ProviderRegionSchema).min(1, 'Define at least one region'),
    defaultRegionId: RegionIdSchema,
    /** Price table used by engine/cost on top of each component's instance prices. */
    pricing: z.strictObject({
      /** Multiplies every instance's costUsdPerHour (1 = list price). */
      instancePriceMultiplier: PositiveNumberSchema,
      egressUsdPerGb: NonNegativeNumberSchema,
      storageUsdPerGbMonth: NonNegativeNumberSchema,
      requestsUsdPerMillion: NonNegativeNumberSchema,
    }),
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
}
export type RuleCheck = (ctx: RuleContext) => Finding[];

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
