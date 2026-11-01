/**
 * S19 design review: spiky traffic (peak multiplier ≥ 3 or a traffic-spike event) writes straight
 * into a database through synchronous calls, with no queue to absorb the burst. Needs the
 * scenario. No automatic fix: a queue changes the API contract (accepted-not-done) and needs a
 * worker, which the user should design.
 */
import type { Finding } from '@/core';
import { defineRule } from '../define';
import {
  defOf,
  edgeName,
  incoming,
  isComputeDef,
  isDatabaseDef,
  isMessagingDef,
  nodeMap,
  round,
  writeShare,
} from '../design-tools';

const ID = 'rule.no-queue-spiky-writes';
const SPIKY_PEAK = 3;
const SPIKY_EVENT = 2;
const WRITE_HEAVY = 0.3;

export default defineRule({
  id: ID,
  title: 'Spiky writes without a queue',
  category: 'scalability',
  severity: 'warning',
  tags: ['queue', 'buffering', 'load-leveling', 'writes', 'spikes'],
  appliesTo: { categories: ['database'], needs: ['scenario'] },
  check: (ctx) => {
    const s = ctx.scenario;
    if (!s) return [];
    const spike = Math.max(
      s.peakMultiplier,
      ...s.events.map((ev) => (ev.kind === 'trafficSpike' ? ev.multiplier : 1)),
    );
    const spiky =
      s.peakMultiplier >= SPIKY_PEAK ||
      s.events.some((ev) => ev.kind === 'trafficSpike' && ev.multiplier >= SPIKY_EVENT);
    if (!spiky) return [];
    const byId = nodeMap(ctx.graph);
    const out: Finding[] = [];
    for (const n of ctx.graph.nodes) {
      if (!isDatabaseDef(defOf(ctx, n))) continue;
      const ws = writeShare(ctx, n.id);
      if (ws === undefined || ws < WRITE_HEAVY) continue;
      const direct = incoming(ctx.graph, n.id).filter((e) => {
        if (!e.sync) return false;
        const caller = byId.get(e.source);
        if (!isComputeDef(defOf(ctx, caller))) return false;
        // A worker fed by a queue is already buffered.
        return !incoming(ctx.graph, e.source).some((f) =>
          isMessagingDef(defOf(ctx, byId.get(f.source))),
        );
      });
      if (direct.length === 0) continue;
      out.push({
        ruleId: ID,
        severity: 'warning',
        title: `Write bursts hit "${n.label}" directly`,
        message: `Traffic peaks at ${round(spike, 1)}× the average and ${round(ws * 100)} % of the steps on "${n.label}" are writes, sent synchronously by ${direct.map((e) => edgeName(byId, e)).join(', ')}. The database must be sized for the peak, or writes time out and fail during the burst.`,
        targetIds: [n.id, ...direct.map((e) => e.id)],
        fix: 'Put a queue (or log) between the API and the database: accept the write, enqueue it, and let workers drain it at a rate the database sustains.',
      });
    }
    return out;
  },
  docs: {
    summary: 'Flags write-heavy databases that take traffic bursts synchronously, with no queue.',
    why: 'A queue turns a spike into a backlog: producers stay fast, workers write at a steady rate, and the database is sized for the average instead of the peak (queue-based load leveling).',
    howToFix:
      'Enqueue writes that the user does not need confirmed immediately (orders accepted, notifications, analytics events), process them with idempotent workers, add a dead-letter queue and alert on backlog age.',
  },
});
