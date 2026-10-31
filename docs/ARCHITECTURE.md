# SysDraw — Architecture

> Source: `docs/SPEC.MD` (Oct 31, 2026), installed in session S01. This file is the source of truth from now on; change it only through an architecture-change session.

Contents: product vision and principles, feature requirements, architecture and module boundaries, tech stack and conventions. Detail lives in DATA-MODEL.md, ENGINE.md, NETWORK-SECURITY.md, MODES.md, ROADMAP.md; progress in PROGRESS.md.

## Product vision

SysDraw is a flight simulator for system design: you draw a system, throw realistic global traffic at it, watch where it breaks, and fix it — from a rate limiter up to Instagram, X or Discord.

**Target user:** an engineer preparing for system design interviews, or learning distributed systems, networking and security by doing.

**Core principles** (every session must respect these)

1. **Data over code.** A new component, cloud service, protocol, practice problem or review rule is a registry entry, not a UI change. Adding Kafka should mean adding one file.
2. **Model, view, engine are separate.** The design (graph) is pure data; the canvas only renders it; the engine only reads it and returns metrics.
3. **Approximate but honest.** Use established models (queueing theory, speed-of-light latency, published instance specs) and show the formula behind every number. Educational accuracy beats false precision.
4. **Progressive depth.** Every component works with defaults in 10 seconds, and exposes advanced knobs (partitions, consistency level, TLS version) when the user expands it.
5. **Explain everything.** Every component, protocol and metric has a "Why / How it works" panel.
6. **Offline-first, local-first.** Runs fully in the browser; saves to IndexedDB; export/import JSON. A backend is optional later.

**Glossary**

| Term                | Meaning                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| Workspace           | All of a user's projects, stored locally                                                                  |
| Project             | A named folder of boards (e.g. "Instagram practice")                                                      |
| Board               | One tab/page: a single design canvas with its own graph, scenario and results                             |
| Node                | A placed component instance (e.g. `api-server-1`)                                                         |
| Edge                | A connection between two nodes, carrying one or more protocols                                            |
| ComponentDefinition | Registry entry describing a component type: ports, config schema, performance model, docs                 |
| Group               | A container node: region, availability zone, VPC, subnet, cluster                                         |
| Scenario            | The traffic and conditions to simulate: users per region, request mix, read/write ratio, growth, failures |
| Flow                | A named request path, e.g. "Post photo" or "Load feed", with its share of traffic                         |
| Problem             | A practice question: requirements, constraints, hints, reference solutions, evaluation rubric             |
| Mode                | How the user is guided: Sandbox, Guided, Interview, Debug, Learn                                          |

## Feature requirements

Each requirement below maps one of your 11 features to the module that owns it and a testable acceptance check. IDs (F1…F12) are referenced by the session prompts.

