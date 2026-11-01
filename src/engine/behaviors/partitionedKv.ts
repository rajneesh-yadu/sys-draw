/**
 * partitionedKv: a DynamoDB-style managed key-value table. Each partition is an "instance" with a
 * hard throughput budget of 3 000 read units and 1 000 write units per second:
 *   read units  per read  = ⌈item / 4 KB⌉ × (0.5 eventual | 1 strong | 2 transactional)
 *   write units per write = ⌈item / 1 KB⌉ × (1 + GSIs) × (2 if transactional)
 * Partitions = max(configured, ⌈storage / 10 GB⌉) — a partition splits when it outgrows 10 GB.
 * The work per request is set so a partition saturates exactly at that budget (μ·c = budget);
 * the wait stays the component's measured latency. Over budget ⇒ throttled (rejected), and the
 * hottest key's partition throttles first whatever the table's total capacity.
 */
import { fmt, pct } from '../model/format';
import type { CompiledNode } from '../model/types';
import { num, str } from './lib/config';
import { defineBehavior } from './types';

export const PARTITION_READ_UNITS = 3000;
export const PARTITION_WRITE_UNITS = 1000;
export const PARTITION_MAX_GB = 10;

export interface KvUnits {
  readUnits: number;
  writeUnits: number;
  partitions: number;
  fromStorage: number;
}

export function kvUnits(node: CompiledNode): KvUnits {
  const itemKb = Math.max(0.001, num(node, 'itemSizeKb') ?? 1);
  const mode = str(node, 'readConsistency') ?? 'eventual';
  const gsis = Math.max(0, Math.round(num(node, 'globalSecondaryIndexes') ?? 0));
  const txWrites = str(node, 'writeMode') === 'transactional';
  const readFactor = mode === 'strong' ? 1 : mode === 'transactional' ? 2 : 0.5;
  const fromStorage = Math.ceil(Math.max(0, num(node, 'storageGb') ?? 0) / PARTITION_MAX_GB);
  return {
    readUnits: Math.ceil(itemKb / 4) * readFactor,
    writeUnits: Math.ceil(itemKb) * (1 + gsis) * (txWrites ? 2 : 1),
    partitions: Math.max(1, node.scale.shards, fromStorage),
    fromStorage,
  };
}

export const behavior = defineBehavior({
  id: 'partitionedKv',
  tune(node) {
    const u = kvUnits(node);
    const c = node.serversPerInstance;
    const wait = { ...node.serviceTimeMs };
    if (str(node, 'readConsistency') === 'transactional') wait.read *= 2;
    if (str(node, 'writeMode') === 'transactional') wait.write *= 2;
    const skew =
      node.scale.hotShardShare > 1 / node.scale.shards + 1e-12 ? node.scale.hotShardShare : 0;
    return {
      // c × 1000 / S = budget ÷ units  ⇒  S = c × 1000 × units / budget
      serviceTimeMs: {
        read: (c * 1000 * u.readUnits) / PARTITION_READ_UNITS,
        write: (c * 1000 * u.writeUnits) / PARTITION_WRITE_UNITS,
      },
      responseServiceMs: wait,
      scale: {
        ...node.scale,
        shards: u.partitions,
        hotShardShare: Math.max(1 / u.partitions, skew),
      },
    };
  },
  finish({ node, stats }) {
    const u = kvUnits(node);
    const S = node.scale.shards;
    const hot = node.scale.hotShardShare;
    const readsHot = stats.rps.read * hot;
    const writesHot = stats.rps.write * hot;
    stats.explain.partitions =
      `${S} partition(s) = max(configured, ⌈storage/${PARTITION_MAX_GB} GB⌉ = ${u.fromStorage}). ` +
      `Each read costs ${fmt(u.readUnits)} read unit(s), each write ${fmt(u.writeUnits)} write unit(s) (item size, consistency, GSIs). ` +
      `Hottest partition (${pct(hot)} of traffic): ${fmt(readsHot * u.readUnits)} of ${PARTITION_READ_UNITS} RU/s and ` +
      `${fmt(writesHot * u.writeUnits)} of ${PARTITION_WRITE_UNITS} WU/s` +
      (readsHot * u.readUnits > PARTITION_READ_UNITS ||
      writesHot * u.writeUnits > PARTITION_WRITE_UNITS
        ? ' — over budget: requests are throttled (ProvisionedThroughputExceeded). Spread the key (write sharding) or cache hot items.'
        : '.') +
      (str(node, 'capacityMode') === 'on-demand'
        ? ' On-demand: no capacity planning, but per-partition limits still apply and a new table starts at about 4 000 WU/s and 12 000 RU/s before it adapts.'
        : ' Provisioned: you pay for the units you reserve whether used or not.');
  },
});
