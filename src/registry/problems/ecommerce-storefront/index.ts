/**
 * Sample reference board (S22): an e-commerce storefront with checkout, built from the broadest
 * useful set of registry components. Shipped as a problem entry so it is discoverable in the
 * Problems browser (tag `sample`) and loads onto a board with its scenario ("Start problem" →
 * "Reference"). Companion notes: ./NOTES.md.
 *
 * Layout, left to right, one column band per zone so group boxes never overlap: users → global
 * edge (CDN, DDoS shield, DNS) → DMZ (WAF, API gateway, bastion) → private services (mesh,
 * storefront, checkout, auth, control plane) → data subnet → async workers → DR region. CDN and
 * the image bucket sit on the top row, above the VPC.
 */
import { defineProblem } from '../../define';
import { company, design, scenario, STACK, TB } from '../kit';

const reference = design()
  // ---- groups: one primary region with zoned subnets, plus a DR region for order data
  .group('use1', 'region', 'US East (primary)', { regionId: 'us-east' })
  .group('vpc', 'vpc', 'Shop VPC', { parent: 'use1' })
  .group('dmz', 'subnet', 'DMZ (edge services)', { parent: 'vpc', zone: 'dmz' })
  .group('app', 'subnet', 'Private subnet (services)', { parent: 'vpc', zone: 'private' })
  .group('data', 'subnet', 'Data subnet', { parent: 'vpc', zone: 'data' })
  .group('async', 'subnet', 'Private subnet (async workers)', { parent: 'vpc', zone: 'private' })
  .group('usw2', 'region', 'US West (DR)', { regionId: 'us-west-2' })
  .group('drdata', 'subnet', 'DR data subnet', { parent: 'usw2', zone: 'data' })

  // ---- users and the global edge (outside any VPC)
  .node('client', 'client.app', 'Shoppers (web & mobile)', [0, 3], { type: 'browser' })
  .node('dns', 'network.dns', 'Geo DNS (health-checked)', [1, 5], {
    type: 'managed',
    config: { ttlSec: 60, routingPolicy: 'latency', healthChecks: true, anycast: true },
  })
  .node('cdn', 'network.cdn', 'CDN (images, JS, CSS)', [1, 0], {
    type: 'managed',
    config: { ttlSec: 2_592_000, originShield: true, edgeCacheGb: 2_000, compression: true },
  })
  .node('shield', 'security.ddos-shield', 'DDoS shield (anycast)', [1, 3], { type: 'managed' })

  // ---- DMZ: request filtering, auth and routing
  .node('waf', 'security.waf', 'WAF (bot control)', [2, 3], {
    type: 'managed',
    group: 'dmz',
    config: { mode: 'block', managedRules: true, botControl: true, rateLimitPer5Min: 2_000 },
  })
  .node('gw', 'network.api-gateway', 'API gateway (JWT, rate limits)', [3, 3], {
    type: 'managed',
    group: 'dmz',
    config: { authMode: 'jwt', rateLimitRps: 150_000, burst: 300_000, timeoutMs: 10_000 },
  })
  .node('bastion', 'security.bastion', 'Ops access (VPN + bastion)', [3, 6], {
    type: 'small',
    group: 'dmz',
  })

  // ---- private services
  .node('mesh', 'network.service-mesh', 'Service mesh ingress (mTLS)', [4, 3], {
    type: 'medium',
    replicas: 3,
    group: 'app',
  })
  .node('auth', 'security.auth-server', 'Auth server (OIDC, MFA)', [4, 5], {
    type: 'large',
    replicas: 4,
    group: 'app',
    config: { mfa: 'required' },
  })
  .node('store', 'compute.kubernetes', 'Storefront API (catalog, search, cart)', [5, 2], {
    type: 'xlarge',
    replicas: 16,
    group: 'app',
    autoscale: { min: 6, max: 24, targetUtil: 0.6, warmupSec: 90 },
  })
  .node('checkout', 'compute.kubernetes', 'Checkout & orders service', [5, 4], {
    type: 'large',
    replicas: 6,
    group: 'app',
    autoscale: { min: 3, max: 12, targetUtil: 0.6, warmupSec: 90 },
  })
  .node('metrics', 'observability.prometheus', 'Metrics & alerts (Prometheus)', [4, 1], {
    type: 'mem-large',
    group: 'app',
    config: { activeSeries: 2_000_000, scrapeIntervalSec: 15, retentionDays: 15 },
  })
  .node('secrets', 'security.secrets-manager', 'Secrets manager', [5, 6], {
    type: 'managed',
    group: 'app',
  })
  .node('kms', 'security.kms', 'KMS (PII data keys)', [5, 5], { type: 'managed', group: 'app' })
  .node('iam', 'security.iam', 'IAM (workload roles)', [4, 6], { type: 'managed', group: 'app' })

  // ---- data tier
  .node('cache', 'cache.redis', 'Catalog cache (Redis)', [6, 1], {
    type: 'mem-large',
    group: 'data',
    config: {
      shards: 4,
      replicasPerShard: 1,
      readPreference: 'replicas',
      keyCount: 60_000_000,
      avgItemBytes: 4_000,
      ttlSec: 600,
    },
  })
  .node('search', 'database.elasticsearch', 'Product search (Elasticsearch)', [6, 2], {
    type: 'mem-xlarge',
    replicas: 12,
    group: 'data',
    config: { primaryShards: 6, replicasPerShard: 1, storageGb: 500, queryType: 'full-text' },
  })
  .node('carts', 'database.kv-store', 'Carts (key-value)', [6, 3], {
    type: 'managed',
    group: 'data',
    config: { capacityMode: 'on-demand', itemSizeKb: 4, partitions: 96, storageGb: 200 },
  })
  .node('orders', 'database.postgres', 'Orders, catalog & idempotency keys (Postgres HA)', [6, 4], {
    type: 'xlarge',
    group: 'data',
    config: {
      readReplicas: 3,
      replication: 'sync',
      highAvailability: true,
      tableRows: 2_000_000_000,
      storageGb: 4_000,
      connectionPooling: true,
    },
  })
  .node('images', 'storage.object', 'Product images (object store)', [2, 0], {
    type: 'managed',
    group: 'use1',
    config: { storageGb: 50_000, versioning: true },
  })

  // ---- asynchronous pipeline
  .node('stream', 'messaging.stream', 'Order & click events (Kafka)', [8, 4], {
    type: 'large',
    replicas: 3,
    group: 'async',
    config: { partitions: 12, replicationFactor: 3, consumerGroups: 1, retentionHours: 72 },
  })
  .node('workers', 'compute.kubernetes', 'Event workers (index, analytics, DR)', [9, 4], {
    type: 'large',
    replicas: 4,
    group: 'async',
    autoscale: { min: 2, max: 8, targetUtil: 0.6, warmupSec: 60 },
  })
  .node('analytics', 'database.clickhouse', 'Sales & clickstream analytics (ClickHouse)', [7, 1], {
    type: 'mem-large',
    replicas: 3,
    group: 'data',
    config: { rowsPerInsert: 50_000, storageGb: 20_000, replication: 2 },
  })
  .node('emailq', 'messaging.queue', 'Email jobs (queue + DLQ)', [9, 5], {
    type: 'managed',
    group: 'async',
    config: { delivery: 'at-least-once', maxReceiveCount: 5 },
  })
  .node('mailer', 'compute.serverless-function', 'Order emails (serverless)', [10, 5], {
    type: '512mb',
    group: 'async',
    config: { concurrencyLimit: 500 },
  })
  .node('dr', 'database.postgres', 'Orders DR copy (US West)', [12, 4], {
    type: 'large',
    group: 'drdata',
    config: { highAvailability: true, tableRows: 2_000_000_000, storageGb: 4_000 },
  })

  // ---- request paths
  .edge('client', 'dns', ['tcp', 'tls13', 'dns'])
  .edge('client', 'cdn', STACK.http3)
  .edge('cdn', 'images', STACK.internal)
  .edge('client', 'shield', STACK.https)
  .edge('shield', 'waf', STACK.internal)
  .edge('waf', 'gw', STACK.internal)
  .edge('gw', 'mesh', STACK.svc, { config: { timeoutMs: 5_000 } })
  .edge('gw', 'auth', STACK.internal, { config: { timeoutMs: 2_000 } })
  .edge('mesh', 'store', STACK.svc)
  .edge('mesh', 'checkout', STACK.svc)
  .edge('store', 'cache', STACK.redis, { config: { timeoutMs: 50 } })
  .edge('store', 'search', STACK.internal, { config: { timeoutMs: 500 } })
  .edge('store', 'carts', STACK.internal, { config: { timeoutMs: 200 } })
  .edge('store', 'orders', STACK.postgres, { config: { timeoutMs: 1_000, poolSize: 20 } })
  .edge('store', 'stream', STACK.kafka)
  .edge('checkout', 'carts', STACK.internal, { config: { timeoutMs: 200 } })
  .edge('checkout', 'orders', STACK.postgres, { config: { timeoutMs: 2_000, poolSize: 20 } })
  .edge('checkout', 'stream', STACK.kafka)
  .edge('auth', 'orders', STACK.postgres, { config: { timeoutMs: 1_000, poolSize: 10 } })
  // ---- async / background
  .edge('stream', 'workers', STACK.internal, { async: true })
  .edge('workers', 'analytics', STACK.http1, { async: true })
  .edge('workers', 'search', STACK.internal)
  .edge('workers', 'emailq', STACK.internal)
  .edge('workers', 'dr', STACK.postgres, { async: true })
  .edge('emailq', 'mailer', STACK.internal, { async: true })
  // ---- control plane (credentials, keys, identities; fetched at start-up and cached)
  .edge('store', 'secrets', STACK.internal, { async: true })
  .edge('checkout', 'secrets', STACK.internal, { async: true })
  .edge('checkout', 'kms', STACK.internal, { async: true })
  .edge('checkout', 'iam', STACK.internal, { async: true })
  // ---- monitoring and operations
  .edge('metrics', 'store', STACK.http1, { async: true })
  .edge('metrics', 'checkout', STACK.http1, { async: true })
  .edge('metrics', 'workers', STACK.http1, { async: true })
  .edge('bastion', 'orders', STACK.postgres)
  .build();

