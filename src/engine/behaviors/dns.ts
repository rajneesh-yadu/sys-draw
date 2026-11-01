/**
 * dns (S10 geo-DNS): anycast resolvers sit at the edge next to users. A client that queries this
 * DNS and can reach entry points in several regions picks one per its `routingPolicy`:
 * latency / geo → nearest healthy region; failover → the first healthy region (edge order);
 * weighted / simple → spread evenly over healthy regions.
 */
import { defineBehavior, type GeoPolicy } from './types';

const POLICIES: readonly GeoPolicy[] = ['latency', 'geo', 'failover', 'weighted', 'simple'];

export const behavior = defineBehavior({
  id: 'dns',
  placement: 'edge',
  dnsPolicy(node) {
    const p = node.config.routingPolicy;
    return typeof p === 'string' && (POLICIES as readonly string[]).includes(p)
      ? (p as GeoPolicy)
      : 'latency';
  },
});
