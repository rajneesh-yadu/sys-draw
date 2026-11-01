/**
 * scatterGather: a search cluster (Elasticsearch / OpenSearch). An index has P primary shards
 * with `replicasPerShard` copies each, spread over the node's instances (data nodes).
 *   search work  = P × S_r          (one copy of EVERY shard runs the query)
 *   search wait  = S_r × H_P        (the coordinator waits for the slowest shard, H_P = Σ 1/i)
 *   index work   = (1 + replicas) × S_w (every copy indexes the document)
 *   index wait   = S_w + S_w × H_replicas (primary, then replicas in parallel)
 * New documents become searchable after the next refresh (on average refresh/2).
 */
import { fmt } from '../model/format';
import type { CompiledNode } from '../model/types';
import { num } from './lib/config';
import { maxOfN } from './lib/order-stats';
import { defineBehavior } from './types';

export function shardLayout(node: CompiledNode) {
  return {
    primaries: Math.max(1, Math.round(num(node, 'primaryShards') ?? 1)),
    replicas: Math.max(0, Math.round(num(node, 'replicasPerShard') ?? 0)),
  };
}

export const behavior = defineBehavior({
  id: 'scatterGather',
  tune(node) {
    const { primaries, replicas } = shardLayout(node);
    const s = node.serviceTimeMs;
    return {
      serviceTimeMs: { read: s.read * primaries, write: s.write * (1 + replicas) },
      responseServiceMs: {
        read: maxOfN(primaries, s.read),
        write: s.write + (replicas > 0 ? maxOfN(replicas, s.write) : 0),
      },
      scale: { ...node.scale, storageCopies: 1 + replicas },
    };
  },
  finish({ node, stats }) {
    const { primaries, replicas } = shardLayout(node);
    const Sr = node.serviceTimeMs.read / primaries;
    const copies = primaries * (1 + replicas);
    const refresh = num(node, 'refreshIntervalSec') ?? 1;
    stats.explain.shards =
      `${primaries} primary shard(s) × ${1 + replicas} copies = ${copies} shard copies on ${stats.replicas} data node(s). ` +
      `A search fans out to all ${primaries} shards: work = ${primaries} × ${fmt(Sr)} ms, wait = slowest shard = ${fmt(Sr)} × H_${primaries} = ${fmt(maxOfN(primaries, Sr))} ms. ` +
      `Each document is indexed on ${1 + replicas} copies. Searchable after the next refresh (every ${fmt(refresh)} s, ~${fmt(refresh / 2)} s on average).` +
      (copies > stats.replicas * 20
        ? ' Over-sharded: many small shards per node waste heap and slow searches; aim for 10–50 GB per shard.'
        : '') +
      (replicas + 1 > stats.replicas
        ? ` Only ${stats.replicas} node(s): replica copies cannot be placed on distinct nodes (cluster yellow).`
        : '');
  },
});
