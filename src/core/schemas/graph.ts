/** The design: nodes, edges and groups (DATA-MODEL.md → "The design"). */
import { z } from 'zod';
import { idSchema, RegistryIdSchema } from '../ids';
import {
  NonEmptyStringSchema,
  NonNegativeIntSchema,
  PositiveIntSchema,
  ProtocolIdSchema,
  RatioSchema,
  RegionIdSchema,
} from './common';

export const PositionSchema = z.object({ x: z.number().finite(), y: z.number().finite() });
export type Position = z.infer<typeof PositionSchema>;

export const AutoscaleSchema = z
  .object({
    min: PositiveIntSchema,
    max: PositiveIntSchema,
    targetUtil: RatioSchema.refine((v) => v > 0, 'Must be > 0'),
    warmupSec: z.number().finite().nonnegative(),
  })
  .refine((a) => a.max >= a.min, { message: 'max must be ≥ min', path: ['max'] });
export type Autoscale = z.infer<typeof AutoscaleSchema>;

export const NodeScalingSchema = z.object({
  replicas: PositiveIntSchema,
  instanceType: NonEmptyStringSchema,
  autoscale: AutoscaleSchema.optional(),
});
export type NodeScaling = z.infer<typeof NodeScalingSchema>;

export const NodeInstanceSchema = z.object({
  id: idSchema('node'),
  defId: RegistryIdSchema,
  label: NonEmptyStringSchema,
  position: PositionSchema,
  groupId: idSchema('group').optional(),
  /** Validated against the component's configSchema by the registry, not here. */
  config: z.record(z.string(), z.unknown()),
  scaling: NodeScalingSchema,
});
export type NodeInstance = z.infer<typeof NodeInstanceSchema>;

export const BACKOFF_KINDS = ['none', 'fixed', 'exp'] as const;

export const EdgeConfigSchema = z.object({
  timeoutMs: z.number().finite().positive().optional(),
  retries: NonNegativeIntSchema.optional(),
  backoff: z.enum(BACKOFF_KINDS).optional(),
  poolSize: PositiveIntSchema.optional(),
  /**
   * Circuit breaker (S11): opens when the share of failed calls over the last 10 s reaches this
   * ratio; while open, calls fail fast without reaching the target. Omit = no breaker.
   */
  breakerErrorThreshold: RatioSchema.refine((v) => v > 0, 'Must be > 0').optional(),
  /** Seconds the breaker stays open before letting a trial tick through (default 30). */
  breakerOpenSec: z.number().finite().positive().optional(),
  /**
   * S14: share of requests that open a new connection (no keep-alive / pool reuse) and so pay the
   * stack's handshake RTTs. Omit = 0 (every request reuses a warm connection).
   */
  newConnectionShare: RatioSchema.optional(),
});
export type EdgeConfig = z.infer<typeof EdgeConfigSchema>;

export const EdgeInstanceSchema = z.object({
  id: idSchema('edge'),
  source: idSchema('node'),
  target: idSchema('node'),
  /** Optional port ids on the source/target ComponentDefinition ("node ids + optional port ids"). */
  sourcePortId: NonEmptyStringSchema.optional(),
  targetPortId: NonEmptyStringSchema.optional(),
  /** Bottom-up protocol ids, e.g. ['ip', 'tcp', 'tls13', 'http2']. */
  protocolStack: z.array(ProtocolIdSchema),
  sync: z.boolean(),
  config: EdgeConfigSchema,
});
export type EdgeInstance = z.infer<typeof EdgeInstanceSchema>;

export const FIREWALL_DIRECTIONS = ['ingress', 'egress'] as const;
export const FIREWALL_ACTIONS = ['allow', 'deny'] as const;
export const FIREWALL_PROTOCOLS = ['tcp', 'udp', 'icmp', 'any'] as const;

