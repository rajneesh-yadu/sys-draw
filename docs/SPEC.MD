# SysDraw — System Design Illustrator: Product Spec & Session Prompts

Oct 31, 2026 · @Rajneesh

## How to use this doc

Build SysDraw one session at a time: each session gets the short Context Pack plus exactly one Session Prompt (section 10), and ends by updating two files in the repo. Nothing else from earlier sessions needs to be pasted.

**The loop for every session**

1. Open a fresh session in your coding tool, pointed at the repo.
2. Paste the **Context Pack** below, then one **Session Prompt** from section 10.
3. The AI reads only the files the prompt names (usually `docs/ARCHITECTURE.md`, `docs/PROGRESS.md` and 1–3 source folders).
4. It builds, runs tests, then appends a handoff note to `docs/PROGRESS.md` (template in section 11) and commits.
5. Close the session. The next session starts from the repo, not from chat history.

**Token-saving rules (put these in every prompt; they are already in the Context Pack)**

- The repo is the memory. Sections 1–9 of this doc get copied into `docs/` in Session 01, so later sessions read one file instead of you pasting the spec.
- One session = one module. If a prompt touches more than its listed folders, split it.
- Read interfaces, not implementations: other modules are used only through their `index.ts` public API.
- No refactors outside scope. Note them in `docs/PROGRESS.md` under *Follow-ups* instead.
- Ask for diffs/new files, not full rewrites of existing files.

**Context Pack (paste at the top of every session)**

```markdown
You are working on SysDraw, a browser app for practising system design: users draw
architectures on a canvas, configure components, simulate traffic from users worldwide,
and see latency/throughput/cost/failures per component and end to end. It also teaches
the network protocols and security on every connection.

Non-negotiable architecture (details in docs/ARCHITECTURE.md):
- TypeScript strict, React + Vite, Zustand store, React Flow canvas, Zod schemas.
- Everything is data-driven: components, protocols, cloud providers, problems and
  rules are REGISTRY ENTRIES (plain objects validated by Zod), never hard-coded in UI.
- The simulation engine is pure TS in src/engine, runs in a Web Worker, has no React
  imports, and is deterministic given a seed.
- Modules talk only through their index.ts public API.
- Saved files are versioned JSON with migrations.

Rules for this session:
- Do ONLY the task below. Read docs/ARCHITECTURE.md and docs/PROGRESS.md first, then
  only the folders the task lists.
- Don't change public APIs of other modules; if you must, say so and stop.
- Write unit tests for logic. Keep `npm test` and `npm run build` green.
- Finish by appending a handoff note to docs/PROGRESS.md (what changed, public APIs
  added, known gaps, next step) and listing the files you touched.
```

## Product vision

SysDraw is a flight simulator for system design: you draw a system, throw realistic global traffic at it, watch where it breaks, and fix it — from a rate limiter up to Instagram, X or Discord.

**Target user:** an engineer preparing for system design interviews, or learning distributed systems, networking and security by doing.

**Core principles** (every session must respect these)

1. **Data over code.** A new component, cloud service, protocol, practice problem or review rule is a registry entry, not a UI change. Adding Kafka should mean adding one file.
2. **Model, view, engine are separate.** The design (graph) is pure data; the canvas only renders it; the engine only reads it and returns metrics.
3. **Approximate but honest.** Use established models (queueing theory, speed-of-light latency, published instance specs) and show the formula behind every number. Educational accuracy beats false precision.
4. **Progressive depth.** Every component works with defaults in 10 seconds, and exposes advanced knobs (partitions, consistency level, TLS version) when the user expands it.
5. **Explain everything.** Every component, protocol and metric has a "Why / How it works" panel.
6. **Account-backed persistence.** The deployed app requires sign-in and saves workspaces to the cloud under the signed-in user's account. JSON export/import remains available for portability; browser storage is not an authoritative or fallback workspace store.

**Glossary**

| Term | Meaning |
| --- | --- |
| Workspace | All of a user's projects, stored locally |
| Project | A named folder of boards (e.g. "Instagram practice") |
| Board | One tab/page: a single design canvas with its own graph, scenario and results |
| Node | A placed component instance (e.g. `api-server-1`) |
| Edge | A connection between two nodes, carrying one or more protocols |
| ComponentDefinition | Registry entry describing a component type: ports, config schema, performance model, docs |
| Group | A container node: region, availability zone, VPC, subnet, cluster |
| Scenario | The traffic and conditions to simulate: users per region, request mix, read/write ratio, growth, failures |
| Flow | A named request path, e.g. "Post photo" or "Load feed", with its share of traffic |
| Problem | A practice question: requirements, constraints, hints, reference solutions, evaluation rubric |
| Mode | How the user is guided: Sandbox, Guided, Interview, Debug, Learn |

## Feature requirements

Each requirement below maps one of your 11 features to the module that owns it and a testable acceptance check. IDs (F1…F12) are referenced by the session prompts.

