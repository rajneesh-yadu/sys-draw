/** S17 practice problem: a payment system like Stripe or PayPal (level 5). */
import { defineProblem } from '../../define';
import { company, design, scenario, STACK, TB } from '../kit';

const reference = design()
  .group('use1', 'region', 'US East (primary)', { regionId: 'us-east' })
  .group('vpc', 'vpc', 'Payments VPC', { parent: 'use1' })
  .group('edge', 'subnet', 'Public subnet', { parent: 'vpc', zone: 'public' })
  .group('app', 'subnet', 'Private subnet (services)', { parent: 'vpc', zone: 'private' })
  .group('data', 'subnet', 'Data subnet (PCI)', { parent: 'vpc', zone: 'data' })
  .group('usw2', 'region', 'US West (standby)', { regionId: 'us-west-2' })
  .group('drdata', 'subnet', 'Standby data subnet', { parent: 'usw2', zone: 'data' })
  .node('client', 'client.app', 'Merchants (API & checkout)', [0, 2], { type: 'browser' })
  .node('waf', 'security.waf', 'WAF', [1, 2], { type: 'managed', group: 'edge' })
  .node('lb', 'network.load-balancer', 'Load balancer', [2, 2], { type: 'standard', group: 'edge' })
  .node('api', 'compute.app-server', 'Payment API', [3, 2], {
    type: 'large',
    replicas: 6,
    group: 'app',
    config: { requestTimeoutMs: 30_000 },
  })
  .node('psp', 'compute.app-server', 'PSP / card-network adapter', [4, 3], {
    type: 'medium',
    replicas: 4,
    group: 'app',
  })
  .node('secrets', 'security.secrets-manager', 'Secrets manager', [3, 0], {
    type: 'managed',
    group: 'app',
  })
  .node('kms', 'security.kms', 'KMS (card data keys)', [4, 0], { type: 'managed', group: 'app' })
  .node('idem', 'cache.redis', 'Idempotency keys (Redis)', [4, 1], {
    type: 'mem-medium',
    group: 'data',
    config: {
      shards: 2,
      keyCount: 50_000_000,
      avgItemBytes: 300,
      ttlSec: 86_400,
      persistence: 'aof-everysec',
    },
  })
  .node('ledger', 'database.postgres', 'Ledger (Postgres, sync HA)', [5, 2], {
    type: 'xlarge',
    group: 'data',
    config: {
      readReplicas: 2,
      replication: 'sync',
      highAvailability: true,
      tableRows: 5_000_000_000,
    },
  })
  .node('stream', 'messaging.stream', 'Payment events (Kafka)', [5, 3], {
    type: 'medium',
    replicas: 3,
    group: 'app',
    config: { partitions: 24 },
  })
  .node('recon', 'compute.app-server', 'Reconciliation & webhooks', [6, 3], {
    type: 'medium',
    replicas: 3,
    group: 'app',
  })
  .node('standby', 'database.postgres', 'Standby ledger (US West)', [7, 2], {
    type: 'xlarge',
    group: 'drdata',
    config: { highAvailability: true, tableRows: 5_000_000_000 },
  })
  .edge('client', 'waf', STACK.https)
  .edge('waf', 'lb', STACK.internal)
  .edge('lb', 'api', STACK.internal)
  .edge('api', 'idem', STACK.redis)
  .edge('api', 'ledger', STACK.postgres, { config: { timeoutMs: 2_000, poolSize: 50 } })
  .edge('api', 'psp', STACK.svc, { config: { timeoutMs: 10_000, retries: 0 } })
  .edge('api', 'stream', STACK.kafka)
  .edge('api', 'secrets', STACK.internal, { async: true })
  .edge('psp', 'kms', STACK.internal)
  .edge('stream', 'recon', STACK.internal, { async: true })
  .edge('recon', 'standby', STACK.postgres)
  .build();

