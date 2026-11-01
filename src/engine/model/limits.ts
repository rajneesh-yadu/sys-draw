/**
 * Provider service limits (S12). Each limit with a `check` from the board provider's registry
 * entry is compared with the node's config or its simulated arrival rate:
 *   config: config[field] > limit;
 *   rps:    λ (total, reads or writes) per node, per hottest shard (λ × max(1/S, skew)) or
 *           per replica (λ ÷ (shards × replicas)) > limit.
 * Exceeding a limit is a warning finding; the simulation does not throttle (yet).
 */
import type { Finding } from '@/core';
import {
  isAvailableOn,
  serviceLimits,
  type ProviderDefinition,
  type ServiceLimit,
} from '@/registry';
import { componentDisplayNameOf } from './names';
import { engineFinding } from './findings';
import { fmt } from './format';
import type { CompiledNode, NodeStats } from './types';

export interface LimitHit {
  limit: ServiceLimit;
  actual: number;
  /** "λ_write per shard = 1,500 × 0.5 = 750 writes/s" */
  explain: string;
}

/** Limits this node exceeds on this provider. */
export function exceededLimits(
  node: CompiledNode,
  stats: NodeStats | undefined,
  provider: ProviderDefinition | undefined,
): LimitHit[] {
  const hits: LimitHit[] = [];
  for (const limit of serviceLimits(provider, node.defId, node.config)) {
    const check = limit.check;
    if (!check) continue;
    if (check.kind === 'config') {
      const v = node.config[check.field];
      if (typeof v === 'number' && v > limit.value)
        hits.push({ limit, actual: v, explain: `${check.field} = ${fmt(v)}` });
      continue;
    }
    if (!stats) continue;
    const lambda =
      check.metric === 'read'
        ? stats.rps.read
        : check.metric === 'write'
          ? stats.rps.write
          : stats.rps.read + stats.rps.write;
    const name = check.metric === 'total' ? 'λ' : `λ_${check.metric}`;
    let actual = lambda;
    let explain = `${name} = ${fmt(lambda)} rps`;
    if (check.per === 'shard') {
      const share = node.scale.hotShardShare;
      actual = lambda * share;
      explain = `${name} on the hottest shard = ${fmt(lambda)} × ${fmt(share)} = ${fmt(actual)} rps`;
    } else if (check.per === 'replica') {
      const n = Math.max(1, stats.replicas * node.scale.shards);
      actual = lambda / n;
      explain = `${name} per replica = ${fmt(lambda)} ÷ ${fmt(n)} = ${fmt(actual)} rps`;
    }
    if (actual > limit.value) hits.push({ limit, actual, explain });
  }
  return hits;
}

/** One warning per exceeded limit, naming the provider product and how to fix it. */
export function providerLimitFindings(
  nodes: Iterable<CompiledNode>,
  statsOf: (id: string) => NodeStats | undefined,
  provider: ProviderDefinition | undefined,
): Finding[] {
  if (!provider) return [];
  const out: Finding[] = [];
  for (const node of nodes) {
    if (node.def && !isAvailableOn(node.def, provider.id)) {
      out.push(
        engineFinding(
          'engine.limits',
          'warning',
          `No ${provider.shortName} equivalent`,
          `"${node.label}" is ${node.def.name}, which ${provider.shortName} does not offer. It is simulated with its own model and prices; replace it with a ${provider.shortName} service to make the design deployable.`,
          [node.id],
        ),
      );
    }
    for (const hit of exceededLimits(node, statsOf(node.id), provider)) {
      const { limit } = hit;
      const product = componentDisplayNameOf(node, provider.id);
      out.push(
        engineFinding(
          'engine.limits',
          'warning',
          `${provider.shortName} limit: ${limit.label}`,
          `"${node.label}" (${product}): ${hit.explain} exceeds ${fmt(limit.value)} ${limit.unit}. ` +
            (limit.adjustable
              ? 'This is a default quota: request an increase before launch, or spread the load.'
              : 'This is a hard limit of the service: spread the load (more shards / partitions, better keys) or choose another design.') +
            (limit.note ? ` ${limit.note}` : ''),
          [node.id],
        ),
      );
    }
  }
  return out;
}
