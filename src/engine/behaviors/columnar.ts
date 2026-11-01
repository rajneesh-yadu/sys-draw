/**
 * columnar: an OLAP column store (ClickHouse). A query reads only the columns it needs and uses
 * every core of the instance, so one instance runs about one heavy query at a time:
 *   query work = S_r + rows × columns ÷ (50 000 values/ms per vCPU × baseline vCPU × speedup)
 * Inserts write one immutable "part" each; background merges combine parts:
 *   insert work = S_w + rows per insert ÷ 200 000 rows/ms
 * Many small inserts (> 1 insert/s per table) create parts faster than merges can absorb them
 * ("too many parts"): batch inserts or use async inserts.
 */
import { fmt } from '../model/format';
import type { CompiledNode } from '../model/types';
import { num } from './lib/config';
import { defineBehavior } from './types';

export const SCAN_VALUES_PER_MS_PER_VCPU = 50_000;
export const INSERT_ROWS_PER_MS = 200_000;
export const MAX_INSERTS_PER_SEC = 1;

export function scanWorkMs(node: CompiledNode): number {
  const rows = Math.max(0, num(node, 'rowsScannedPerQuery') ?? 0);
  const cols = Math.max(1, num(node, 'columnsRead') ?? 1);
  const vcpu = node.def?.instanceTypes[0]?.vCpu ?? 1;
  return (rows * cols) / (SCAN_VALUES_PER_MS_PER_VCPU * vcpu * node.scale.speedup);
}

export function insertWorkMs(node: CompiledNode): number {
  return Math.max(0, num(node, 'rowsPerInsert') ?? 0) / INSERT_ROWS_PER_MS;
}

export const behavior = defineBehavior({
  id: 'columnar',
  tune(node) {
    const s = node.serviceTimeMs;
    const work = { read: s.read + scanWorkMs(node), write: s.write + insertWorkMs(node) };
    return { serviceTimeMs: work, responseServiceMs: work };
  },
  finish({ node, stats }) {
    const rows = num(node, 'rowsScannedPerQuery') ?? 0;
    const cols = num(node, 'columnsRead') ?? 1;
    const batch = num(node, 'rowsPerInsert') ?? 0;
    stats.explain.scan =
      `Each query scans ${fmt(rows)} rows × ${fmt(cols)} column(s) = ${fmt(rows * cols)} values ⇒ +${fmt(scanWorkMs(node))} ms using all cores ` +
      `(${fmt(SCAN_VALUES_PER_MS_PER_VCPU)} values/ms per vCPU). Only the columns read cost anything — the column-store win over row stores.`;
    const insertsPerSec = stats.rps.write / Math.max(1, stats.replicas);
    stats.explain.inserts =
      `${fmt(stats.rps.write)} inserts/s of ${fmt(batch)} rows (${fmt(stats.rps.write * batch)} rows/s). ` +
      (insertsPerSec > MAX_INSERTS_PER_SEC
        ? `${fmt(insertsPerSec)} inserts/s per server > ${MAX_INSERTS_PER_SEC}: each insert creates a part and merges fall behind ("too many parts"). Batch ≥ 10 000 rows per insert, buffer through Kafka, or enable async inserts.`
        : 'Insert rate is within what background merges absorb.');
  },
});
