# Sample workflow: Authentication, authorization & secrets

Registry entry `problem.sample-identity-access` (S25). Open it with **Problems → Tag "sample"** (or
`identity`, `authentication`, `authorization`, `iam`, `secrets`) **→ Start → "Reference solution"**.
The board loads with its scenario; press Run, then open **Security** and **Review**.

One board, not three: the lesson is how the pieces hand identity to each other. Splitting sign-in,
roles and secrets into separate boards would repeat the same gateway and services three times and
hide the hand-offs.

## The board at a glance

| Zone (group)                                   | Nodes                                                       |
| ---------------------------------------------- | ----------------------------------------------------------- |
| Internet                                       | Customers (role `customer`), Support staff (role `support`) |
| DMZ (API gateway)                              | API gateway — verifies JWTs, rate-limits                    |
| Identity subnet (private)                      | Auth server (OIDC, MFA, issues JWTs)                        |
| Identity data subnet (data)                    | Users DB (password hashes, MFA factors)                     |
| Kubernetes cluster (private)                   | Orders API, Payments service                                |
| App data subnet (data)                         | Orders DB, Invoice bucket, Payments DB                      |
| Managed security services (private, endpoints) | IAM / STS, Secrets manager, KMS                             |

## Authentication vs authorization

- **Authentication** answers _who is calling?_ Users authenticate once, at the auth server (password +
  MFA). Services authenticate each other with mTLS certificates, and to cloud APIs with IAM role
  credentials.
- **Authorization** answers _may this caller do this, to this object?_ It happens where the data
  is: the Orders API checks the user's role and ownership; the Payments service checks which service
  is calling; IAM policies check which role may read which secret, key or bucket.
- A valid token is not permission. The gateway proves the token is genuine and fresh; it does not
  know whether order 42 belongs to this customer.

## User identity path

1. **Sign in** (`flow_signin`): Customers → API gateway → Auth server → Users DB. The browser runs
   the OIDC authorization-code flow with PKCE; the gateway forwards the `/authorize` and `/token`
   routes (rate-limited, no token required). The auth server checks the argon2id password hash and
   the MFA factor, then returns an ID token, a 15-minute **access token (JWT)** signed with its
   private key, and a refresh token.
2. **Call the API** (`flow_myorders`, `flow_checkout`): Customers → API gateway → Orders API. The
   gateway verifies the JWT **locally**: signature against the auth server's public keys (JWKS,
   fetched once and cached), expiry, issuer, audience. The auth server is **not** on this path. The
   gateway forwards the request with the verified claims (`sub`, `roles`) over mTLS.
3. **Authorise** in the Orders API: `customer` may read and create only orders whose `customer_id`
   equals the token's `sub`; `support` may read any order and its invoice (`flow_support`) but not
   create orders or see card data. A request that fails returns 403 — the token was still valid.
4. **Refresh** (`flow_refresh`): every ~15 minutes the client trades its refresh token for a new
   access token at the auth server. Short access tokens are how a JWT gets "revoked" (it expires);
   the refresh token can be revoked server-side.

## Service identity path

1. **Service to service** (`flow_checkout`): Orders API → Payments service over **mTLS**. Both sides
   present certificates bound to their workload identity (e.g. a SPIFFE id from the Kubernetes
   service account). Payments accepts only the Orders identity: that is _service authorization_,
   separate from the customer's role. It still receives the user's claims to record who paid.
2. **Workload role** (`flow_secret`): each pod runs as its own Kubernetes service account, which is
   federated to an **IAM role**. The pod exchanges its service-account token at **STS** (the IAM
   node) for short-lived role credentials. No access keys live in config or images.
3. **Secrets** (`flow_secret`): with those credentials the pod asks the **secrets manager** for its
   own database password, caches it for 5 minutes (`cacheTtlSec`) and reconnects after the 30-day
   **rotation** (`rotationDays`). Every read is audited. The Orders role can read only the Orders DB
   secret; the Payments role only the Payments DB secret.
4. **Keys** (`flow_datakey`): Payments encrypts card tokens with a local data key and asks **KMS** to
   unwrap that data key (envelope encryption); the master key never leaves KMS. The auth server
   unwraps its token-signing key the same way at start-up. The secrets manager and the invoice bucket
   (SSE-KMS) also encrypt at rest under KMS keys (not drawn; see Known limits).
5. **Cloud resources**: the Orders API writes invoices to the private bucket with signed requests
   using its role — no password at all. IAM policy, not network position, decides access.

## User roles vs workload roles

|              | User roles (`customer`, `support`)       | Workload roles (IAM, mTLS identity)                |
| ------------ | ---------------------------------------- | -------------------------------------------------- |
| Who has them | People, via claims in the JWT            | Pods / services, via service account → IAM role    |
| Issued by    | Auth server at sign-in                   | Kubernetes + STS (role creds), mesh/CA (certs)     |
| Checked by   | Orders API (per action and per object)   | Payments (mTLS peer), cloud APIs (IAM policies)    |
| Governs      | Which orders a person may read or create | Which service, secret, key or bucket a pod may use |

IAM does **not** replace end-user authorization: the Orders role may read every order in the
database, so the API must still filter by the user's `sub` and role.

## Why each component is here

- **Auth server**: the only place passwords and MFA are checked; issues signed, short-lived tokens so
  nothing else handles credentials. `mfa: required` (stops credential stuffing takeovers).
