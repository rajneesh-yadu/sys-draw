/**
 * Pipeline step 8 — cost per month (730 h). Three pricing shapes, chosen from the data:
 * - instance-priced (costUsdPerHour > 0): instances × $/h × provider multiplier × 730,
 *   instances = shards × (replicas, or primary + read replicas) + billed standbys;
 * - platform-scaled (role `maxInstances`, serverless): busy instances by Little's law
 *   (L = λ_avg × S̄) or the provisioned minimum, whichever is larger, × $/h × 730;
 * - managed, pay-per-request ($0/h): requests per month × provider $/million.
 * Plus storage: GB × copies × provider $/GB-month. Monthly volume uses the AVERAGE rate
 * (simulated peak ÷ peakMultiplier). Egress is priced with geo (S10).
 */
import { fmt } from '../model/format';
import type { CompiledNode, NodeStats } from '../model/types';
import { readersPerShard, servingInstances } from '../scaling/pools';

export const HOURS_PER_MONTH = 730;
export const SECONDS_PER_MONTH = HOURS_PER_MONTH * 3600;

export interface Pricing {
  instancePriceMultiplier: number;
  egressUsdPerGb: number;
  storageUsdPerGbMonth: number;
  requestsUsdPerMillion: number;
  /**
   * The provider's own price for this node's instance type (S12: family size or service price,
   * e.g. 'db.m6i.large' at $0.171/h). Replaces the component price × multiplier when present.
   */
  instance?: { name: string; costUsdPerHour: number; source: string } | undefined;
  /** Where the request/storage prices come from, appended to the explain (S12). */
  source?: string | undefined;
}

/** Used when the board's provider is not in the registry (matches the generic provider). */
export const FALLBACK_PRICING: Readonly<Pricing> = Object.freeze({
  instancePriceMultiplier: 1,
  egressUsdPerGb: 0.09,
  storageUsdPerGbMonth: 0.023,
  requestsUsdPerMillion: 0.4,
});

export interface NodeCost {
  computePerMonth: number;
  storagePerMonth: number;
  costPerMonth: number;
  /** Instances billed (for instance-priced components). */
  billedInstances: number;
  explain: string;
}

const usd = (v: number) => `$${fmt(v)}`;

export function nodeCost(
  node: CompiledNode,
  stats: NodeStats,
  pricing: Pricing,
  peakMultiplier: number,
): NodeCost {
  const none: NodeCost = {
    computePerMonth: 0,
    storagePerMonth: 0,
    costPerMonth: 0,
    billedInstances: 0,
    explain: node.kind === 'source' ? 'Clients are your users: no cost.' : 'No cost model.',
  };
  if (node.kind !== 'service' || !node.instanceType) return none;

  const spec = node.scale;
  const type = node.instanceType;
  const own = pricing.instance;
  const pricePerHour = own
    ? own.costUsdPerHour
    : type.costUsdPerHour * pricing.instancePriceMultiplier;
  const typeLabel = own
    ? `${own.name} at ${usd(own.costUsdPerHour)}/h, ${own.source}`
    : `${type.id} at ${usd(type.costUsdPerHour)}/h` +
      `${pricing.instancePriceMultiplier !== 1 ? ` × ${fmt(pricing.instancePriceMultiplier)}` : ''}`;
  const avgRps = stats.servedRps / Math.max(1, peakMultiplier);
  const lines: string[] = [];
  let compute: number;
  let billed = 0;

  if (spec.platform) {
    const busy = (avgRps * stats.meanServiceMs) / 1000;
    billed = Math.max(busy, spec.platform.minInstances);
    compute = billed * pricePerHour * HOURS_PER_MONTH;
    lines.push(
      `compute = max(busy, provisioned) × $/h × 730 = max(${fmt(busy)}, ${fmt(spec.platform.minInstances)}) × ${usd(pricePerHour)} × 730 = ${usd(compute)}` +
        ` (busy instances L = λ_avg × S̄ = ${fmt(avgRps)} × ${fmt(stats.meanServiceMs)} ms; ${typeLabel})`,
    );
  } else if (pricePerHour > 0) {
    const serving = servingInstances(spec, stats.replicas);
    const standbys = spec.standby * spec.shards;
    billed = serving + standbys;
    compute = billed * pricePerHour * HOURS_PER_MONTH;
    const shape = spec.singleWriter
      ? `${spec.shards} shard(s) × (1 primary + ${readersPerShard(spec, stats.replicas)} read replicas)`
      : `${spec.shards > 1 ? `${spec.shards} shards × ` : ''}${stats.replicas} replicas`;
    lines.push(
      `compute = instances × $/h × 730 = ${fmt(billed)} × ${usd(pricePerHour)} × 730 = ${usd(compute)}` +
        ` (${shape}${standbys > 0 ? ` + ${standbys} standby` : ''}; ${typeLabel})`,
    );
  } else {
    const requests = avgRps * SECONDS_PER_MONTH;
    compute = (requests / 1e6) * pricing.requestsUsdPerMillion;
    lines.push(
      `requests = λ_avg × 2.628M s = ${fmt(avgRps)} × ${fmt(SECONDS_PER_MONTH)} = ${fmt(requests)}/month; ` +
        `× ${usd(pricing.requestsUsdPerMillion)} per million = ${usd(compute)}`,
    );
  }

  let storage = 0;
  if (spec.storageGb > 0) {
    const copies =
      spec.storageCopies ??
      (spec.singleWriter ? 1 + readersPerShard(spec, stats.replicas) + spec.standby : 1);
    storage = spec.storageGb * copies * pricing.storageUsdPerGbMonth;
    lines.push(
      `storage = GB × copies × $/GB-month = ${fmt(spec.storageGb)} × ${fmt(copies)} × ${usd(pricing.storageUsdPerGbMonth)} = ${usd(storage)}`,
    );
  }

  const total = compute + storage;
  if (avgRps !== stats.servedRps && !(pricePerHour > 0 && !spec.platform)) {
    lines.push(
      `λ_avg = peak λ ÷ peakMultiplier = ${fmt(stats.servedRps)} ÷ ${fmt(peakMultiplier)}`,
    );
  }
  if (pricing.source && (!own || spec.storageGb > 0 || !(pricePerHour > 0)))
    lines.push(`prices: ${pricing.source}`);
  return {
    computePerMonth: compute,
    storagePerMonth: storage,
    costPerMonth: total,
    billedInstances: billed,
    explain: `cost/month = ${usd(total)}: ${lines.join('; ')}.`,
  };
}
