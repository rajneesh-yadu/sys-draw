/**
 * consensus: a leader-based replicated log (Raft in etcd, ZAB in ZooKeeper). `members` servers
 * (odd: 3, 5, 7); one leader orders every write and commits it once a MAJORITY has it on disk:
 *   wait for write = S_w (leader append + fsync) + k-th fastest of the n − 1 followers,
 *                    k = ⌊n/2⌋ follower acks (with the leader that is a majority)
 * Writes never scale with members (one leader); each extra member slows the commit slightly.
 * Reads: `readMode: local` — any member answers (ZooKeeper default, may be stale; reads scale);
 * `linearizable` — the leader confirms it is still leader with a majority first (etcd default).
 * Fault tolerance: ⌊(n − 1)/2⌋ members may fail.
 */
import { fmt } from '../model/format';
import type { CompiledNode } from '../model/types';
import { num, str } from './lib/config';
import { kthOfN } from './lib/order-stats';
import { defineBehavior } from './types';

export function membersOf(node: CompiledNode): number {
  return Math.max(1, Math.round(num(node, 'members') ?? 3));
}

/** Expected commit wait multiplier on S_w: 1 (leader) + k-th fastest of n − 1 followers. */
export function commitFactor(members: number): number {
  const followers = members - 1;
  const k = Math.floor(members / 2);
  return 1 + (followers > 0 ? kthOfN(k, followers) : 0);
}

export const behavior = defineBehavior({
  id: 'consensus',
  tune(node) {
    const n = membersOf(node);
    const local = str(node, 'readMode') !== 'linearizable';
    const s = node.serviceTimeMs;
    const confirm = commitFactor(n) - 1; // a heartbeat round to a majority
    return {
      responseServiceMs: {
        read: local ? s.read : s.read * (1 + confirm),
        write: s.write * commitFactor(n),
      },
      scale: { ...node.scale, readReplicas: local ? n - 1 : 0, standby: local ? 0 : n - 1 },
    };
  },
  finish({ node, stats }) {
    const n = membersOf(node);
    const k = Math.floor(n / 2);
    const local = str(node, 'readMode') !== 'linearizable';
    const Sw = node.serviceTimeMs.write;
    stats.explain.consensus =
      `${n} members, majority ${k + 1}, tolerates ${Math.floor((n - 1) / 2)} failure(s)${n % 2 === 0 ? ' — an even ensemble tolerates no more failures than one member fewer' : ''}. ` +
      `Commit wait = S_w × (1 + ${k}-th fastest of ${n - 1} followers) = ${fmt(Sw)} × ${fmt(commitFactor(n))} = ${fmt(Sw * commitFactor(n))} ms. ` +
      `Every write goes through the one leader, so adding members never adds write capacity. ` +
      (local
        ? `Local reads: all ${n} members serve reads (may lag the leader slightly; use sync() before a read that must be current).`
        : `Linearizable reads go to the leader, which first confirms leadership with a majority (ReadIndex).`);
  },
});
