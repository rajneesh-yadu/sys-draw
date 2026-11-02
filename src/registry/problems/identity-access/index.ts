/**
 * Sample workflow (S25): authentication, authorization and secrets in one small storefront. Shipped
 * as a problem entry (tag `sample`, the S22 mechanism) so it loads onto a board with its scenario
 * ("Start problem" → "Reference"). Companion notes: ./NOTES.md.
 *
 * One board, because the lesson is how the identity pieces relate: who authenticates the user
 * (auth server), who checks the token (gateway, locally), who decides what the user may do (the
 * Orders API, from role claims), how workloads prove who they are (mTLS between services, IAM
 * roles to cloud APIs) and where their credentials come from (secrets manager, KMS).
 *
 * Layout, left to right: users → DMZ (API gateway) → identity subnet (auth server, top) and the
 * Kubernetes cluster (Orders API, Payments service, middle) → data subnets (right). Managed
 * security services (IAM, secrets manager, KMS) sit in their own band at the bottom, reached
 * through VPC endpoints.
 *
 * Security groups are set after `design().build()` (the kit leaves them empty), as in S23. Only
 * edges that cross zones are evaluated against them; the rest document intent.
 */
import type { FirewallRule } from '@/core';
import { defineProblem } from '../../define';
import { company, design, GB, groupId, scenario, STACK } from '../kit';

const allow = (port: number, peer: string, description: string): FirewallRule => ({
  direction: 'ingress',
  action: 'allow',
  protocol: 'tcp',
  fromPort: port,
  toPort: port,
  peer,
  description,
});

/** Security-group ingress rules per subnet key. */
const FIREWALL: Record<string, FirewallRule[]> = {
  dmz: [allow(443, 'internet', 'HTTPS from customers and staff')],
  identity: [allow(443, groupId('dmz'), 'OIDC endpoints, only via the API gateway')],
  iddata: [allow(5432, groupId('identity'), 'Users DB: only the auth server')],
  k8s: [allow(443, groupId('dmz'), 'Service ingress (mTLS) from the API gateway only')],
  data: [
    allow(5432, groupId('k8s'), 'Orders / Payments DBs from the cluster'),
    allow(443, groupId('k8s'), 'Invoice bucket (VPC endpoint) from the cluster'),
  ],
  sec: [
    allow(443, groupId('k8s'), 'STS, Secrets Manager, KMS endpoints from workloads'),
    allow(443, groupId('identity'), 'STS, Secrets Manager, KMS endpoints from the auth server'),
  ],
};

