/**
 * queue: producers wait only for the enqueue (the queue node's own latency); consumers behind
 * the queue run asynchronously, off the caller's critical path, but still receive the load.
 *
 * Work queue (RabbitMQ, SQS — no `partitions` in config): connected consumers compete for
 * messages, so they drain together:  lag = (λ − Σ consumer capacity) × duration.
 *
 * Partitioned log (Kafka — `config.partitions` set, S13): every connected consumer node is its
 * own CONSUMER GROUP and reads every event. Within a group a partition goes to one consumer
 * instance, so only min(instances, P) consumers work:
 *   drain_g = capacity_g × min(1, P / instances_g)
 *   the hottest partition (share max(1/P, keySkew)) must fit ONE consumer instance:
 *   drain_g ≤ capacity_per_instance ÷ hot share
 *   lag_g = max(0, λ − drain_g) × D messages;  time behind = lag_g ÷ drain_g
 * Replication (log only): followers copy every write, so broker work per write = S_w × RF
 * (`replicationFactor`); the producer's wait is set by `acks` (configPerf).
 * Retention: retained GB per copy = write rate × message size × retention hours × 3600.
 */
import { asyncExpr, isEmpty } from '../model/expr';
import { fmt, pct } from '../model/format';
import type { NodeStats } from '../model/types';
import { num } from './lib/config';
import { defineBehavior } from './types';

export interface GroupLag {
  nodeId: string;
  drainRps: number;
  backlog: number;
  /** Consumer instances that get no partition. */
  idle: number;
  hotLimited: boolean;
}

/** Per-consumer-group drain and backlog of a partitioned log. */
export function groupLag(
  consumer: NodeStats,
  inRps: number,
  partitions: number,
  hotShare: number,
  durationSec: number,
): GroupLag {
  const inst = Math.max(1, consumer.replicas);
  const P = Math.max(1, partitions);
  const active = Math.min(inst, P);
  const byPartitions = consumer.capacityRps * (active / inst);
  const perInstance = consumer.capacityRps / inst;
  const byHot = hotShare > 0 ? perInstance / hotShare : Infinity;
  const drain = Math.min(byPartitions, byHot);
  return {
    nodeId: consumer.node.id,
    drainRps: drain,
    backlog: Math.max(0, inRps - drain) * durationSec,
    idle: inst - active,
    hotLimited: byHot < byPartitions,
  };
}

export const behavior = defineBehavior({
  id: 'queue',
  tune(node) {
    const rf = num(node, 'replicationFactor');
    if (num(node, 'partitions') === undefined || rf === undefined || rf <= 1) return undefined;
    const s = node.serviceTimeMs;
    return {
      serviceTimeMs: { read: s.read, write: s.write * rf },
      responseServiceMs: { read: s.read, write: s.write },
    };
  },
  routeOut({ calls, combine }) {
    if (calls.length === 0) return undefined;
    return asyncExpr(combine(calls));
  },
  routeRest({ rest }) {
    return isEmpty(rest) ? undefined : asyncExpr(rest);
  },
  finish({ node, stats, model, statsOf, durationSec }) {
    const consumers = (model.out.get(node.id) ?? [])
      .map((e) => statsOf(e.target))
      .filter((s) => s !== undefined);
    const partitions = num(node, 'partitions');
    const msgBytes = num(node, 'messageBytes');
    const retention = num(node, 'retentionHours');
    if (partitions !== undefined && msgBytes !== undefined && retention !== undefined) {
      const gb = (stats.rps.write * msgBytes * retention * 3600) / 1e9;
      const disk = num(node, 'storageGb');
      stats.explain.retention =
        `Retained per copy = ${fmt(stats.rps.write)} msg/s × ${fmt(msgBytes)} B × ${fmt(retention)} h × 3600 = ${fmt(gb)} GB` +
        (disk !== undefined && gb > disk
          ? ` > ${fmt(disk)} GB provisioned: brokers run out of disk — add storage, shorten retention or compress.`
          : disk !== undefined
            ? ` (≤ ${fmt(disk)} GB provisioned).`
            : '.');
    }
    if (consumers.length === 0) {
      stats.explain.lag = 'No consumers connected: messages accumulate.';
      stats.queueDepth += stats.servedRps * durationSec;
      return;
    }
    if (partitions === undefined) {
      const drain = consumers.reduce((s, c) => s + c.capacityRps, 0);
      const backlog = Math.max(0, stats.servedRps - drain) * durationSec;
      stats.queueDepth += backlog;
      stats.explain.lag =
        backlog > 0
          ? `Consumers drain ${fmt(drain)} rps < ${fmt(stats.servedRps)} rps in: backlog = (λ − drain) × D = ${fmt(backlog)} messages after ${fmt(durationSec)} s (≈ ${fmt(backlog / drain)} s behind).`
          : `Consumers can drain ${fmt(drain)} rps ≥ ${fmt(stats.servedRps)} rps in: no backlog.`;
      return;
    }
    const hot = Math.max(1 / Math.max(1, partitions), Math.min(1, num(node, 'keySkew') ?? 0));
    const lags = consumers.map((c) => groupLag(c, stats.servedRps, partitions, hot, durationSec));
    const worst = lags.reduce((a, b) => (b.backlog > a.backlog ? b : a));
    stats.queueDepth += worst.backlog;
    const label = (id: string) => model.nodes.get(id)?.label ?? id;
    stats.explain.lag =
      `${lags.length} consumer group(s), each reads all ${fmt(stats.servedRps)} msg/s over ${fmt(partitions)} partitions (hottest ${pct(hot)}). ` +
      lags
        .map(
          (g) =>
            `${label(g.nodeId)}: drains ${fmt(g.drainRps)} msg/s` +
            (g.backlog > 0
              ? `, lag ${fmt(g.backlog)} msg (≈ ${fmt(g.backlog / g.drainRps)} s behind)`
              : ', no lag') +
            (g.idle > 0 ? `; ${g.idle} consumer(s) idle (more consumers than partitions)` : '') +
            (g.hotLimited ? '; capped by the hottest partition on one consumer' : ''),
        )
        .join('. ') +
      '.';
  },
});