| ID | Feature | Owning module | Acceptance check |
| --- | --- | --- | --- |
| F1 | Visual system design illustrator: drag components from a palette, connect them, group them in regions/VPCs, pan/zoom, undo/redo, copy/paste, auto-layout | `canvas`, `store` | Build a 6-node design (client → CDN → LB → 2 servers → DB) in under 60 s; undo 20 steps works |
| F2 | Progressive extensibility: new components, providers, protocols, problems, rules added as registry files with no UI changes | `registry` | Adding a new component file makes it appear in palette, inspector and engine with zero other edits |
| F3 | Practice problems from basic to complex: rate limiter, URL shortener, chat, news feed, Instagram, X, Discord, YouTube, Uber, payment system | `problems` | 10 problems ship; each has requirements, scale numbers, hints and at least one reference design that loads onto a board |
| F4 | Cloud platforms and tools: choose AWS / GCP / Azure / generic; real products (EC2, Lambda, DynamoDB, Pub/Sub, Kafka, Redis, Cassandra, Elasticsearch, S3, CloudFront, etc.) | `registry/providers`, `registry/components` | Switching a board's provider relabels generic nodes to provider equivalents (e.g. Object Store → S3 / GCS / Blob) and swaps their limits and prices |
| F5 | Configurable components: every node has a schema-driven config (instance type, replicas, cache size, TTL, partitions, replication factor, consistency, timeouts, retries) | `inspector`, `registry` | Inspector form is generated from the Zod schema; invalid values are blocked with a reason |
| F6 | Horizontal and vertical scaling: replica count, autoscaling policy, instance size, sharding, read replicas, partitions | `engine/scaling`, `inspector` | Doubling replicas behind an LB roughly halves utilisation; changing instance size changes capacity and cost |
| F7 | Performance view: per-node and end-to-end latency (p50/p95/p99), throughput, utilisation, queue depth, error rate, cache hit rate, cost/month; bottleneck highlight | `engine`, `metrics-ui` | Overloaded node turns red; system panel shows p99 per flow; every number has a "show formula" tooltip |
| F8 | Global users and real-life conditions: users per region, distance latency, CDN/edge, cross-region replication lag, diurnal peaks, traffic spikes, packet loss, partitions, outages, cold starts, thundering herd | `engine/geo`, `engine/chaos`, `scenario` | Moving 40% of users to Asia with servers only in us-east raises their p50 by roughly the trans-Pacific RTT; adding an ap-south region fixes it |
| F9 | Multiple pages/tabs, saved: projects with many boards, rename/duplicate/delete, autosave, version snapshots, import/export JSON | `workspace`, `persistence` | Reload the browser: all boards return exactly; exported JSON re-imports on a fresh profile |
| F10 | Networking and security understanding: protocol per edge (HTTP/1.1, HTTP/2, HTTP/3/QUIC, gRPC, WebSocket, TCP, UDP, DNS, TLS, AMQP, Kafka wire, SQL wire), OSI layer view, request trace animation, handshake costs, security controls and threats | `network`, `security`, `trace-ui` | Clicking an edge shows its protocol stack, handshake RTTs and headers; a trace animates DNS → TCP → TLS → HTTP for one request |
| F11 | Modes: Sandbox (free build), Guided (step-by-step), Interview (timed, no hints, scored), Debug (broken system to fix), Learn (concept lessons), Chaos (inject failures) | `modes` | Each mode can be entered on any board; Debug mode loads a broken design and confirms when it's fixed |
| F12 | Capacity estimation helper: back-of-envelope calculator (QPS, storage, bandwidth) linked to the scenario | `estimator` | Entering DAU 100M, 10 reads/user/day gives \~11.6k avg QPS and the value can be pushed into the scenario |

**Non-functional requirements**

- Canvas stays at 60 fps with 300 nodes; a simulation of 300 nodes finishes in under 1 s in the worker.
- Works offline after first load; no account required.
- Keyboard accessible: every palette and inspector action reachable without a mouse.
- Save format is versioned (`schemaVersion`) with forward migrations, so old boards never break as features are added.

## Architecture

SysDraw is a client-only app in five layers; the registry is the extension point that keeps every later feature a data file instead of a UI rewrite.

&#91;embedded content: SysDraw architecture · 5 layers\]

The UI never computes metrics and the engine never touches React: the store sends the engine a frozen board snapshot and gets results back. The store autosaves to IndexedDB.