const built = design()
  // ---- groups
  .group('use1', 'region', 'US East', { regionId: 'us-east' })
  .group('vpc', 'vpc', 'Shop VPC', { parent: 'use1' })
  .group('dmz', 'subnet', 'DMZ (API gateway)', { parent: 'vpc', zone: 'dmz' })
  .group('identity', 'subnet', 'Identity subnet (auth server)', { parent: 'vpc', zone: 'private' })
  .group('iddata', 'subnet', 'Identity data subnet', { parent: 'vpc', zone: 'data' })
  .group('k8s', 'cluster', 'Kubernetes cluster (workload identities)', {
    parent: 'vpc',
    zone: 'private',
  })
  .group('data', 'subnet', 'App data subnet', { parent: 'vpc', zone: 'data' })
  .group('sec', 'subnet', 'Managed security services (VPC endpoints)', {
    parent: 'vpc',
    zone: 'private',
  })

  // ---- people (internet)
  .node('client', 'client.app', 'Customers (web & app, role: customer)', [0, 2], {
    type: 'browser',
  })
  .node('staff', 'client.app', 'Support staff (role: support)', [0, 4], { type: 'browser' })

  // ---- DMZ: the gateway verifies tokens locally (cached JWKS) and rate-limits
  .node('gw', 'network.api-gateway', 'API gateway (verifies JWT locally)', [1, 3], {
    type: 'managed',
    group: 'dmz',
    config: { authMode: 'jwt', rateLimitRps: 50_000, burst: 100_000, timeoutMs: 5_000 },
  })

  // ---- identity: authentication happens here, and only here
  .node('auth', 'security.auth-server', 'Auth server (OIDC, MFA, issues JWTs)', [2, 0], {
    type: 'large',
    replicas: 4,
    group: 'identity',
    // tokenFormat ('jwt') and passwordHash ('argon2id') are left at their defaults on purpose:
    // rule.secrets-in-config matches any string field whose key contains "token" or "password",
    // so setting them explicitly is a false positive (NOTES.md → Known limits).
    config: {
      accessTokenTtlMin: 15,
      mfa: 'required',
      lockoutAfterFailures: 5,
    },
  })
  .node('usersdb', 'database.postgres', 'Users DB (password hashes, MFA)', [3, 0], {
    type: 'large',
    group: 'iddata',
    config: { replication: 'sync', highAvailability: true, tableRows: 20_000_000 },
  })

  // ---- workloads: each pod runs as its own Kubernetes service account → IAM role
  .node('orders', 'compute.kubernetes', 'Orders API (authorises user roles)', [2, 3], {
    type: 'large',
    replicas: 4,
    group: 'k8s',
    autoscale: { min: 3, max: 10, targetUtil: 0.6, warmupSec: 60 },
  })
  .node('payments', 'compute.kubernetes', 'Payments service (internal only)', [3, 4], {
    type: 'medium',
    replicas: 3,
    group: 'k8s',
    autoscale: { min: 2, max: 6, targetUtil: 0.6, warmupSec: 60 },
  })

  // ---- protected resources
  .node('ordersdb', 'database.postgres', 'Orders DB (orders role only)', [4, 2], {
    type: 'xlarge',
    group: 'data',
    config: { readReplicas: 2, replication: 'sync', tableRows: 200_000_000, storageGb: 1_000 },
  })
  .node('bucket', 'storage.object', 'Invoice bucket (private, SSE-KMS)', [4, 3], {
    type: 'managed',
    group: 'data',
    config: { publicAccess: false, encryptionAtRest: true, versioning: true },
  })
  .node('paymentsdb', 'database.postgres', 'Payments DB (card tokens, idempotency keys)', [4, 4], {
    type: 'large',
    group: 'data',
    config: { readReplicas: 1, replication: 'sync', tableRows: 50_000_000 },
  })

  // ---- managed security services
  .node('iam', 'security.iam', 'IAM / STS (workload roles)', [2, 6], {
    type: 'managed',
    group: 'sec',
    config: { leastPrivilege: true, mfaForHumans: true, accessAnalyzer: true },
  })
  .node('secrets', 'security.secrets-manager', 'Secrets manager (DB credentials)', [3, 6], {
    type: 'managed',
    group: 'sec',
    config: { rotationDays: 30, cacheTtlSec: 300 },
  })
  .node('kms', 'security.kms', 'KMS (signing & data keys)', [4, 6], {
    type: 'managed',
    group: 'sec',
    config: { keyType: 'customer-managed', autoRotate: true },
  })

  // ---- user path: sign-in and API calls both enter through the gateway
  .edge('client', 'gw', STACK.https)
  .edge('staff', 'gw', STACK.https)
  // /authorize, /token, /.well-known/jwks.json: the only calls that reach the auth server
  .edge('gw', 'auth', STACK.internal, { config: { timeoutMs: 2_000 } })
  .edge('auth', 'usersdb', STACK.postgres, { config: { timeoutMs: 1_000, poolSize: 20 } })
  // verified request + token claims forwarded over mTLS (the gateway's own workload identity)
  .edge('gw', 'orders', STACK.svc, { config: { timeoutMs: 3_000 } })

  // ---- service authorisation: Payments accepts only the Orders identity (mTLS peer)
  .edge('orders', 'payments', STACK.svc, {
    config: { timeoutMs: 1_500, retries: 2, backoff: 'exp', breakerErrorThreshold: 0.5 },
  })
  .edge('orders', 'ordersdb', STACK.postgres, { config: { timeoutMs: 1_000, poolSize: 20 } })
  .edge('orders', 'bucket', STACK.internal, { config: { timeoutMs: 2_000 } })
  .edge('payments', 'paymentsdb', STACK.postgres, { config: { timeoutMs: 1_000, poolSize: 10 } })

  // ---- workload identity → short-lived role credentials (STS)
  .edge('orders', 'iam', STACK.internal, { config: { timeoutMs: 1_000 } })
  .edge('payments', 'iam', STACK.internal, { config: { timeoutMs: 1_000 } })
  .edge('auth', 'iam', STACK.internal, { config: { timeoutMs: 1_000 } })
  // ---- secrets: DB credentials fetched at start-up / on rotation, signed with the role creds
  .edge('orders', 'secrets', STACK.internal, { config: { timeoutMs: 1_000 } })
  .edge('payments', 'secrets', STACK.internal, { config: { timeoutMs: 1_000 } })
  .edge('auth', 'secrets', STACK.internal, { config: { timeoutMs: 1_000 } })
  // ---- KMS: auth unwraps its token-signing key; payments unwraps card-data keys (envelope)
  .edge('auth', 'kms', STACK.internal, { config: { timeoutMs: 1_000 } })
  .edge('payments', 'kms', STACK.internal, { config: { timeoutMs: 1_000 } })
  .build();

