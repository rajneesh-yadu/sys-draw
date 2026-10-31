/**
 * loadBalancer: a request goes to ONE target. Round-robin, least-connections, random and
 * consistent-hash all spread load evenly across instances in the analytical model, so each
 * target gets a share proportional to its replica count. (Hash imbalance: S09.)
 */
import { choice } from '../model/expr';
import { defineBehavior } from './types';

export const behavior = defineBehavior({
  id: 'loadBalancer',
  routeOut({ calls, combine }) {
    if (calls.length <= 1) return undefined;
    const total = calls.reduce((s, c) => s + c.target.replicas, 0);
    return choice(calls.map((c) => ({ p: c.target.replicas / total, expr: combine([c]) })));
  },
});
