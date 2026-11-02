# Anti-pattern sample: Clinic patient portal (intentionally insecure)

> **This board is broken on purpose.** It is a teaching fixture: every flaw below lives only in
> this sample's graph data (`index.ts` in this folder). Nothing here changes how SysDraw itself
> runs or is deployed. Do not copy the broken design.

Registry entry: `problem.antipattern-patient-portal` (tags `sample`, `anti-pattern`, `security`).

## How to open it

1. **Problems** (top bar) → Tag **anti-pattern** → select the sample.
2. Mode **Debug** → start **Broken design (debug variant)**. A new board opens with the broken
   graph and the Monday-morning scenario.
3. **Run the simulation.** Two capacity rules (overloaded component, no cache on a hot read path)
   need a result; the other rules run without one.
4. Open the **Review** panel (all rules, worst first) and the **Security** panel (zones,
   encryption, security groups). Debug mode lists the symptoms and says when the board is fixed.

To compare, start the same problem in **Sandbox** from **Reference solution**: that is the
corrected board.

## The system

A clinic network's patient portal: patients see appointments and visit notes, book visits, view
lab results (from a separate lab results service) and download scanned documents. Staff use an
admin console to look up records. Peak: 250,000 concurrent patients at 2× the daily average ≈
10,000 requests/s (4,500 appointment views, 1,000 bookings, 2,500 lab views, 1,500 document
downloads, 500 staff lookups). Everything runs in one region (US East).

Path: Patients → load balancer → API gateway → patient portal → records DB / lab service /
document bucket. Staff → admin console VM → records DB.

## Severity vocabulary

SysDraw rules use four severities, worst first: `critical`, `error`, `warning`, `info`. This
sample's notes map them to the usual three levels like this:

| Usual level | SysDraw severity    | Meaning here                                           |
| ----------- | ------------------- | ------------------------------------------------------ |
| ERROR       | `critical`, `error` | Breach or outage waiting to happen; fix before release |
| WARNING     | `warning`           | Real risk or inefficiency; fix soon                    |
| INFO        | `info`              | Good practice or cost advice                           |

## What the review reports on the broken board (after a simulation run)

22 findings: 5 critical, 6 error, 8 warning, 3 info. Each row is one intended issue.

| #   | Intended issue                                                                                   | Rule (finding)                                             | Severity       | Impact                                                                                                                         | Remediation                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Records DB and document bucket sit in a subnet with a public route                               | `rule.db-internet-reachable` (×2: records, documents)      | critical       | Health records and scans are one leaked password or misconfiguration away from the internet                                    | Make the data subnet a private `data` zone; only the app tier (and the bastion) may reach it                                                |
| 2   | Security groups allow 0.0.0.0/0 on Postgres 5432 (data subnet) and SSH 22 (public subnet)        | `rule.open-admin-ports` (×2)                               | critical       | Internet scanners find and brute-force these ports within minutes                                                              | Remove the 0.0.0.0/0 rules; allow 5432 only from the app subnet and the bastion's subnet; reach hosts through the bastion / session manager |
| 3   | Patients reach the load balancer over plain HTTP (port 80)                                       | `rule.plaintext-edge` (over the internet)                  | error          | Passwords, session cookies and health data readable or changeable on any network on the way                                    | HTTPS (TLS 1.3) on the client edge; terminate TLS at the load balancer                                                                      |
| 4   | Plaintext inside: gateway → portal (HTTP), portal → Postgres and lab service → Postgres (no TLS) | `rule.plaintext-edge` (×3, across zones)                   | warning        | An attacker with a foothold in one zone sniffs PHI and DB credentials in the next                                              | mTLS between services, TLS-enabled Postgres drivers                                                                                         |
| 5   | Admin console is a VM with a public IP that bypasses the gateway                                 | `rule.no-rate-limit-public-api` (admin console)            | warning        | Credential stuffing and scraping against the most privileged UI, with no limit or authentication in front                      | Put the admin console behind the gateway (SSO + MFA, per-client limits) in the private subnet; ops use a VPN bastion                        |
| 6   | Admin console runs on one VM                                                                     | `rule.spof` (admin console)                                | error          | One crash or patch reboot and staff can't work                                                                                 | Two or more instances behind the gateway (autoscaled)                                                                                       |
| 7   | Portal is one small VM with in-memory sessions                                                   | `rule.spof` (portal)                                       | error          | Any restart logs every patient out and takes the portal down                                                                   | Stateless portal (sessions in Redis or signed tokens), several replicas, autoscaling                                                        |
| 8   | ... and it is overloaded at peak                                                                 | `rule.overloaded-node` (portal, saturated ≈ 105 %)         | critical       | Queueing explodes: p99 ≈ 7 s on every patient flow (SLO 300 ms) — visible in the metrics drawer                                | Scale out (4 × medium in the corrected board, ≈ 19 % at peak) and autoscale 3–8                                                             |
| 9   | Records DB: one instance, no standby                                                             | `rule.spof` (records)                                      | error          | A host or zone failure loses the system of record until a restore                                                              | `highAvailability` (hot standby, sync replication) and read replicas                                                                        |
| 10  | Records DB takes every read (no cache), ≈ 87 % busy                                              | `rule.no-cache-hot-read`, `rule.overloaded-node` (records) | warning, error | Every page view pays a DB round trip; the DB is the next bottleneck                                                            | Cache-aside Redis for appointments and slots (short TTL); read replicas                                                                     |
| 11  | Portal retries the lab service 10× immediately                                                   | `rule.unbounded-retries`                                   | error          | When the lab service slows down, the portal multiplies its load by up to 11× (retry storm) and patients wait for every attempt | At most 2 retries with exponential backoff and jitter, idempotent calls only                                                                |
| 12  | ... with no timeout                                                                              | `rule.no-timeout-sync-call`                                | warning        | A hung lab service pins every portal worker; the whole portal stops                                                            | Timeout a little above the lab service's p99 (800 ms here)                                                                                  |
| 13  | ... and no circuit breaker                                                                       | `rule.no-circuit-breaker`                                  | info           | Callers keep hammering a dead dependency                                                                                       | Breaker that opens at 50 % failures, then lets a trial request through                                                                      |
| 14  | Portal → lab service carries no service identity                                                 | `rule.missing-service-auth`                                | warning        | Anything inside the network (SSRF, a compromised pod) can read lab results                                                     | mTLS (service identity) and per-caller authorisation                                                                                        |
| 15  | All databases in one region                                                                      | `rule.single-region-data`                                  | warning        | A regional outage, ransomware or a deleted account takes all records with it                                                   | Cross-region replica or backups copied to another region and account                                                                        |
| 16  | No secrets manager: DB passwords live in config / environment                                    | `rule.secrets-in-config` (info variant)                    | info           | Credentials end up in images, repos and logs and never rotate                                                                  | Secrets manager (KMS-encrypted, rotated); services fetch credentials at start-up with their role                                            |
| 17  | Lab service runs a fixed 3 pods although traffic peaks at 2×                                     | `rule.no-autoscaling`                                      | info           | Paying for peak capacity all day                                                                                               | Target-tracking autoscaling (2–6 pods at 60 %)                                                                                              |