/** A security-group / firewall rule on a group (the `Rule` in DATA-MODEL.md's Group.security). */
export const FirewallRuleSchema = z
  .object({
    direction: z.enum(FIREWALL_DIRECTIONS),
    action: z.enum(FIREWALL_ACTIONS),
    protocol: z.enum(FIREWALL_PROTOCOLS),
    /** Inclusive port range; omit both for "all ports". */
    fromPort: z.number().int().min(0).max(65_535).optional(),
    toPort: z.number().int().min(0).max(65_535).optional(),
    /** CIDR ("10.0.0.0/16"), a group id, or "internet". */
    peer: NonEmptyStringSchema,
    description: z.string().optional(),
  })
  .refine((r) => (r.fromPort === undefined) === (r.toPort === undefined), {
    message: 'Set both fromPort and toPort, or neither',
    path: ['toPort'],
  })
  .refine((r) => r.fromPort === undefined || r.toPort === undefined || r.toPort >= r.fromPort, {
    message: 'toPort must be ≥ fromPort',
    path: ['toPort'],
  });
export type FirewallRule = z.infer<typeof FirewallRuleSchema>;

export const GROUP_KINDS = ['region', 'az', 'vpc', 'subnet', 'cluster'] as const;
export const GroupKindSchema = z.enum(GROUP_KINDS);
export type GroupKind = z.infer<typeof GroupKindSchema>;

export const GroupSchema = z.object({
  id: idSchema('group'),
  kind: GroupKindSchema,
  label: NonEmptyStringSchema,
  regionId: RegionIdSchema.optional(),
  parentId: idSchema('group').optional(),
  security: z
    .object({ public: z.boolean(), firewallRules: z.array(FirewallRuleSchema) })
    .optional(),
});
export type Group = z.infer<typeof GroupSchema>;

/** Adds an issue for each duplicate id in `items` at `path[i].id`. */
function checkUniqueIds(
  items: readonly { id: string }[],
  path: string,
  ctx: z.RefinementCtx,
): Set<string> {
  const seen = new Set<string>();
  items.forEach((item, i) => {
    if (seen.has(item.id)) {
      ctx.addIssue({ code: 'custom', message: `Duplicate id "${item.id}"`, path: [path, i, 'id'] });
    }
    seen.add(item.id);
  });
  return seen;
}

/**
 * Structural checks only (ids unique, references resolve, no group cycles).
 * Semantic checks (missing cache, SPOF, …) are review rules, so a half-finished design still saves.
 */
export const GraphSchema = z
  .object({
    nodes: z.array(NodeInstanceSchema),
    edges: z.array(EdgeInstanceSchema),
    groups: z.array(GroupSchema),
  })
  .superRefine((g, ctx) => {
    const nodeIds = checkUniqueIds(g.nodes, 'nodes', ctx);
    checkUniqueIds(g.edges, 'edges', ctx);
    const groupIds = checkUniqueIds(g.groups, 'groups', ctx);

    g.nodes.forEach((n, i) => {
      if (n.groupId !== undefined && !groupIds.has(n.groupId)) {
        ctx.addIssue({
          code: 'custom',
          message: `Unknown group "${n.groupId}"`,
          path: ['nodes', i, 'groupId'],
        });
      }
    });
    g.edges.forEach((e, i) => {
      for (const end of ['source', 'target'] as const) {
        if (!nodeIds.has(e[end])) {
          ctx.addIssue({
            code: 'custom',
            message: `Edge ${end} "${e[end]}" is not a node in this graph`,
            path: ['edges', i, end],
          });
        }
      }
    });

    const parentOf = new Map(g.groups.map((gr) => [gr.id, gr.parentId]));
    g.groups.forEach((gr, i) => {
      if (gr.parentId === undefined) return;
      if (!groupIds.has(gr.parentId)) {
        ctx.addIssue({
          code: 'custom',
          message: `Unknown parent group "${gr.parentId}"`,
          path: ['groups', i, 'parentId'],
        });
        return;
      }
      const visited = new Set<string>([gr.id]);
      let cur: string | undefined = gr.parentId;
      while (cur !== undefined) {
        if (visited.has(cur)) {
          ctx.addIssue({
            code: 'custom',
            message: `Group "${gr.id}" is nested inside itself`,
            path: ['groups', i, 'parentId'],
          });
          return;
        }
        visited.add(cur);
        cur = parentOf.get(cur);
      }
    });
  });
export type Graph = z.infer<typeof GraphSchema>;

export const EMPTY_GRAPH: Graph = { nodes: [], edges: [], groups: [] };
