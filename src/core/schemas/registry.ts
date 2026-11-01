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

/** How far a lost packet stalls traffic: the whole connection (TCP), one stream (QUIC), nothing. */
export const HOL_BLOCKING_SCOPES = ['connection', 'stream', 'none'] as const;
/** Communication pattern a protocol teaches (S14). */
export const PROTOCOL_PATTERNS = [
  'request-response',
  'multiplexed',
  'bidirectional',
  'server-push',
  'pub-sub',
  'stream',
  'datagram',
  'encoding',
  'security',
  'routing',
] as const;
export const HANDSHAKE_SENDERS = ['client', 'server'] as const;

/** One message of a connection handshake, in order (S14; shown in the edge inspector and trace). */
export const HandshakeMessageSchema = z.strictObject({
  from: z.enum(HANDSHAKE_SENDERS),
  message: NonEmptyStringSchema, // 'SYN', 'ClientHello'
  detail: z.string().optional(),
});
export type HandshakeMessage = z.infer<typeof HandshakeMessageSchema>;

/**
 * Loss recovery of a transport (S14): a lost packet costs max(minRecoveryMs, recoveryRtts × RTT)
 * before it is resent (TCP: RTO ≈ SRTT + 4·RTTVAR ≈ 3 RTT, at least 200 ms on Linux; QUIC: time
 * threshold 9/8 RTT, 1 ms granularity).
 */
export const ProtocolLossSchema = z.strictObject({
  recoveryRtts: NonNegativeNumberSchema,
  minRecoveryMs: NonNegativeNumberSchema,
  holBlocking: z.enum(HOL_BLOCKING_SCOPES),
});
export type ProtocolLoss = z.infer<typeof ProtocolLossSchema>;

/**
 * A default stack for a component pair (S14). Matchers: component id ('messaging.kafka'),
 * 'category:<category>' or 'tag:<tag>'; an empty list matches anything.
 */
export const ProtocolSuggestionSchema = z.strictObject({
  from: z.array(NonEmptyStringSchema),
  to: z.array(NonEmptyStringSchema),
  /** Bottom-up stack, e.g. ['udp', 'quic', 'http3']. */
  stack: z.array(ProtocolIdSchema).min(1),
  why: NonEmptyStringSchema,
});
export type ProtocolSuggestion = z.infer<typeof ProtocolSuggestionSchema>;

const PortNumberSchema = z.number().int().min(0).max(65_535);

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
  // ---- S14 (all optional, so older entries stay valid) ----
  /** Handshake RTTs when a client resumes a session on a new connection (TLS 1.3 / QUIC 0-RTT = 0). */
  resumedHandshakeRtts: NonNegativeNumberSchema.optional(),
  /**
   * `perMessageOverheadBytes` is paid once per this many bytes of the layer above (TCP segment
   * = MSS 1460, TLS record = 16 384). Omitted = once per message.
   */
  unitBytes: PositiveIntSchema.optional(),
  pattern: z.enum(PROTOCOL_PATTERNS).optional(),
  /** Typical server ports: plain and over TLS (HTTP 80 / 443, PostgreSQL 5432 / 5432). */
  ports: z
    .strictObject({
      plain: z.array(PortNumberSchema).optional(),
      secure: z.array(PortNumberSchema).optional(),
    })
    .optional(),
  /** Messages of the handshake on a new connection, in order. */
  handshakeSequence: z.array(HandshakeMessageSchema).optional(),
  /** Transports only: how a lost packet is recovered. */
  loss: ProtocolLossSchema.optional(),
  /** Assumed under every stack and never placed on an edge (IPv4, Ethernet): shown in the OSI view. */
  implicit: z.boolean().optional(),
  /** Taught in docs and the OSI view but not simulated or placed on edges (ICMP, BGP, fibre). */
  conceptual: z.boolean().optional(),
  /** Encodings: wire size of a payload relative to JSON (Protobuf ≈ 0.4). */
  payloadSizeFactor: PositiveNumberSchema.optional(),
  /** Default stacks for component pairs that should use this protocol. */
  suggestedStacks: z.array(ProtocolSuggestionSchema).optional(),
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