for (const g of built.groups) {
  const rules = FIREWALL[g.id.replace(/^grp_/, '')];
  if (rules && g.security) g.security.firewallRules = structuredClone(rules);
}
const reference = built;

export default defineProblem({
  id: 'problem.sample-identity-access',
  title: 'Sample workflow: Authentication, authorization & secrets',
  level: 3,
  tags: [
    'sample',
    'reference-board',
    'security',
    'identity',
    'authentication',
    'authorization',
    'oauth2',
    'oidc',
    'jwt',
    'iam',
    'secrets',
    'kms',
    'mtls',
    company('shopify'),
  ],
  requirements: {
    functional: [
      'Customers and support staff sign in once (OIDC authorization code + PKCE, MFA required) and call the API with a short-lived access token (JWT, 15 min) and a refresh token.',
      'Customers may read and create only their own orders; support staff (role: support) may read any order and download its invoice, but cannot place orders or see card data.',
      'The Payments service is internal: it accepts calls only from the Orders API, which proves its identity with mTLS.',
      'No service holds a long-lived password or key in config: workloads get short-lived IAM role credentials from their Kubernetes service account, fetch database passwords from a secrets manager (rotated every 30 days) and unwrap data keys with KMS.',
    ],
    nonFunctional: [
      'Peak ≈ 20,000 requests/s: 13.6k order reads, 2k checkouts, 3k token refreshes, 1k sign-ins, 400 support lookups.',
      'Order reads p99 < 150 ms and checkout p99 < 300 ms from the customer; the auth server is not on those paths (the gateway verifies the JWT signature locally with cached JWKS keys).',
      'Sign-in p99 < 400 ms including a deliberately slow password hash (argon2id).',
      'Every connection is encrypted (TLS, mTLS between services); data stores are reachable only from the services that own them (security groups per subnet).',
    ],
  },
  scale: { dau: 2_000_000, readWriteRatio: 6, dataSizeBytes: 1_500 * GB },
  scenario: scenario({
    usersByRegion: { 'north-america': 1_000_000 },
    peakMultiplier: 2,
    payloadBytes: { req: 1_000, res: 4_000 },
    flows: [
      {
        key: 'signin',
        name: 'Sign in: gateway → auth server (password + MFA) → users DB',
        share: 0.05,
        rpsPerUser: 0.01,
        op: 'write',
        path: ['client', 'gw', 'auth', 'usersdb'],
      },
      {
        key: 'refresh',
        name: 'Refresh access token (every 15 min): gateway → auth server',
        share: 0.15,
        rpsPerUser: 0.01,
        op: 'read',
        path: ['client', 'gw', 'auth', 'usersdb'],
      },
      {
        key: 'myorders',
        name: 'Customer reads own orders (JWT checked at gateway, owner check in API)',
        share: 0.68,
        rpsPerUser: 0.01,
        op: 'read',
        path: ['client', 'gw', 'orders', 'ordersdb'],
      },
      {
        key: 'checkout',
        name: 'Customer checks out: Orders → Payments over mTLS',
        share: 0.1,
        rpsPerUser: 0.01,
        op: 'write',
        path: ['client', 'gw', 'orders', 'ordersdb', 'payments', 'paymentsdb'],
      },
      {
        key: 'support',
        name: 'Support agent reads an order + invoice (role: support)',
        share: 0.0198,
        rpsPerUser: 0.01,
        op: 'read',
        path: ['staff', 'gw', 'orders', 'ordersdb', 'bucket'],
      },
      {
        key: 'secret',
        name: 'Workload refreshes role credentials (STS) and its DB secret',
        share: 0.0001,
        rpsPerUser: 0.01,
        op: 'read',
        // Starts at the workload: pods call STS and the secrets manager themselves (at start-up
        // and when the 5-min cache expires), not on behalf of a user request.
        path: ['orders', 'iam', 'secrets'],
      },
      {
        key: 'datakey',
        name: 'Payments unwraps its card-data key with KMS (envelope)',
        share: 0.0001,
        rpsPerUser: 0.01,
        op: 'read',
        path: ['payments', 'kms'],
      },
    ],
  }),
  hints: [
    'Authentication (who are you?) happens once, at the auth server: the user logs in with password + MFA through the authorization-code + PKCE flow and gets a short-lived signed access token (JWT) and a refresh token. Only sign-in, refresh and the JWKS key fetch reach the auth server.',
    'The API gateway checks every request’s token locally: it verifies the JWT signature with the auth server’s cached public keys (JWKS), the expiry and the audience, then forwards the request and the verified claims (user id, roles) to the Orders API. No per-request call to the auth server.',
    'Authorization (what may you do?) is the application’s job: the Orders API reads the role claim (customer or support) and checks ownership per object — a customer may read only orders whose customer_id matches the token’s subject. A valid token is not permission.',
    'Services authenticate each other with mTLS: the Payments service accepts only the Orders API’s certificate identity and refuses everyone else, even inside the VPC. That is service-to-service authorization, separate from the user’s roles.',
    'Workload IAM roles govern access to cloud APIs: each pod’s service account maps to an IAM role, STS hands out short-lived credentials, and least-privilege policies decide which secret, key or bucket each role may touch. IAM does not decide what an end user may do.',
    'Secrets manager stores credentials, not data: services fetch their database password at start-up with their role, cache it for 5 minutes and pick up the rotated one after 30 days; every read is audited. KMS holds the keys that encrypt secrets, buckets and card data (envelope encryption); keys never leave KMS.',
  ],
  referenceSolutions: [reference],
  rubric: [
    { slo: { metric: 'p99', op: 'lt', value: 150, flowId: 'flow_myorders' }, weight: 3 },
    { slo: { metric: 'p99', op: 'lt', value: 300, flowId: 'flow_checkout' }, weight: 2 },
    { slo: { metric: 'p99', op: 'lt', value: 400, flowId: 'flow_signin' }, weight: 2 },
    { slo: { metric: 'availability', op: 'gte', value: 0.999 }, weight: 1 },
    { ruleId: 'rule.missing-service-auth', weight: 2 },
    { ruleId: 'rule.secrets-in-config', weight: 2 },
    { ruleId: 'rule.plaintext-edge', weight: 2 },
    { ruleId: 'rule.db-internet-reachable', weight: 2 },
    { ruleId: 'rule.no-rate-limit-public-api', weight: 1 },
    { ruleId: 'rule.security-group-blocks', weight: 1 },
    { ruleId: 'rule.open-admin-ports', weight: 1 },
    { ruleId: 'rule.spof', weight: 1 },
  ],
  debugVariants: [],
  docs: {
    summary:
      'Sample workflow: how authentication, authorization and secrets fit together — an auth server signs users in and issues short-lived JWTs, the API gateway verifies them locally, the Orders API authorises by role and ownership, services prove their identity to each other with mTLS, and workloads use IAM roles to fetch rotated database credentials from a secrets manager and keys from KMS.',
  },
});
