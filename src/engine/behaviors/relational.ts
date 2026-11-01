/**
 * relational: a single-primary SQL database (PostgreSQL, MySQL).
 * - Reads: with an index the lookup walks a B-tree of depth ⌈log_300(rows)⌉ pages — the measured
 *   S_r already covers that; WITHOUT an index the query scans the table:
 *     S_r' = S_r + rows ÷ (5 000 rows/ms × vertical speedup)    (≈ 5 M rows/s per scan)
 * - Writes: every secondary index is one more B-tree insert + WAL record, ≈ +30 % of a base write
 *   each (approximation): S_w' = S_w × (1 + 0.3 × indexes).
 * - Replication: `async` replicas lag; `sync` commits wait for one standby to flush its WAL:
 *   wait_w' = S_w' + 1 ms RTT + S_w (no extra work on the primary).
 */
import { fmt } from '../model/format';
import type { CompiledNode } from '../model/types';
import { bool, num, str } from './lib/config';
import { defineBehavior } from './types';

export const SEQ_SCAN_ROWS_PER_MS = 5000;
export const INDEX_WRITE_COST = 0.3;
export const BTREE_FANOUT = 300;
export const SYNC_REPLICA_RTT_MS = 1;

export function btreeDepth(rows: number): number {
  return Math.max(1, Math.ceil(Math.log(Math.max(2, rows)) / Math.log(BTREE_FANOUT)));
}

export function scanMs(node: CompiledNode): number {
  const rows = Math.max(0, num(node, 'tableRows') ?? 0);
  return rows / (SEQ_SCAN_ROWS_PER_MS * node.scale.speedup);
}

export const behavior = defineBehavior({
  id: 'relational',
  tune(node) {
    const s = node.serviceTimeMs;
    const indexed = bool(node, 'queryUsesIndex') !== false;
    const idx = Math.max(0, Math.round(num(node, 'secondaryIndexes') ?? 0));
    const read = indexed ? s.read : s.read + scanMs(node);
    const write = s.write * (1 + INDEX_WRITE_COST * idx);
    const sync = str(node, 'replication') === 'sync';
    return {
      serviceTimeMs: { read, write },
      responseServiceMs: { read, write: sync ? write + SYNC_REPLICA_RTT_MS + s.write : write },
    };
  },
  finish({ node, stats }) {
    const rows = Math.max(0, num(node, 'tableRows') ?? 0);
    const indexed = bool(node, 'queryUsesIndex') !== false;
    const idx = Math.max(0, Math.round(num(node, 'secondaryIndexes') ?? 0));
    stats.explain.indexes =
      (indexed
        ? `Reads use an index: B-tree depth ⌈log_${BTREE_FANOUT}(${fmt(rows)})⌉ = ${btreeDepth(rows)} pages, cost grows with log(rows).`
        : `No index for this query: every read scans ${fmt(rows)} rows ⇒ +${fmt(scanMs(node))} ms of work per read (rows ÷ ${SEQ_SCAN_ROWS_PER_MS} rows/ms). Add an index on the WHERE/JOIN columns.`) +
      ` ${idx} secondary index(es): writes × (1 + ${INDEX_WRITE_COST} × ${idx}) = ${fmt(1 + INDEX_WRITE_COST * idx)}.`;
    stats.explain.replication =
      str(node, 'replication') === 'sync'
        ? `Synchronous replication: a commit waits for a standby to flush its WAL (+${SYNC_REPLICA_RTT_MS} ms RTT + one WAL write); no data loss on failover.`
        : `Asynchronous replication: commits do not wait; replicas lag by about a WAL write plus the network RTT, so a read from a replica may be stale and a failover can lose the last commits.`;
  },
});