Debug mode calls the board fixed when these rules report nothing and every rubric SLO holds:
`rule.db-internet-reachable`, `rule.open-admin-ports`, `rule.plaintext-edge`,
`rule.missing-service-auth`, `rule.unbounded-retries`, `rule.spof`.

## Deliberate flaws no rule reports yet (follow-ups)

These are in the broken board on purpose, but SysDraw has no rule for them. Proposed rules:

- **Gateway with authentication off** (`authMode: 'none'`) and a rate limit no client can hit
  (1,000,000 rps). Rules treat the gateway as a rate-limit + auth control from its tags only.
  Follow-up: `rule.gateway-auth-disabled` / `rule.ineffective-rate-limit` reading the config.
- **Bucket `publicAccess: true`.** Flagged only through the public zone (row 1). Follow-up: a
  storage rule on `publicAccess` and `encryptionAtRest`.
- **In-memory sessions on the portal** (`stateless: false`). `rule.stateful-servers` fires only
  from 2 replicas, so it appears as soon as you scale out without making the portal stateless —
  try it.
- **Admin console → Postgres in plaintext.** Both ends sit in the same (public) zone, so
  `rule.plaintext-edge` stays quiet. Follow-up: flag plaintext database protocols in any zone.
- **No versioning on the document bucket** (no protection against deletion or ransomware).

## How the corrected board fixes it (Reference solution)

Same node and edge ids, so Debug mode can show what changed:

1. **Zones:** public subnet → DMZ (only 443 from the internet); data subnet → private `data` zone
   (5432 from the app subnet and the bastion's subnet, 443 and 6379–6380 from the app subnet).
2. **Encryption:** HTTPS at the edge; mTLS gateway → portal / admin and portal → lab service;
   TLS to Postgres.
3. **Front door:** the gateway validates JWTs and limits clients (20,000 rps, burst 40,000); the
   admin console moves behind it into the private subnet; ops use a VPN bastion (MFA, recorded
   sessions) to reach the database.
4. **Capacity and redundancy:** portal stateless, 4 × medium, autoscaled 3–8; admin console 2
   instances; lab service autoscaled 2–6; Postgres `large` with a hot standby (sync) and 2 read
   replicas; Redis cache for appointments and slots.
5. **Resilience:** portal → lab service: timeout 800 ms, 2 retries with exponential backoff,
   circuit breaker at 50 %.
6. **Secrets:** secrets manager for DB credentials (portal, lab service, admin console).

Result at the same peak: portal ≈ 19 % busy, records ≈ 46 %, appointment p99 ≈ 100 ms, lab
results p99 ≈ 125 ms. The review keeps one warning: `rule.single-region-data` (all databases in
US East). Fixing it needs a copy in a second region (see the e-commerce sample's DR pattern).

## Limits

- The scenario has one set of flow paths, written for the broken board. On the corrected board
  the cache, bastion and secrets manager sit beside those paths, so the simulation does not credit
  the cache's hit rate (records stays ≈ 46 % busy) and the staff flow is still drawn as staff →
  admin console although the corrected board routes it through the gateway.
- Debug mode's first hint says the fault "shows up in the security review, not in latency"
  because the variant lists rules to pass; here it shows up in both.
