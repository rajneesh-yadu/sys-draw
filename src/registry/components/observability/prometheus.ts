import { z } from 'zod';
import { defineComponent } from '../../define';
import { MEMORY_OPTIMISED_INSTANCES, GENERAL_PURPOSE_INSTANCES } from '../../presets';

export default defineComponent({
  id: 'observability.prometheus',
  name: 'Prometheus + Grafana',
  category: 'observability',
  tags: ['observability', 'monitoring', 'metrics', 'prometheus', 'grafana', 'alerting', 'tsdb'],
  icon: 'activity',
  providerNames: {
    aws: 'Amazon Managed Service for Prometheus',
    gcp: 'Managed Service for Prometheus',
    azure: 'Azure Monitor managed service for Prometheus',
  },
  ports: [
    { id: 'queries', direction: 'in', protocols: ['http1', 'http2'] },
    { id: 'scrape', direction: 'out', protocols: ['http1'] },
  ],
  configSchema: z.object({
    activeSeries: z
      .number()
      .int()
      .min(1)
      .max(1e9)
      .describe('Distinct time series (metric × label combinations) currently scraped'),
    scrapeIntervalSec: z
      .number()
      .int()
      .min(1)
      .max(600)
      .describe('How often every target is scraped'),
    retentionDays: z.number().int().min(1).max(3650).describe('How long samples are kept locally'),
    dashboards: z
      .number()
      .int()
      .min(0)
      .max(10_000)
      .describe('Grafana dashboards (each panel is a PromQL query on refresh)')
      .meta({ advanced: true }),
  }),
  defaults: { activeSeries: 1_000_000, scrapeIntervalSec: 15, retentionDays: 15, dashboards: 20 },
  instanceTypes: [...MEMORY_OPTIMISED_INSTANCES, ...GENERAL_PURPOSE_INSTANCES],
  perf: {
    // one PromQL query from a dashboard panel or an alert rule
    serviceTimeMs: { read: 50, write: 1 },
    maxConcurrencyPerInstance: 8,
    scaleCurve: 'sublinear',
    saturationBehavior: 'queue',
  },
  behaviors: ['metricsStore'],
  docs: {
    summary:
      "Pull-based metrics: Prometheus scrapes every service's /metrics endpoint into a time-series database and evaluates alert rules; Grafana draws dashboards from PromQL queries.",
    howItWorks:
      "Every scrape interval Prometheus fetches each target's current counters, gauges and histograms; each metric name + label set is one time series. Recent samples live in an in-memory head block (memory ∝ active series), and are compacted into ~1.5 bytes/sample blocks on disk. Alert rules run continuously and fire to Alertmanager. Grafana dashboards and alerts are reads (PromQL) — connect them as edges into this node. One Prometheus is a single machine; HA runs two identical ones, and long-term or global views use remote write to Thanos/Mimir or a managed service.",
    tradeoffs: [
      'Simple, reliable, and the standard for Kubernetes — but a single node: cardinality (labels like user_id) explodes memory.',
      'Pull model finds dead targets easily, but short-lived jobs need a push gateway.',
      'Local retention is short; long-term storage needs remote write and costs per series.',
    ],
    interviewTips: [
      'Name the golden signals you will alert on: latency, traffic, errors, saturation (and consumer lag for queues).',
      'Keep label cardinality bounded: never label by user or request id.',
      'Alert on symptoms (SLO burn rate), not every cause; dashboards for diagnosis.',
    ],
  },
  security: {
    defaultPorts: [9090, 3000, 9093],
    threats: [
      'Unauthenticated Prometheus/Grafana exposing internal topology and data',
      'Metrics labels leaking personal data',
    ],
    controls: [
      'SSO for Grafana; auth proxy in front of Prometheus; private network',
      'Review labels for PII; TLS on scrape endpoints',
    ],
  },
});