export default defineProblem({
  id: 'problem.payment-system',
  title: 'Payment system',
  level: 5,
  tags: [
    'consistency',
    'idempotency',
    'ledger',
    'exactly-once',
    'security',
    'pci',
    'disaster-recovery',
    company('stripe'),
    company('paypal'),
  ],
  requirements: {
    functional: [
      'Merchants create a payment (amount, currency, card or wallet token) and get its status: pending, succeeded, failed or refunded.',
      'Charge the card through external payment service providers (PSPs); refunds and partial refunds.',
      'Keep a double-entry ledger of every money movement and reconcile it daily with PSP settlement files.',
      'Notify merchants of status changes with signed webhooks.',
    ],
    nonFunctional: [
      'Never charge twice: every create call carries an idempotency key, retries return the first result.',
      'Correctness over latency: ledger writes are ACID and synchronously replicated; no money lost on a node failure.',
      'Security: card data encrypted (PCI DSS), databases only reachable from services, secrets in a vault, TLS everywhere.',
      'Survive a regional outage with a standby region; p99 < 250 ms for status reads and < 400 ms to create a payment (excluding the PSP); peak ≈ 2,000 payments/s.',
    ],
  },
  scale: { dau: 20_000_000, readWriteRatio: 4, dataSizeBytes: 50 * TB },
  scenario: scenario({
    usersByRegion: { 'north-america': 250_000, europe: 100_000 },
    peakMultiplier: 3,
    payloadBytes: { req: 1_500, res: 2_000 },
    flows: [
      {
        key: 'pay',
        name: 'Create payment',
        share: 0.2,
        rpsPerUser: 0.01,
        op: 'write',
        path: [
          'client',
          'waf',
          'lb',
          'api',
          'idem',
          'ledger',
          'psp',
          'kms',
          'stream',
          'recon',
          'standby',
        ],
      },
      {
        key: 'status',
        name: 'Get payment status',
        share: 0.8,
        rpsPerUser: 0.01,
        op: 'read',
        path: ['client', 'waf', 'lb', 'api', 'ledger'],
      },
    ],
  }),
  hints: [
    'Start from correctness: what happens if the client retries, the PSP times out, or your server crashes between charging and recording? Write the state machine (created → authorised → captured / failed) down first.',
    'Idempotency: store the idempotency key with the request hash and result (unique constraint or SET NX); a retry with the same key returns the stored result instead of charging again.',
    'Record money movements in a double-entry, append-only ledger in an ACID database with synchronous replication; never update balances in place.',
    'Talk to PSPs through an adapter with timeouts and no blind retries; resolve unknown outcomes by querying the PSP, and reconcile daily against settlement files.',
    'Publish payment events to a durable log for webhooks, reconciliation and the standby region; consumers must be idempotent (exactly-once effect = at-least-once delivery + dedupe).',
    'Isolate card data (tokenise, encrypt with KMS-managed keys), keep databases in a private data subnet, secrets in a vault, and replicate the ledger to a second region.',
  ],
  referenceSolutions: [reference],
  rubric: [
    { slo: { metric: 'p99', op: 'lt', value: 250, flowId: 'flow_status' }, weight: 2 },
    { slo: { metric: 'p99', op: 'lt', value: 400, flowId: 'flow_pay' }, weight: 2 },
    { slo: { metric: 'availability', op: 'gte', value: 0.9995 }, weight: 3 },
    { ruleId: 'rule.db-internet-reachable', weight: 2 },
    { ruleId: 'rule.plaintext-edge', weight: 1 },
    { ruleId: 'rule.single-region-data', weight: 2 },
    { ruleId: 'rule.secrets-in-config', weight: 1 },
    { ruleId: 'rule.missing-service-auth', weight: 1 },
  ],
  debugVariants: [],
  docs: {
    summary:
      'Design a payment platform: idempotent APIs, an ACID double-entry ledger, PSP integration with unknown outcomes, reconciliation, PCI isolation and a standby region.',
  },
});