| ID  | Feature                                                                                                                                                                                                                                            | Owning module                               | Acceptance check                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Visual system design illustrator: drag components from a palette, connect them, group them in regions/VPCs, pan/zoom, undo/redo, copy/paste, auto-layout                                                                                           | `canvas`, `store`                           | Build a 6-node design (client → CDN → LB → 2 servers → DB) in under 60 s; undo 20 steps works                                                       |
| F2  | Progressive extensibility: new components, providers, protocols, problems, rules added as registry files with no UI changes                                                                                                                        | `registry`                                  | Adding a new component file makes it appear in palette, inspector and engine with zero other edits                                                  |
| F3  | Practice problems from basic to complex: rate limiter, URL shortener, chat, news feed, Instagram, X, Discord, YouTube, Uber, payment system                                                                                                        | `problems`                                  | 10 problems ship; each has requirements, scale numbers, hints and at least one reference design that loads onto a board                             |
| F4  | Cloud platforms and tools: choose AWS / GCP / Azure / generic; real products (EC2, Lambda, DynamoDB, Pub/Sub, Kafka, Redis, Cassandra, Elasticsearch, S3, CloudFront, etc.)                                                                        | `registry/providers`, `registry/components` | Switching a board's provider relabels generic nodes to provider equivalents (e.g. Object Store → S3 / GCS / Blob) and swaps their limits and prices |
| F5  | Configurable components: every node has a schema-driven config (instance type, replicas, cache size, TTL, partitions, replication factor, consistency, timeouts, retries)                                                                          | `inspector`, `registry`                     | Inspector form is generated from the Zod schema; invalid values are blocked with a reason                                                           |
| F6  | Horizontal and vertical scaling: replica count, autoscaling policy, instance size, sharding, read replicas, partitions                                                                                                                             | `engine/scaling`, `inspector`               | Doubling replicas behind an LB roughly halves utilisation; changing instance size changes capacity and cost                                         |
| F7  | Performance view: per-node and end-to-end latency (p50/p95/p99), throughput, utilisation, queue depth, error rate, cache hit rate, cost/month; bottleneck highlight                                                                                | `engine`, `metrics-ui`                      | Overloaded node turns red; system panel shows p99 per flow; every number has a "show formula" tooltip                                               |
| F8  | Global users and real-life conditions: users per region, distance latency, CDN/edge, cross-region replication lag, diurnal peaks, traffic spikes, packet loss, partitions, outages, cold starts, thundering herd                                   | `engine/geo`, `engine/chaos`, `scenario`    | Moving 40% of users to Asia with servers only in us-east raises their p50 by roughly the trans-Pacific RTT; adding an ap-south region fixes it      |
| F9  | Multiple pages/tabs, saved: projects with many boards, rename/duplicate/delete, autosave, version snapshots, import/export JSON                                                                                                                    | `workspace`, `persistence`                  | Reload the browser: all boards return exactly; exported JSON re-imports on a fresh profile                                                          |
| F10 | Networking and security understanding: protocol per edge (HTTP/1.1, HTTP/2, HTTP/3/QUIC, gRPC, WebSocket, TCP, UDP, DNS, TLS, AMQP, Kafka wire, SQL wire), OSI layer view, request trace animation, handshake costs, security controls and threats | `network`, `security`, `trace-ui`           | Clicking an edge shows its protocol stack, handshake RTTs and headers; a trace animates DNS → TCP → TLS → HTTP for one request                      |
| F11 | Modes: Sandbox (free build), Guided (step-by-step), Interview (timed, no hints, scored), Debug (broken system to fix), Learn (concept lessons), Chaos (inject failures)                                                                            | `modes`                                     | Each mode can be entered on any board; Debug mode loads a broken design and confirms when it's fixed                                                |
| F12 | Capacity estimation helper: back-of-envelope calculator (QPS, storage, bandwidth) linked to the scenario                                                                                                                                           | `estimator`                                 | Entering DAU 100M, 10 reads/user/day gives \~11.6k avg QPS and the value can be pushed into the scenario                                            |

**Non-functional requirements**

- Canvas stays at 60 fps with 300 nodes; a simulation of 300 nodes finishes in under 1 s in the worker.
- Works offline after first load; no account required.
- Keyboard accessible: every palette and inspector action reachable without a mouse.
- Save format is versioned (`schemaVersion`) with forward migrations, so old boards never break as features are added.

## Architecture

SysDraw is a client-only app in five layers; the registry is the extension point that keeps every later feature a data file instead of a UI rewrite.

```
 UI layer        canvas · inspector · metrics-ui · modes · problems · estimator   (React)
                   │ dispatch commands / read state
 State layer     store (Zustand + Immer, command bus, undo/redo) ── persistence (IndexedDB)
                   │ frozen board snapshot          ▲ SimResult
 Logic layer     engine (Web Worker) · network · security                         (pure TS)
                   │ lookups
 Extension layer registry (components, providers, protocols, problems, rules, lessons)
                   │ validated by
 Contract layer  core (Zod schemas, ids, units, migrations)
```

`app` is the composition root that mounts the UI modules into the shell.

The UI never computes metrics and the engine never touches React: the store sends the engine a frozen board snapshot and gets results back. The store autosaves to IndexedDB.

