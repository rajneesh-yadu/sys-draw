import { z } from 'zod';
import { defineComponent } from '../../define';
import { GENERAL_PURPOSE_INSTANCES, MEMORY_OPTIMISED_INSTANCES } from '../../presets';

export default defineComponent({
  id: 'database.elasticsearch',
  name: 'Elasticsearch / OpenSearch',
  category: 'database',
  tags: [
    'database',
    'search',
    'elasticsearch',
    'opensearch',
    'full-text',
    'inverted-index',
    'logs',
  ],
  icon: 'search',
  providerNames: {
    aws: 'OpenSearch Service',
    gcp: 'Elastic Cloud on Google Cloud',
    azure: 'Elastic Cloud on Azure',
  },
  ports: [{ id: 'in', direction: 'in', protocols: ['http1', 'http2', 'tls13'] }],
  configSchema: z.object({
    primaryShards: z
      .number()
      .int()
      .min(1)
      .max(1024)
      .describe(
        'Primary shards per index: every search runs on all of them (fixed at index creation)',
      ),
    replicasPerShard: z
      .number()
      .int()
      .min(0)
      .max(5)
      .describe('Copies of each shard: more search throughput and safety, more indexing work'),
    refreshIntervalSec: z
      .number()
      .min(0.1)
      .max(3600)
      .describe('How often new documents become searchable (near-real-time)')
      .meta({
        advanced: true,
      }),
    storageGb: z
      .number()
      .min(1)
      .max(1e7)
      .describe('Index size (one copy)')
      .meta({ scaling: 'storageGb' }),
    queryType: z
      .enum(['term', 'full-text', 'aggregation'])
      .describe('Typical query: exact term lookups, scored full-text search, or aggregations')
      .meta({
        perfEffect: {
          term: { read: 0.5, why: 'filter-only queries skip scoring and are cacheable' },
          aggregation: { read: 3, why: 'aggregations walk doc values for every matching document' },
        },
      }),
  }),
  defaults: {
    primaryShards: 3,
    replicasPerShard: 1,
    refreshIntervalSec: 1,
    storageGb: 300,
    queryType: 'full-text',
  },
  instanceTypes: [...MEMORY_OPTIMISED_INSTANCES, ...GENERAL_PURPOSE_INSTANCES],
  perf: {
    // per shard copy
    serviceTimeMs: { read: 5, write: 2 },
    maxConcurrencyPerInstance: 12,
    scaleCurve: 'linear',
    saturationBehavior: 'reject',
  },
  behaviors: ['scatterGather', 'configPerf'],
  docs: {
    summary:
      'A distributed search engine built on inverted indexes (Lucene): full-text search, filtering and aggregations over JSON documents in near real time.',
    howItWorks:
      'Each index is split into primary shards, each with replica copies on other data nodes. A document is routed to one shard by id, indexed on its primary and then on the replicas. A search is scatter-gather: the coordinating node sends it to one copy of every shard, each returns its top hits, and the coordinator merges them — so latency is set by the slowest shard and work grows with the shard count. New documents are visible after the next refresh (1 s by default), which is why search is "near real-time".',
    tradeoffs: [
      'Fast relevance-ranked text search and analytics, but it is not a primary database: no transactions, eventual visibility, and re-indexing is needed for mapping changes.',
      'More shards spread data but make every search fan out wider (tail latency); too many small shards waste heap.',
      'Replicas add read throughput and safety but multiply indexing work and storage.',
    ],
    interviewTips: [
      'Keep the source of truth in a database and stream changes (CDC → Kafka → indexer) into the search cluster.',
      'Size shards at 10–50 GB, and say how the search query fans out and what the tail latency looks like.',
      'Use it for search boxes, autocomplete, log analytics; not for counters or transactional data.',
    ],
  },
  security: {
    defaultPorts: [9200, 9300],
    threats: [
      'Clusters exposed without authentication leaking whole indexes',
      'Script injection through user-supplied queries',
    ],
    controls: [
      'Security plugin: TLS, users/roles, field- and document-level security',
      'Private network only; never pass raw user input as query DSL',
    ],
  },
});