export default defineProblem({
  id: 'problem.sample-ecommerce',
  title: 'Sample board: E-commerce storefront & checkout',
  level: 4,
  tags: [
    'sample',
    'reference-board',
    'e-commerce',
    'checkout',
    'caching',
    'search',
    'event-driven',
    'security',
    'observability',
    'disaster-recovery',
    company('amazon'),
    company('shopify'),
  ],
  requirements: {
    functional: [
      'Browse the catalog and product pages with images; full-text product search.',
      'Sign in (OIDC with MFA); add items to a cart that survives devices and restarts.',
      'Place an order: reserve stock, record the order, send a confirmation email.',
      'Stream clicks and sales into an analytics store for dashboards and recommendations.',
    ],
    nonFunctional: [
      'Peak sale traffic ≈ 100,000 requests/s (≈ 40k images/assets, 30k product pages, 10k searches, 6k cart writes, 2,000 orders/s), 2.5× the daily average.',
      'Product pages p99 < 200 ms; checkout p99 < 300 ms (card authorisation excluded).',
      'Orders are never lost: synchronous HA in the primary region plus a copy in a second region.',
      'Secure by default: DDoS shield + WAF at the edge, TLS everywhere, mTLS between services, data stores only reachable from services, secrets in a vault, PII encrypted with KMS keys.',
    ],
  },
  scale: { dau: 30_000_000, readWriteRatio: 12, dataSizeBytes: 60 * TB },
  scenario: scenario({
    usersByRegion: { 'north-america': 1_900_000, europe: 100_000 },
    peakMultiplier: 2.5,
    payloadBytes: { req: 1_500, res: 30_000 },
    flows: [
      {
        key: 'images',
        name: 'Load images & assets',
        share: 0.4,
        rpsPerUser: 0.02,
        op: 'read',
        path: ['client', { key: 'cdn', cacheable: true }, 'images'],
      },
      {
        key: 'browse',
        name: 'View product page',
        share: 0.3,
        rpsPerUser: 0.02,
        op: 'read',
        path: [
          'client',
          'shield',
          'waf',
          'gw',
          'mesh',
          'store',
          { key: 'cache', cacheable: true },
          'orders',
        ],
      },
      {
        key: 'search',
        name: 'Search products',
        share: 0.1,
        rpsPerUser: 0.02,
        op: 'read',
        path: ['client', 'shield', 'waf', 'gw', 'mesh', 'store', 'search'],
      },
      {
        key: 'clicks',
        name: 'Clickstream events',
        share: 0.1,
        rpsPerUser: 0.02,
        op: 'write',
        path: ['client', 'shield', 'waf', 'gw', 'mesh', 'store', 'stream', 'workers'],
      },
      {
        key: 'cart',
        name: 'Add to cart',
        share: 0.06,
        rpsPerUser: 0.02,
        op: 'write',
        path: ['client', 'shield', 'waf', 'gw', 'mesh', 'store', 'carts'],
      },
      {
        key: 'login',
        name: 'Sign in',
        share: 0.02,
        rpsPerUser: 0.02,
        op: 'write',
        path: ['client', 'shield', 'waf', 'gw', 'auth', { key: 'orders', op: 'read' }],
      },
      {
        key: 'order',
        name: 'Place order',
        share: 0.02,
        rpsPerUser: 0.02,
        op: 'write',
        path: [
          'client',
          'shield',
          'waf',
          'gw',
          'mesh',
          'checkout',
          { key: 'carts', op: 'read' },
          'orders',
          'stream',
          'workers',
          'dr',
          'emailq',
          'mailer',
        ],
      },
    ],
  }),
  hints: [
    'Two front doors: static assets and product images go client → CDN → object store (immutable keys, 30-day TTL, origin shield); every API call goes client → DDoS shield → WAF → API gateway, which validates JWTs and rate-limits per client before anything reaches a service.',
    'Inside the VPC a service mesh is the ingress and the only path between services: it load-balances the Kubernetes pods, retries idempotent calls and gives each service an mTLS identity. Login goes from the gateway straight to the auth server (MFA required).',
    'Read path: the storefront reads product data cache-aside from Redis (replica reads, 10-minute TTL) and falls back to Postgres read replicas; search never touches Postgres — it hits an Elasticsearch index that event workers keep up to date.',
    'Carts live in a partitioned key-value store, not the cache: they must survive evictions and restarts, and every access is by cart id. Postgres (sync replication + HA standby) is the system of record for catalog, users, stock and orders.',
    'Write path: checkout reads the cart, writes the order and the stock decrement in one Postgres transaction, then publishes OrderPlaced to Kafka and answers. Everything slow — confirmation email (queue + DLQ → serverless), search re-index, analytics, the DR copy — happens in consumers, off the critical path.',
    'Control and ops: services fetch database credentials from the secrets manager and envelope keys from KMS at start-up, with least-privilege IAM roles; Prometheus scrapes every service; humans reach the database only through the VPN bastion. Card payments would call a PSP adapter — see the Payment system problem.',
  ],
  referenceSolutions: [reference],
  rubric: [
    { slo: { metric: 'p99', op: 'lt', value: 200, flowId: 'flow_browse' }, weight: 3 },
    { slo: { metric: 'p99', op: 'lt', value: 200, flowId: 'flow_search' }, weight: 2 },
    { slo: { metric: 'p99', op: 'lt', value: 300, flowId: 'flow_order' }, weight: 3 },
    { slo: { metric: 'p99', op: 'lt', value: 200, flowId: 'flow_images' }, weight: 1 },
    { slo: { metric: 'availability', op: 'gte', value: 0.999 }, weight: 2 },
    { ruleId: 'rule.db-internet-reachable', weight: 2 },
    { ruleId: 'rule.plaintext-edge', weight: 1 },
    { ruleId: 'rule.no-rate-limit-public-api', weight: 1 },
    { ruleId: 'rule.missing-service-auth', weight: 1 },
    { ruleId: 'rule.secrets-in-config', weight: 1 },
    { ruleId: 'rule.single-region-data', weight: 1 },
    { ruleId: 'rule.spof', weight: 2 },
    { ruleId: 'rule.no-cache-hot-read', weight: 1 },
  ],
  debugVariants: [],
  docs: {
    summary:
      'Sample reference board: a production-minded e-commerce storefront — CDN and a filtered API edge, mTLS services on Kubernetes, cache-aside catalog, durable carts, a transactional order store, event-driven fulfilment, analytics, observability and a DR copy.',
  },
});