**Module boundaries** (each is a folder with an `index.ts` public API; nothing imports another module's internals)

| Module | Owns | Depends on |
| --- | --- | --- |
| `core` | Zod schemas and types (section 4), ids, units, migrations | nothing |
| `registry` | Loading and validating all registry entries; lookup by id/tag/provider | `core` |
| `store` | Workspace/project/board state, command bus (every edit is an undoable command), selection | `core`, `registry` |
| `canvas` | React Flow rendering, palette, groups, edge drawing, overlays (heatmap, badges) | `store`, `registry` |
| `inspector` | Schema-driven forms for nodes, edges, groups, scenario | `store`, `registry` |
| `engine` | Simulation (section 5): pure functions + worker wrapper | `core`, `registry` |
| `network` | Protocol stacks, handshake/overhead math, trace generation (section 6) | `core`, `registry` |
| `security` | Security controls, zone model, threat checks | `core`, `registry` |
| `metrics-ui` | Dashboards, per-node panels, charts, formula tooltips | `store` |
| `modes` | Sandbox/Guided/Interview/Debug/Learn/Chaos controllers | `store`, `registry`, `engine` |
| `problems` | Problem library UI, reference-solution loader | `registry`, `store` |
| `estimator` | Back-of-envelope calculator | `core` |
| `persistence` | IndexedDB adapter, import/export, autosave, snapshots | `core`, `store` |

**Extension contract.** Every registry entry type exports one `define*` helper (`defineComponent`, `defineProvider`, `defineProtocol`, `defineProblem`, `defineRule`, `defineLesson`) that validates with Zod at load time. Registry files are auto-discovered with `import.meta.glob`, so adding a file is enough.

**Folder structure**

```
src/
  core/            schemas/, ids.ts, units.ts, migrations/
  registry/
    components/    compute/, network/, storage/, database/, cache/, messaging/,
                   security/, observability/, clients/  (one file per component)
    providers/     aws.ts, gcp.ts, azure.ts, generic.ts
    protocols/     http1.ts, http2.ts, http3.ts, grpc.ts, websocket.ts, tcp.ts, ...
    problems/      rate-limiter/, url-shortener/, ..., instagram/, discord/
    rules/         spof.ts, no-cache-hot-read.ts, ...
    lessons/
    index.ts
  store/
  canvas/
  inspector/
  engine/          model/, queueing/, geo/, scaling/, chaos/, cost/, worker.ts
  network/
  security/
  metrics-ui/
  modes/
  problems/
  estimator/
  persistence/
  app/             layout, routing, theme, shortcuts
docs/              ARCHITECTURE.md, DATA-MODEL.md, ENGINE.md, PROGRESS.md, ...
```

## Core data model

These types are the contract every session builds against; Session 02 implements them as Zod schemas in `src/core/schemas` and they change only through a versioned migration.

```ts
// ---------- Saved documents ----------
interface Workspace { schemaVersion: number; projects: Project[]; settings: UserSettings }
interface Project   { id: string; name: string; boardIds: string[]; createdAt: string; updatedAt: string }
interface Board {
  id: string; projectId: string; name: string;
  providerId: 'generic' | 'aws' | 'gcp' | 'azure';  // drives labels, limits, prices
  mode: ModeId;                                       // sandbox | guided | interview | debug | learn | chaos
  problemId?: string;                                 // when practising a Problem
  graph: Graph;
  scenario: Scenario;
  snapshots: { id: string; label: string; at: string; graph: Graph }[];
  lastResult?: SimResult;                             // cached, never authoritative
}

// ---------- The design ----------
interface Graph { nodes: NodeInstance[]; edges: EdgeInstance[]; groups: Group[] }
interface NodeInstance {
  id: string; defId: string;            // -> ComponentDefinition.id, e.g. 'cache.redis'
  label: string; position: { x: number; y: number }; groupId?: string;
  config: Record<string, unknown>;      // validated by def.configSchema
  scaling: { replicas: number; instanceType: string;
             autoscale?: { min: number; max: number; targetUtil: number; warmupSec: number } };
}
interface EdgeInstance {
  id: string; source: string; target: string;  // node ids (+ optional port ids)
  protocolStack: string[];   // bottom-up protocol ids, e.g. ['ip','tcp','tls13','http2']
  sync: boolean;             // request/response vs fire-and-forget
  config: { timeoutMs?: number; retries?: number; backoff?: 'none'|'fixed'|'exp'; poolSize?: number };
}
interface Group { id: string; kind: 'region'|'az'|'vpc'|'subnet'|'cluster'; label: string;
                  regionId?: string; parentId?: string; security?: { public: boolean; firewallRules: Rule[] } }

// ---------- Registry entries ----------
interface ComponentDefinition {
  id: string; name: string; category: Category; tags: string[]; icon: string;
  providerNames?: Partial<Record<ProviderId, string>>;   // 'S3', 'Cloud Storage', 'Blob Storage'
  ports: { id: string; direction: 'in'|'out'|'both'; protocols: string[] }[];
  configSchema: ZodObject;            // drives inspector form
  defaults: Record<string, unknown>;
  instanceTypes: InstanceType[];      // vCPU, memGB, netGbps, $/hr
  perf: PerfModel;                    // see engine section
  behaviors?: BehaviorId[];           // 'cache', 'queue', 'loadBalancer', 'replicatedStore', ...
  docs: { summary: string; howItWorks: string; tradeoffs: string[]; interviewTips: string[] };
  security?: { defaultPorts: number[]; threats: string[]; controls: string[] };
}
interface PerfModel {
  serviceTimeMs: { read: number; write: number };   // per request at 1 vCPU baseline
  maxConcurrencyPerInstance: number;
  scaleCurve: 'linear' | 'sublinear' | 'single-writer';
  saturationBehavior: 'queue' | 'reject' | 'degrade';
}
interface ProtocolDefinition {
  id: string; name: string; osiLayer: 1|2|3|4|5|6|7;
  handshakeRtts: number; perMessageOverheadBytes: number;
  multiplexing: boolean; reliable: boolean; ordered: boolean; encrypted: boolean;
  runsOn: string[];                 // allowed lower protocols
  docs: { summary: string; handshakeSteps: string[]; headerFields: string[]; securityNotes: string[] };
}

// ---------- Traffic & results ----------
interface Scenario {
  usersByRegion: Record<RegionId, number>;      // concurrent users
  flows: Flow[];                                // named request paths with traffic share
  peakMultiplier: number; diurnal: boolean;
  payloadBytes: { req: number; res: number };
  events: ChaosEvent[];                         // outages, spikes, packet loss
  seed: number; durationSec: number;
}
interface Flow { id: string; name: string; share: number; rpsPerUser: number;
                 path: { nodeId: string; op: 'read'|'write'; cacheable?: boolean }[] }
interface SimResult {
  perNode: Record<string, NodeMetrics>; perEdge: Record<string, EdgeMetrics>;
  perFlow: Record<string, { p50: number; p95: number; p99: number; rps: number; errorRate: number }>;
  system: { rps: number; availability: number; costPerMonth: number; bottlenecks: string[] };
  findings: Finding[];      // from review rules: SPOF, missing cache, etc.
  timeline?: TimePoint[];   // for chaos/time-series runs
}
interface NodeMetrics { utilization: number; rpsIn: number; rpsOut: number; queueDepth: number;
                        latencyMs: { p50: number; p95: number; p99: number }; errorRate: number;
                        hitRate?: number; costPerMonth: number; explain: Record<string, string> }
```

`explain` holds the formula and inputs behind each metric, so the UI can show *why* a number is what it is.

**Problem entry** (`defineProblem`) holds: `id`, `title`, `level` (1–5), `tags`, functional and non-functional requirements, scale numbers (DAU, read/write ratio, data size), `scenario` preset, `hints[]` (ordered), `referenceSolutions[]` (each a `Graph`), `rubric[]` (rule ids + weights + SLO targets such as p99 < 200 ms at 50k RPS), and `debugVariants[]` (broken graphs with the expected fix).

## Simulation engine

The engine is an analytical flow model first (instant results, used while editing) with an optional discrete-event mode later (for chaos timelines and tail-latency realism). Both share the same inputs and `SimResult` output.

**Pipeline (one run)**

1. **Compile**: validate the graph, resolve each node's `ComponentDefinition`, expand replicas, attach region from the enclosing group.
2. **Generate load**: for each region and flow, arrival rate = users × rpsPerUser × share × peakMultiplier (× diurnal curve for that region's local time).
3. **Route**: walk each flow's path; split traffic by load-balancer algorithm, cache hit rate, shard key distribution, and geo routing (nearest healthy region).
4. **Per-node queueing**: compute utilisation and waiting time (M/M/c below); saturated nodes queue, reject or degrade per `saturationBehavior`.
5. **Per-edge network cost**: propagation + handshake RTTs + serialisation + protocol overhead (section 6).
6. **Compose latency** along each flow; parallel fan-out takes the max, sequential calls add; retries multiply load on downstream nodes.
7. **Apply chaos events**: remove failed nodes/regions, add packet loss, re-route, recompute.
8. **Cost**: instances × $/hr × 730 + storage + egress per provider price table.
9. **Evaluate**: run review rules, produce findings and bottleneck list.

**Formulas (each shown in the UI's "show formula" tooltip)**

Utilisation of a node with c instances, arrival rate λ and per-instance service rate μ:

```latex
\rho = \frac{\lambda}{c\,\mu}
```

Mean queueing wait (M/M/c, Erlang C), then response time:

```latex
W_q = \frac{C(c, \lambda/\mu)}{c\mu - \lambda}, \qquad T = W_q + \frac{1}{\mu}
```

Percentiles are approximated from the exponential tail of the response time; p99 ≈ T × ln(100) for a single M/M/1 stage, and per-stage percentiles are composed with a documented approximation (sum of means + root-sum-square of tail excess).

Network latency between two points distance d apart (light in fibre ≈ 200 km/ms, route factor ≈ 1.5):

```latex
RTT \approx 2 \cdot \frac{1.5\, d}{200\ \text{km/ms}} + \text{per-hop overhead}
```

Cache: effective downstream load = λ × (1 − hitRate); hitRate comes from a Zipf model of key popularity vs cache size and TTL.

Vertical scaling changes μ (via vCPU and `scaleCurve`); horizontal scaling changes c. A `single-writer` store (e.g. one SQL primary) does not gain write capacity from replicas, only read capacity.

**Geo model.** A built-in table of about 25 cloud regions with lat/long; region-to-region RTT is computed from great-circle distance and can be overridden with measured values. User regions (e.g. North America, Europe, India, SE Asia, LATAM, Africa, Oceania) route to the nearest healthy deployment, or via CDN/edge if present.

**Real-life conditions to model** (each a scenario toggle or chaos event): diurnal traffic per time zone, flash spikes (×10 for N seconds), hot keys / celebrity users, cold starts for serverless, connection-pool exhaustion, GC pauses, replication lag and stale reads, cross-region partitions, AZ and region outages, packet loss and its effect on TCP vs QUIC, DNS TTL failover delay, retry storms and thundering herd, rate-limit rejections, disk full, noisy neighbour.

**Determinism and speed.** Same graph + scenario + seed gives the same result. Analytical runs re-execute on every edit (debounced 300 ms) in the worker; target under 1 s for 300 nodes.

**Behaviors.** Component-specific logic lives in small behavior modules selected by `ComponentDefinition.behaviors`: `loadBalancer` (round-robin, least-conn, consistent hash), `cache` (Zipf hit rate, eviction, TTL), `queue` (partitions, consumer groups, lag = backlog / consume rate), `replicatedStore` (leader/follower, quorum R/W/N, replication lag), `shardedStore` (key distribution, hot shard), `cdn` (edge hit ratio, origin shield), `rateLimiter` (token bucket, sliding window), `serverless` (concurrency limit, cold start), `circuitBreaker`. New behaviors are added as files without touching the core loop.

## Networking and security layer

Every edge carries a real protocol stack, so the user learns what actually travels between components and what it costs in round trips, bytes and risk.

**Protocol catalog (initial)**

| Layer | Protocols | What the app teaches |
| --- | --- | --- |
| 7 Application | HTTP/1.1, HTTP/2, HTTP/3, gRPC, WebSocket, GraphQL, SSE, DNS, SMTP, MQTT, AMQP, Kafka wire, Redis RESP, PostgreSQL/MySQL wire, CQL | Request/response vs streaming, head-of-line blocking, multiplexing, long-lived connections, push vs pull |
| 6/5 Presentation/Session | TLS 1.2, TLS 1.3, mTLS, JSON, Protobuf, Avro | Handshake RTTs (TLS 1.3 = 1 RTT, 0-RTT resumption), certificate chains, serialisation size |
| 4 Transport | TCP, UDP, QUIC | 3-way handshake, congestion control, retransmits under packet loss, connection reuse |
| 3 Network | IPv4, IPv6, ICMP, BGP/Anycast (conceptual) | Routing, NAT, anycast for CDN/DNS, private vs public IP ranges |
| 2/1 Link/Physical | Ethernet, fibre (conceptual) | Bandwidth vs latency, MTU and fragmentation |

**Edge inspector.** Clicking an edge shows the stack bottom-up, handshake sequence, per-request overhead, connection reuse/pooling, encryption status, and typical ports. Invalid stacks (e.g. gRPC over UDP) are blocked by `runsOn`.

**Request trace (packet-flow view).** Pick a flow and a user region; the app animates one request hop by hop: DNS lookup → TCP SYN/SYN-ACK/ACK → TLS ClientHello/ServerHello → HTTP request → LB → service → cache miss → DB → response. A sequence-diagram panel lists each step with its time, layer and key header fields. Toggle "first request" vs "warm connection" to see handshake savings.

**Security model**

- **Zones:** groups mark public internet, DMZ, private subnet, data tier; edges crossing zones show firewall/security-group rules.
- **Controls (components or edge settings):** WAF, API gateway auth (OAuth2/JWT, API keys), mTLS between services, secrets manager, KMS encryption at rest, DDoS protection, rate limiting, bastion/VPN, IAM roles.
- **Threat checks (review rules):** database reachable from internet, plaintext edge carrying user data, no rate limit on public API, single region for critical data, secrets in config, missing auth between services, open admin ports.
- **Attack scenarios (chaos events):** DDoS flood, credential stuffing, MITM on plaintext edge, data exfiltration via over-permissive role. Each shows impact on metrics and which control would have stopped it.
- **Learn panels:** for each protocol and control: how it works, what an attacker sees, common misconfigurations, interview talking points.

## Modes

Six modes share one board and one engine; a mode only changes what help is shown, what is locked, and how success is judged. Each is a `ModeController` with hooks `onEnter`, `onGraphChange`, `onSimResult`, `isComplete`, so new modes are plug-ins too.

| Mode | What the user does | Help shown | Success |
| --- | --- | --- | --- |
| Sandbox | Builds anything freely | Live metrics and review findings, all optional | None; free play |
| Guided | Follows a problem step by step: requirements → estimates → API → data model → high-level design → scale → bottlenecks | Next-step card, hints on request, "why" explanations | Each step's checks pass |
| Interview | Solves a problem against a 45-minute timer, as in a real interview | None until finished; optional AI-free interviewer prompts ("what if traffic grows 10×?") at fixed times | Rubric score: SLOs met, rules passed, cost, plus a self-review checklist |
| Debug | Gets a pre-built design with hidden faults (missing index, SPOF, wrong protocol, cache stampede, hot partition) and symptoms in the metrics | Symptoms only; hints cost points | Faults fixed and SLOs restored |
| Chaos | Runs a time-series simulation and injects failures live (kill AZ, spike traffic, add packet loss) | Timeline of events and recovery | Availability and p99 stay within targets |
| Learn | Short lessons per concept (consistent hashing, CAP, TLS handshake, Kafka partitions) with a mini-board to try it | Step-by-step explanation | Lesson quiz passed |

Scores, attempts and time per problem are stored locally to show progress over time.

## Tech stack and conventions

The stack favours mature, well-documented libraries so any AI session can work on it without extra context.

| Concern | Choice | Why |
| --- | --- | --- |
| Language / build | TypeScript (strict), Vite, pnpm | Fast builds, strong types across modules |
| UI | React 18+, Tailwind CSS, Radix UI primitives | Accessible components, low styling overhead |
| Canvas | React Flow (`@xyflow/react`) | Nodes, edges, groups, pan/zoom, minimap out of the box |
| State | Zustand + Immer, command pattern for undo/redo | Simple, serialisable, testable |
| Schemas | Zod | One source for types, validation and inspector forms |
| Charts | Recharts (or ECharts for heavy time series) | Metrics panels and timelines |
| Map | `react-simple-maps` or a static SVG world map | Region placement and user distribution |
| Simulation | Pure TS in a Web Worker via Comlink | Keeps UI at 60 fps |
| Storage | IndexedDB via Dexie | Local-first saves and snapshots |
| Tests | Vitest (unit), Playwright (e2e smoke) | Engine math and key flows |
| Lint/format | ESLint + Prettier; `eslint-plugin-boundaries` | Enforces module boundaries automatically |

**Conventions**

- Ids are prefixed strings: `node_`, `edge_`, `grp_`, `board_`; registry ids are dotted (`cache.redis`, `proto.http2`, `problem.rate-limiter`).
- Units in names: `latencyMs`, `sizeBytes`, `costUsdPerMonth`, `rps`.
- Every engine function is pure and has a unit test with a hand-computed expected value.
- Every registry entry includes `docs`; a test fails if `summary` is empty.
- UI never imports from `engine/` directly; it calls the worker through `engine/index.ts`.
- Each module has a `README.md` of at most 30 lines: purpose, public API, extension points. Sessions read this instead of the code.

## Roadmap

The MVP is 21 sessions in five phases; Phase 0 and Phase 1 must run in order, while Phases 2–4 can be reordered once the engine exists.

&#91;embedded content: Roadmap · 5 phases, 5 gates\]

Phases are equal-width, not to scale. Each diamond is the check that must pass before the next phase starts.

**After MVP (later, as needed):** discrete-event engine for realistic tail latency, more problems (Google Docs, Dropbox, Ticketmaster, stock exchange, distributed cache, search autocomplete), optional AI interviewer that asks follow-ups and reviews your design, design comparison view (two boards side by side), shareable read-only links, cloud sync with accounts, multiplayer mock interviews, export to PNG/SVG/Mermaid/Terraform skeleton.

## Session prompts

Run these in order, one per session, each pasted under the Context Pack. Sessions in the same phase after S06 can run in any order. Every prompt follows the same shape: Goal, Read, Build, Out of scope, Done when.

### Phase 0 — Foundation

**S01 · Scaffold and docs**

```markdown
TASK S01 — Scaffold the repo and install the spec.
Goal: an empty but correctly structured app that every later session builds on.
Read: docs/SPEC.md. Split sections 1–9 into the docs/ files listed below, then delete SPEC.md.
Build:
- Vite + React + TS strict + pnpm, Tailwind, ESLint/Prettier, Vitest, Playwright.
- Create the full folder structure from the spec with an index.ts and README.md per module.
- Configure eslint-plugin-boundaries with the dependency table from the spec.
- Save the spec into docs/: ARCHITECTURE.md (vision, principles, architecture, stack),
  DATA-MODEL.md, ENGINE.md, NETWORK-SECURITY.md, MODES.md, ROADMAP.md, PROGRESS.md.
- App shell: top bar, left palette area, centre canvas area, right inspector area,
  bottom metrics drawer (empty placeholders).
Out of scope: any real feature.
Done when: pnpm dev shows the shell; pnpm test and pnpm build pass; boundaries lint passes.
```

**S02 · Core schemas and migrations**

```markdown
TASK S02 — Implement the core data model.
Read: docs/DATA-MODEL.md, src/core/.
Build:
- Zod schemas + inferred types for every type in DATA-MODEL.md, in src/core/schemas.
- id helpers (prefixed ids), units helpers.
- Migration framework: schemaVersion, ordered migration functions, migrate(doc) -> latest.
- Fixtures: a sample Workspace with one board (client -> LB -> 2 servers -> DB).
Out of scope: UI, registry contents.
Done when: fixtures parse; invalid docs fail with readable errors; migration test from v0 to v1 passes.
```

**S03 · Registry and plugin API**

```markdown
TASK S03 — Build the registry and seed it.
Read: docs/ARCHITECTURE.md (Extension contract), docs/DATA-MODEL.md, src/core/index.ts.
Build:
- defineComponent / defineProtocol / defineProvider / defineProblem / defineRule /
  defineLesson helpers that validate with Zod.
- Auto-discovery via import.meta.glob; registry API: get(id), list({category, tag, provider}).
- Seed 12 generic components with full docs + perf models: client (web/mobile), DNS,
  CDN, load balancer, API gateway, app server, serverless function, SQL DB, NoSQL DB,
  cache, message queue, object storage.
- Seed 6 protocols: tcp, tls13, http1, http2, grpc, websocket.
- Seed provider 'generic'.
- Test: every entry valid, unique id, non-empty docs.summary.
Out of scope: UI.
Done when: registry tests pass; adding a dummy component file in a test is picked up automatically.
```

**S04 · Canvas editor**

```markdown
TASK S04 — Interactive canvas.
Read: docs/ARCHITECTURE.md, src/core/index.ts, src/registry/index.ts, src/store/README.md.
Build:
- store: board graph state with a command bus (addNode, moveNode, connect, delete,
  updateConfig, group/ungroup) and undo/redo (Ctrl+Z / Ctrl+Shift+Z).
- canvas: React Flow rendering of nodes/edges/groups; palette from registry (search,
  categories, drag to add); connect ports; validate connections by port protocols;
  multi-select, copy/paste, delete, snap-to-grid, minimap, auto-layout (elkjs).
- Group nodes for region / AZ / VPC / subnet; dropping a node inside sets groupId.
- Node shows icon, label, replica count badge.
Out of scope: inspector forms, simulation.
Done when: F1 acceptance check passes manually; command bus has unit tests.
```

**S05 · Inspector**

```markdown
TASK S05 — Schema-driven inspector panel.
Read: src/core/index.ts, src/registry/index.ts, src/store/index.ts.
Build:
- Generate forms from a Zod schema (number with unit + min/max, enum select, boolean,
  string, nested object, array). Basic and Advanced sections (field meta: advanced: true).
- Panels: Node (config, scaling: replicas, instance type, autoscale), Edge (protocol stack
  picker filtered by runsOn, sync/async, timeout, retries), Group, Board scenario (basic).
- "Docs" tab per selection showing definition docs.
Out of scope: metrics.
Done when: editing any field is one undoable command; invalid values show the reason (F5).
```

**S06 · Workspace, tabs and persistence**

```markdown
TASK S06 — Projects, board tabs, saving.
Read: src/core/index.ts, src/store/index.ts, src/persistence/README.md.
Build:
- Project sidebar and board tabs: create, rename, duplicate, delete, reorder.
- Dexie persistence with debounced autosave; load on start; run migrations on load.
- Named snapshots per board (save/restore/diff count).
- Export/import board or whole project as JSON; import validates and migrates.
Out of scope: cloud sync.
Done when: F9 acceptance check passes; Playwright test: create 2 boards, reload, both intact.
```

### Phase 1 — Simulation and metrics

**S07 · Engine core**

```markdown
TASK S07 — Analytical simulation engine.
Read: docs/ENGINE.md, src/core/index.ts, src/registry/index.ts (types only).
Build in src/engine (no React):
- compile(graph, registry) -> internal model; generateLoad(scenario); route(flows);
  queueing (M/M/c with Erlang C); latency composition; SimResult with explain strings.
- Behaviors: loadBalancer, cache (simple fixed hit rate for now), queue (async edges).
- Worker wrapper with Comlink; runSimulation(board) API in engine/index.ts.
- Default flow inference: if scenario has no flows, create one from client nodes along edges.
Out of scope: geo, chaos, cost, UI.
Done when: unit tests with hand-computed values (single server, 2 replicas behind LB,
cache in front of DB) match within 1%.
```

**S08 · Metrics UI**

```markdown
TASK S08 — Show performance.
Read: src/engine/index.ts, src/store/index.ts, src/metrics-ui/README.md.
Build:
- Auto-run simulation on graph/scenario change (debounced 300 ms) and on "Run".
- Node overlays: utilisation colour (green <60%, amber <85%, red), rps, p99 badge.
- Edge overlays: thickness by rps, label with latency.
- Bottom drawer: system KPIs (rps, p50/p95/p99 per flow, error rate, availability,
  cost/month), bottleneck list (click to focus), per-node detail with charts.
- "Show formula" tooltip using SimResult.explain.
Done when: F7 acceptance check passes.
```

**S09 · Horizontal and vertical scaling**

```markdown
TASK S09 — Scaling models.
Read: docs/ENGINE.md (scaling), src/engine/, src/registry/index.ts.
Build:
- Instance type tables (generic small/medium/large/xlarge; vCPU, mem, net, $/hr).
- Vertical: service rate scales with vCPU per scaleCurve.
- Horizontal: replicas, LB algorithms (round-robin, least-conn, consistent hash with
  imbalance), autoscaling (target utilisation, min/max, warm-up) for time-series runs.
- Data scaling: read replicas (reads only), sharding with key skew, partitions.
- Cost model per instance and storage.
- Inspector: "Scale" quick actions (+1 replica, size up/down, add read replica, shard x2).
Done when: F6 acceptance check passes; tests for single-writer DB not gaining write throughput.
```

**S10 · Global users and geo**

```markdown
TASK S10 — Geography and real-world latency.
Read: docs/ENGINE.md (geo, real-life conditions), src/engine/, src/core/index.ts.
Build:
- Region table (~25 cloud regions, lat/long) and user-region table; great-circle RTT.
- Scenario editor: world map to set users per region, diurnal toggle, peak multiplier.
- Region groups on canvas map to real regions; routing to nearest healthy region;
  CDN/edge behavior; cross-region replication lag; geo-DNS.
- Per-region latency breakdown in metrics drawer.
Done when: F8 acceptance check passes.
```

**S11 · Chaos and time-series**

```markdown
TASK S11 — Failures over time.
Read: docs/ENGINE.md, src/engine/, src/metrics-ui/index.ts.
Build:
- Time-stepped run (1 s ticks) reusing the analytical model per tick.
- ChaosEvent types: node/AZ/region down, traffic spike, hot key, packet loss %,
  latency injection, dependency slow, disk full, cold start burst.
- Retry storms, timeouts, circuit breaker behavior, autoscaling reaction.
- Timeline chart with event markers; playback scrubber colours the canvas per tick.
Done when: killing one AZ of a 2-AZ deployment shows a dip and recovery; killing the only DB shows outage.
```

### Phase 2 — Real tools and cloud platforms

**S12 · Cloud provider catalogs**

```markdown
TASK S12 — AWS, GCP, Azure providers.
Read: docs/DATA-MODEL.md (ComponentDefinition.providerNames), src/registry/.
Build:
- defineProvider entries for aws, gcp, azure: regions, instance families, price tables
  (approximate, dated), service limits (e.g. Lambda concurrency, DynamoDB partition limits).
- providerNames mapping for every generic component; provider-only components where
  needed (e.g. SQS/SNS, Pub/Sub, Event Hubs, Aurora, Spanner, Cosmos DB).
- Board provider switcher: relabels nodes, swaps icons, limits and prices; warns where
  no equivalent exists.
Done when: F4 acceptance check passes; all price tables carry an "as of" date.
```

**S13 · Data and messaging tools**

```markdown
TASK S13 — Deep components with real behavior.
Read: docs/ENGINE.md (behaviors), src/registry/, src/engine/behaviors/.
Build component files + behaviors for:
- Kafka (partitions, replication factor, acks, consumer groups, lag, retention),
  RabbitMQ, Redis (cluster, eviction, persistence), Memcached,
  Cassandra (N/R/W quorum, consistent hashing), DynamoDB-style KV, PostgreSQL
  (primary + replicas, indexes on/off), MongoDB, Elasticsearch, ClickHouse,
  ZooKeeper/etcd, Nginx/Envoy, Kubernetes cluster group, service mesh, Prometheus/Grafana.
- Zipf-based cache hit rate replacing fixed hit rate.
Done when: each has docs (howItWorks, tradeoffs, interviewTips) and at least one behavior test.
```

### Phase 3 — Networking and security

**S14 · Protocol catalog and edge inspector**

```markdown
TASK S14 — Protocols on every edge.
Read: docs/NETWORK-SECURITY.md, src/registry/protocols/, src/inspector/.
Build:
- Full protocol catalog from the spec table with handshake, overhead, flags and docs.
- network module: connectionCost(stack, rtt, warm) and perRequestOverhead(stack, payload);
  engine uses it for edge latency; packet loss penalises TCP more than QUIC.
- Edge inspector: OSI stack view, handshake sequence, ports, encryption status, warnings.
- Default stack suggestions per component pair (browser->CDN: HTTP/3; service->Kafka: Kafka wire over TCP).
Done when: switching an edge from HTTP/1.1 to HTTP/2 to HTTP/3 changes cold-request latency by the expected RTTs.
```

**S15 · Request trace view**

```markdown
TASK S15 — Animate one request end to end.
Read: src/network/index.ts, src/engine/index.ts, src/canvas/README.md.
Build:
- traceRequest(board, flowId, userRegion, {warm}) -> ordered steps (layer, from, to,
  message, key headers, timeMs).
- Canvas animation of packets along edges; sequence-diagram side panel; step-through controls.
- Toggle cold vs warm connection; show where time goes (DNS, TCP, TLS, queue, service, DB).
Done when: F10 trace acceptance check passes.
```

**S16 · Security layer**

```markdown
TASK S16 — Zones, controls, threats.
Read: docs/NETWORK-SECURITY.md, src/security/, src/registry/rules/.
Build:
- Zone semantics on groups (public/DMZ/private/data); security-group rules on crossing edges.
- Security components: WAF, DDoS shield, secrets manager, KMS, IAM, bastion/VPN, auth server.
- Threat review rules from the spec, each with severity, explanation and fix.
- Attack chaos events (DDoS, credential stuffing, MITM, exfiltration) with impact on metrics.
- "Security" overlay: colour edges by encryption, nodes by exposure.
Done when: a DB placed in a public zone raises a critical finding with a one-click fix.
```

### Phase 4 — Practice and learning

**S17 · Problem library**

```markdown
TASK S17 — Practice problems.
Read: docs/DATA-MODEL.md (Problem entry), docs/MODES.md, src/registry/problems/.
Build:
- Problem browser (filter by level, tag, company-style).
- 10 problems with requirements, scale numbers, hints, rubric, scenario preset and one
  reference solution each: rate limiter, URL shortener, pastebin, notification service,
  chat (WhatsApp/Discord), news feed (X), Instagram, YouTube, Uber, payment system.
- "Start problem" creates a board with the scenario and mode chosen by the user.
Done when: F3 acceptance check passes.
```

**S18 · Modes**

```markdown
TASK S18 — Sandbox, Guided, Interview, Debug, Chaos, Learn.
Read: docs/MODES.md, src/modes/, src/store/index.ts, src/registry/index.ts.
Build:
- ModeController interface + registry; mode switcher in top bar.
- Guided: step cards (requirements, estimates, API, data model, HLD, scaling, bottlenecks).
- Interview: 45-min timer, hints hidden, timed follow-up prompts, end-of-session scorecard.
- Debug: load a problem's debugVariant, show symptoms, detect fix via rules + SLOs.
- Learn: lesson player with mini-board; seed 5 lessons.
- Progress page: attempts, scores, time per problem.
Done when: F11 acceptance check passes for all six modes.
```

**S19 · Review rules and evaluator**

```markdown
TASK S19 — Design review engine.
Read: src/registry/rules/, src/engine/index.ts.
Build:
- defineRule({id, severity, appliesTo, check(graph, result) -> Finding[], fix?}).
- 20 rules: SPOF, no LB before replicas, no cache on hot read path, sync call to slow
  dependency, missing queue for spiky writes, unbounded retries, no CDN for static media,
  single region for global users, DB connections > pool, hot partition, no rate limiting,
  no idempotency on payments, etc.
- Findings panel with jump-to-node and "apply fix" where safe.
Done when: each rule has a positive and negative test fixture.
```

**S20 · Capacity estimator**

```markdown
TASK S20 — Back-of-envelope calculator.
Read: src/estimator/, src/core/index.ts.
Build: inputs (DAU, actions/user/day, read:write, object size, retention, peak factor,
replication) -> QPS avg/peak, storage/yr, bandwidth in/out, cache size for 20% hot data;
show each formula; "push to scenario" button; latency-numbers-every-engineer-should-know card.
Done when: F12 acceptance check passes.
```

**S21 · Polish**

```markdown
TASK S21 — UX polish and performance.
Build: keyboard shortcut sheet, dark/light theme, command palette (Ctrl+K), 
canvas performance pass to 300 nodes at 60 fps, empty states, error boundaries.

on below points (a,b) first tell user how much change is required, is it just few UI changes or it requires overall redesign
a. make the PROJECTS and PALLETE section collapsible to left side
b. make the METRICS section expandable to upper side for better view, since FAILURES OVER TIMES section is below that 
c. make the INSPECTOR tab collapsible so the main canvas and workflow have more visible space
d. make the canvas minimap hideable, with a clear way to show it again
e. make the REQUEST TRACE box adjustable/resizable so users can enlarge it to inspect network activity in more detail

Before implementation, assess whether these are localized layout/control changes or need
an overall workspace redesign, and tell the user the estimated scope. Preserve the current
workflow when local changes are sufficient. Make panel states easy to discover and
restore; keep resizing usable with keyboard and pointer, and constrain dimensions so the
canvas and trace remain usable at narrow and wide viewports. Persist these view preferences
only if the existing app already has an appropriate preference mechanism.

Done when: Lighthouse accessibility >= 90; perf test with 300-node fixture passes.
```

After S21, add features the same way: write a new prompt with the template in section 11 (new component, protocol, problem or mode) and run it in its own session.

**S22 · Cloud persistence, sign-in and deployment**

```markdown
TASK S22 — Replace browser-only workspace storage with Supabase cloud storage, add sign-in, and deploy the frontend to Vercel.
Read: docs/ARCHITECTURE.md, docs/DATA-MODEL.md, docs/PROGRESS.md, src/persistence/README.md, src/persistence/index.ts, src/app/main.tsx, src/app/README.md.
Before implementation, write a concise design note in the handoff describing the auth/session flow, data ownership model, migration/import path for existing IndexedDB workspaces, and Vercel/Supabase environment configuration. Then implement the design in this session.
Build:
- Add Supabase Auth sign-in/sign-out and session restoration. The app's workspace requires an authenticated user; show clear signed-out/loading/error states and never load another user's data.
- Add a Supabase-backed StorageAdapter (or equivalent persistence boundary) that stores workspace metadata, boards, layouts, and backups with an owner user id. Enforce isolation in the database with Row Level Security policies; client-side filtering alone is not security.
- Replace the app's default Dexie/IndexedDB workspace adapter with the Supabase adapter. Remove browser-based workspace persistence and silent local fallback. Keep browser memory only for live UI state; preserve versioned JSON import/export for portability and backup.
- Provide an explicit, one-time migration path that detects an existing local IndexedDB workspace after sign-in, lets the user import it into their account, validates/migrates it with the existing save format, and confirms before any cloud overwrite. Do not silently discard local data. After successful migration, stop reading/writing the local workspace database.
- Add Vercel deployment configuration for the Vite static build, SPA route fallback if needed, documented environment variables, and safe handling of the Supabase public URL/anon key. Never put a service-role key in frontend code.
- Document local development, Supabase schema/policies setup, deployment, and free-tier limits. Keep schema migrations and data ownership explicit.
Tests: auth state transitions, user-scoped reads/writes, RLS policy/schema expectations where practical, adapter behavior, migration/import success and cancellation, and no local fallback. Run the existing persistence, auth, build and lint checks.
Out of scope: realtime collaboration, multi-user editing/sharing, billing, and changing the board/save-file data model beyond what cloud ownership requires.
Done when: an authenticated user can open, edit, reload, and delete only their own cloud-saved workspace; a second account cannot read or mutate it; an existing local workspace can be deliberately migrated; signed-out users cannot enter workspace editing; JSON export/import still works; deployment and setup instructions are complete.
```

This S22 makes cloud persistence the next session. The earlier S22 suggestion in `docs/PROGRESS.md` about command-palette coverage is deferred as a later follow-up and should not be combined with this work.

## Templates

Use these for everything after the 21 build sessions; each is a complete session prompt once the blanks are filled.

**Add a component**

```markdown
TASK — Add component: <name> (e.g. Apache Pulsar).
Read: docs/DATA-MODEL.md (ComponentDefinition), src/registry/components/<category>/ (one
existing file as an example), src/engine/behaviors/README.md.
Build: one file src/registry/components/<category>/<id>.ts using defineComponent with
ports, configSchema (basic + advanced), instanceTypes, perf model, behaviors, providerNames,
full docs (summary, howItWorks, tradeoffs, interviewTips), security notes.
If it needs new behavior, add src/engine/behaviors/<behavior>.ts + test.
Out of scope: UI changes (there should be none).
Done when: it appears in palette/inspector/engine; registry and behavior tests pass.
```

**Add a protocol**

```markdown
TASK — Add protocol: <name>.
Read: docs/NETWORK-SECURITY.md, src/registry/protocols/http2.ts as an example.
Build: defineProtocol entry (layer, handshakeRtts, overhead, flags, runsOn, docs with
handshakeSteps, headerFields, securityNotes); add trace steps if the handshake is new.
Done when: it can be chosen on a valid edge and appears in the trace view.
```

**Add a practice problem**

```markdown
TASK — Add problem: <title>, level <1-5>.
Read: docs/DATA-MODEL.md (Problem entry), src/registry/problems/instagram/ as an example.
Build: requirements (functional, non-functional), scale numbers, scenario preset with flows,
5 ordered hints, rubric (rules + SLO targets), one reference solution graph, one
debugVariant with the expected fix.
Done when: the reference solution meets its own rubric in the simulator.
```


**Add a sample reference board**

```markdown
TASK — Add a sample reference board: <system name>.
Read: docs/DATA-MODEL.md (Board, Graph, Scenario), docs/ARCHITECTURE.md,
src/registry/components/ (available component definitions), and one existing board or
problem reference solution as an example.
Build: one loadable, clearly named sample board that demonstrates an efficient,
production-minded design and how its components connect. Use the broadest useful set of
available components (including network, security, compute, data, messaging and
observability components where present), while keeping every component on a justified
request, event, control or monitoring path. Do not add components merely to increase the
count. Include:
- A coherent end-to-end user flow plus any asynchronous/background flow needed by the
  system; connect only compatible ports and use valid protocol stacks.
- Appropriate region/AZ and security-zone groups, redundancy, caching, queues, and
  storage choices for the stated workload; avoid unnecessary hops and single points of
  failure.
- Sensible component configs, replica/scaling settings, scenario traffic and payloads so
  the design can be simulated and its bottlenecks are meaningful.
- Clear node labels and a readable left-to-right layout, with related components grouped
  together and flows easy to follow.
- A concise board description or companion notes explaining the main paths, why each
  component is present, key trade-offs, and practical connection patterns users can adapt.
Register or seed the board through the existing sample/reference-board mechanism. Reuse
registry definitions and existing schema/API; do not invent unsupported component
behavior or change public APIs. If no board catalog exists, use the smallest existing
data-driven mechanism that makes the sample discoverable and loadable.
Out of scope: new component types or simulation behavior unless explicitly required for
validating the sample; broad UI redesign.
Done when: a user can load the board as a reference, inspect its connections and
configuration, and run its scenario; the graph validates, the layout is legible, and the
sample exercises most available component categories without compromising the design's
efficiency or coherence.
```

**Add an anti-pattern sample board**

```markdown
TASK — Add an anti-pattern sample board: <system name>.
Read: docs/DATA-MODEL.md (Board, Graph, Scenario), docs/ARCHITECTURE.md,
docs/NETWORK-SECURITY.md, src/registry/components/ (available definitions),
src/registry/rules/ (available review rules), and the sample reference board as an
example of the board loading mechanism.
Build: one loadable, clearly labeled intentionally inefficient and insecure design for
<system name>. It should teach by example: include realistic architecture and security
mistakes that violate best practices, and make the resulting problems inspectable in the
board's review/findings UI. Keep the flaws limited to this teaching fixture; do not
introduce vulnerabilities into the application or its infrastructure. Include:
- A coherent workload and scenario that exercise the flawed paths and produce meaningful
  simulation metrics (latency, saturation, errors, or availability where supported).
- Multiple distinct anti-patterns supported by existing components and review rules,
  such as a public data store, plaintext sensitive traffic, missing authentication or
  rate limiting, exposed admin access, a single point of failure, unbounded retries,
  missing cache for a hot read path, or an overloaded single-instance service. Choose
  flaws that fit the system; do not add arbitrary mistakes just to increase the count.
- Enough deliberate issues to demonstrate security review and each supported finding
  severity/category: ERROR, WARNING, and INFO (or the exact equivalent in the current
  review model). Ensure at least one finding at each level is actually emitted by an
  existing rule; do not fabricate findings or mislabel severity. If the product uses a
  different severity vocabulary, preserve it and document the mapping in the sample
  notes.
- Clear labels or annotations that make this an intentionally broken learning example,
  plus companion notes listing each intended issue, the rule/finding expected, its
  severity, impact, and a practical remediation. Keep the initial board broken so users
  can inspect the review; optionally include a corrected version or guided remediation
  steps if the existing sample mechanism supports them.
- A readable layout that makes risky trust boundaries, exposed components, dependencies,
  and bottlenecks easy to trace. Use valid graph structure and supported protocols so
  findings come from design choices rather than malformed data.
Register or seed the board through the existing sample/reference-board mechanism. Reuse
existing definitions and rules; do not weaken validation or change public APIs. If a
needed finding rule does not exist, list it as a follow-up instead of implementing an
unrelated broad review-system change.
Out of scope: real exploit code, unsafe application defaults, new component types, or
changes to the review engine beyond a narrowly required rule and its tests.
Done when: users can load and simulate the intentionally flawed board, see security and
design findings including ERROR, WARNING, and INFO (or documented equivalents), and use
the notes to understand the risks and how to fix them; the board is valid and the
application remains secure.
```


**Add a mode or review rule**

```markdown
TASK — Add <mode | rule>: <name>.
Read: docs/MODES.md or src/registry/rules/README.md, one existing example.
Build: implement ModeController (onEnter, onGraphChange, onSimResult, isComplete) or
defineRule (check + fix + tests with a passing and failing fixture).
Done when: it shows in the mode switcher / findings panel with tests green.
```

**Change the architecture (rare)**

```markdown
TASK — Architecture change: <what and why>.
Read: docs/ARCHITECTURE.md, docs/DATA-MODEL.md, docs/PROGRESS.md.
First produce a short design note (problem, options, decision, migration impact) and stop
for my approval. Only after approval: implement, add a schema migration if the saved
format changes, update docs/ARCHITECTURE.md.
```

**Handoff note (the AI appends this to `docs/PROGRESS.md` at the end of every session)**

```markdown
## <Session id> — <title> — <date>
Status: done | partial
Changed: <folders/files>
Public APIs added/changed: <function signatures>
Registry entries added: <ids>
Tests: <count added>, all passing
Known gaps / follow-ups: <bullets>
Next suggested session: <id>
```
