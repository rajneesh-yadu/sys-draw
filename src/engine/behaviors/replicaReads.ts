/**
 * replicaReads: whether a single-writer store's replicas serve reads (MongoDB readPreference,
 * Redis READONLY replicas). `config.readPreference === 'primary'` ⇒ all reads go to the primary;
 * the replicas still run (billed as standbys) for failover. Any other preference spreads reads
 * over primary + replicas — which may return stale data (replication lag).
 */
import { str } from './lib/config';
import { defineBehavior } from './types';

export const behavior = defineBehavior({
  id: 'replicaReads',
  tune(node) {
    if (str(node, 'readPreference') !== 'primary' || node.scale.readReplicas === 0)
      return undefined;
    return {
      scale: {
        ...node.scale,
        standby: node.scale.standby + node.scale.readReplicas,
        readReplicas: 0,
      },
    };
  },
  finish({ node, stats }) {
    const pref = str(node, 'readPreference');
    if (pref === undefined) return;
    stats.explain.readPreference =
      pref === 'primary'
        ? 'readPreference = primary: every read hits the primary (always current); replicas only stand by for failover, so they add cost but no read capacity.'
        : `readPreference = ${pref}: reads spread over the primary and its replicas (more read capacity), but a replica can return data that lags the primary.`;
  },
});