- **API gateway**: one front door that verifies tokens locally, rate-limits per client and forwards
  identity; keeps auth plumbing out of every service. `authMode: jwt`.
- **IAM / STS**: gives each workload an identity and least-privilege policies (`leastPrivilege: true`).
- **Secrets manager**: holds credentials (DB passwords), hands them to authorised roles, rotates and
  audits them. It is **not** a general database: no queries, no application data, small values only.
- **KMS**: holds master keys and performs wrap/unwrap/sign; data stays where it is.

## Connections and trust boundaries

Every edge is initiated by its source (arrow direction). Security groups allow only these crossings.

| From → to                   | Protocol            | Purpose                                    | Boundary / security group          |
| --------------------------- | ------------------- | ------------------------------------------ | ---------------------------------- |
| Customers / Staff → gateway | TLS 1.3 + HTTP/2    | Sign-in routes and API calls with JWT      | internet → DMZ, 443 from internet  |
| Gateway → Auth server       | TLS 1.3 + HTTP/2    | OIDC `/authorize`, `/token`, JWKS fetch    | DMZ → private, 443 from DMZ only   |
| Auth server → Users DB      | TLS + postgres-wire | Password hashes, MFA factors, sessions     | private → data, 5432 from identity |
| Gateway → Orders API        | mTLS + HTTP/2       | Verified request + claims                  | DMZ → private, 443 from DMZ only   |
| Orders API → Payments       | mTLS + HTTP/2       | Charge; Payments accepts only Orders       | inside the cluster                 |
| Orders API → Orders DB      | TLS + postgres-wire | Orders (password from the secrets manager) | private → data, 5432 from cluster  |
| Orders API → Invoice bucket | TLS 1.3 + HTTP/2    | Invoices, signed with the Orders role      | private → data, 443 from cluster   |
| Payments → Payments DB      | TLS + postgres-wire | Card tokens, idempotency keys              | private → data, 5432 from cluster  |
| Workloads, auth → IAM / STS | TLS 1.3 + HTTP/2    | Exchange service-account token for role    | VPC endpoints, 443                 |
| Workloads, auth → Secrets   | TLS 1.3 + HTTP/2    | Fetch own DB credentials                   | VPC endpoints, 443                 |
| Payments, auth → KMS        | TLS 1.3 + HTTP/2    | Unwrap data keys / signing key             | VPC endpoints, 443                 |

The Users DB has its own subnet so that only the auth server can reach password hashes; the
services never touch it.

## Scenario

1,000,000 concurrent users in North America, 2× peak ≈ 20,000 requests/s. `flow_secret` and
`flow_datakey` start at the workload and run at a token rate (pods refreshing every few minutes,
not per user request). Expected result on the generic provider: order reads p99 ≈ 95 ms, checkout ≈
165 ms, sign-in ≈ 125 ms (argon2id makes logins the costliest call on the auth server), every node
below 0.6 utilisation, ≈ $27k/month.

Try the attack events (Scenario → Failures): **credential stuffing** (rate limit blocks 70 %; MFA
required ⇒ no takeovers), **data exfiltration** on the Payments DB (denied by least-privilege IAM),
**MITM** (every edge is encrypted). Then set `mfa` to optional or `leastPrivilege` to off and
compare. Remove the mTLS from Orders → Payments, or delete the secrets manager, to see the
`rule.missing-service-auth` and `rule.secrets-in-config` findings.

The review reports two deliberate scope cuts: `rule.single-region-data` (one region) and
`rule.no-cache-hot-read` on the Orders DB (a cache is out of scope here; if you add one, include the
user id in the cache key so one customer never gets another's orders).

## Practical use cases

- Consumer apps and marketplaces: OIDC sign-in + gateway JWT checks + per-object authorization.
- Internal back-office access (support role) on the same API with stricter role checks and audit.
- PCI-style isolation: card data in a separate service and database, reachable only via mTLS.
- Removing static credentials from Kubernetes workloads (IRSA / Workload Identity + secrets manager).

## Known limits

- **Roles and permissions are not modelled.** There is no field for JWT claims, per-route policies,
  IAM policy documents or mTLS allow-lists; the engine never returns 403. They live in labels, hints
  and these notes. `leastPrivilege` is one board-wide switch. Follow-up: an authorization-policy field
  on edges or nodes that a rule and the exfiltration attack could read.
- **Managed services have no outgoing ports**, so several real relationships cannot be drawn: the
  secrets manager's rotation function changing the DB password, the secrets manager and the bucket
  calling KMS for encryption at rest, every managed service checking IAM policies, and audit logs.
  Postgres has no at-rest encryption / KMS key field. Follow-up: optional `kmsKeyId`-style config and
  an audit-log sink component.
- **JWKS caching is not a separate edge.** The single Gateway → Auth server edge stands for both the
  forwarded OIDC routes and the occasional key fetch.
- **`flow_secret` steps from IAM to the secrets manager without an edge** (the pod calls both; a flow
  path is one chain). It measures the start-up cost, not a real IAM → secrets call.
- **False positive in `rule.secrets-in-config`**: it flags any string config field whose key contains
  `token` or `password`, so the auth server's `tokenFormat: 'jwt'` and `passwordHash: 'argon2id'`
  trip it. This board leaves both at their defaults (which are those values). Follow-up: skip
  enum-typed fields or match on values instead of key names.
- One region; no cache on the Orders DB (see Scenario).
