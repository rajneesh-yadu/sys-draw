/**
 * metricsStore: a pull-based time-series database (Prometheus) with dashboards (Grafana) as its
 * readers. Scraping is off the request path, so it is sized from config rather than edges:
 *   ingest   = active series ÷ scrape interval            (samples/s)
 *   storage  = ingest × 1.5 B/sample × retention          (compressed TSDB blocks)
 *   memory   ≈ active series × 4 KB                       (head block, each HA replica)
 * Dashboard/alert queries arrive as reads on the node's edges.
 */
import { fmt } from '../model/format';
import type { CompiledNode } from '../model/types';
import { num } from './lib/config';
import { defineBehavior } from './types';

export const BYTES_PER_SAMPLE = 1.5;
export const HEAD_BYTES_PER_SERIES = 4096;

export function tsdbSizing(node: CompiledNode) {
  const series = Math.max(0, num(node, 'activeSeries') ?? 0);
  const interval = Math.max(1, num(node, 'scrapeIntervalSec') ?? 15);
  const days = Math.max(0, num(node, 'retentionDays') ?? 15);
  const samplesPerSec = series / interval;
  return {
    series,
    samplesPerSec,
    storageGb: (samplesPerSec * BYTES_PER_SAMPLE * days * 86_400) / 1e9,
    memoryGb: (series * HEAD_BYTES_PER_SERIES) / 2 ** 30,
  };
}

export const behavior = defineBehavior({
  id: 'metricsStore',
  tune(node) {
    return { scale: { ...node.scale, storageGb: tsdbSizing(node).storageGb } };
  },
  finish({ node, stats }) {
    const z = tsdbSizing(node);
    const mem = node.instanceType?.memGb ?? 0;
    stats.explain.tsdb =
      `Ingest = ${fmt(z.series)} series ÷ ${fmt(num(node, 'scrapeIntervalSec') ?? 15)} s = ${fmt(z.samplesPerSec)} samples/s. ` +
      `Storage ≈ ${fmt(z.samplesPerSec)} × ${BYTES_PER_SAMPLE} B × ${fmt(num(node, 'retentionDays') ?? 15)} d = ${fmt(z.storageGb)} GB per replica. ` +
      `Head memory ≈ series × 4 KB = ${fmt(z.memoryGb)} GB of ${fmt(mem)} GB` +
      (z.memoryGb > mem * 0.8
        ? ' — too close to the instance memory: Prometheus will OOM. Cut label cardinality, shard by target (or federate), or use remote write to a scalable store (Thanos, Mimir, managed Prometheus).'
        : '.') +
      ` Every HA replica scrapes everything, so replicas add availability, not capacity.`;
  },
});