**Module boundaries** (each is a folder with an `index.ts` public API; nothing imports another module's internals)

| Module        | Owns                                                                                      | Depends on                    |
| ------------- | ----------------------------------------------------------------------------------------- | ----------------------------- |
| `core`        | Zod schemas and types (section 4), ids, units, migrations                                 | nothing                       |
| `registry`    | Loading and validating all registry entries; lookup by id/tag/provider                    | `core`                        |
| `store`       | Workspace/project/board state, command bus (every edit is an undoable command), selection | `core`, `registry`            |
| `canvas`      | React Flow rendering, palette, groups, edge drawing, overlays (heatmap, badges)           | `store`, `registry`           |
| `inspector`   | Schema-driven forms for nodes, edges, groups, scenario                                    | `store`, `registry`           |
| `engine`      | Simulation (section 5): pure functions + worker wrapper                                   | `core`, `registry`            |
| `network`     | Protocol stacks, handshake/overhead math, trace generation (section 6)                    | `core`, `registry`            |
| `security`    | Security controls, zone model, threat checks                                              | `core`, `registry`            |
| `metrics-ui`  | Dashboards, per-node panels, charts, formula tooltips                                     | `store`                       |
| `modes`       | Sandbox/Guided/Interview/Debug/Learn/Chaos controllers                                    | `store`, `registry`, `engine` |
| `problems`    | Problem library UI, reference-solution loader                                             | `registry`, `store`           |
| `estimator`   | Back-of-envelope calculator                                                               | `core`                        |
| `persistence` | IndexedDB adapter, import/export, autosave, snapshots                                     | `core`, `store`               |

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
  engine/          model/, queueing/, geo/, scaling/, chaos/, cost/, behaviors/, worker.ts
  network/
  security/
  metrics-ui/
  modes/
  problems/
  estimator/
  persistence/
  app/             main.tsx (entry), index.css, layout/, routing, theme, shortcuts
docs/              ARCHITECTURE.md, DATA-MODEL.md, ENGINE.md, PROGRESS.md, ...
```

**Enforcement.** The dependency table above is mirrored in `MODULE_DEPENDENCIES` in `eslint.config.js` and enforced by `eslint-plugin-boundaries` (`pnpm lint`): a module may import only the modules listed for it, and only through their `index.ts`. `app` (composition root) may import any module. `src/engine` and `src/core` may not import React. `tests/boundaries.test.ts` fails if the lint config stops enforcing this. Change the table only together with this doc.

## Tech stack and conventions

The stack favours mature, well-documented libraries so any AI session can work on it without extra context.

| Concern          | Choice                                         | Why                                                    |
| ---------------- | ---------------------------------------------- | ------------------------------------------------------ |
| Language / build | TypeScript (strict), Vite, pnpm                | Fast builds, strong types across modules               |
| UI               | React 18+, Tailwind CSS, Radix UI primitives   | Accessible components, low styling overhead            |
| Canvas           | React Flow (`@xyflow/react`)                   | Nodes, edges, groups, pan/zoom, minimap out of the box |
| State            | Zustand + Immer, command pattern for undo/redo | Simple, serialisable, testable                         |
| Schemas          | Zod                                            | One source for types, validation and inspector forms   |
| Charts           | Recharts (or ECharts for heavy time series)    | Metrics panels and timelines                           |
| Map              | `react-simple-maps` or a static SVG world map  | Region placement and user distribution                 |
| Simulation       | Pure TS in a Web Worker via Comlink            | Keeps UI at 60 fps                                     |
| Storage          | IndexedDB via Dexie                            | Local-first saves and snapshots                        |
| Tests            | Vitest (unit), Playwright (e2e smoke)          | Engine math and key flows                              |
| Lint/format      | ESLint + Prettier; `eslint-plugin-boundaries`  | Enforces module boundaries automatically               |

**Conventions**

- Ids are prefixed strings: `node_`, `edge_`, `grp_`, `board_`; registry ids are dotted (`cache.redis`, `proto.http2`, `problem.rate-limiter`).
- Units in names: `latencyMs`, `sizeBytes`, `costUsdPerMonth`, `rps`.
- Every engine function is pure and has a unit test with a hand-computed expected value.
- Every registry entry includes `docs`; a test fails if `summary` is empty.
- UI never imports from `engine/` directly; it calls the worker through `engine/index.ts`.
- Each module has a `README.md` of at most 30 lines: purpose, public API, extension points. Sessions read this instead of the code.
