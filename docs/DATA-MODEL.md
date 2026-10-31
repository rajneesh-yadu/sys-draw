# SysDraw — Core data model

> Source: `docs/SPEC.MD` (Oct 31, 2026), installed in session S01. This file is the source of truth from now on; change it only through an architecture-change session.

## Core data model

These types are the contract every session builds against; Session 02 implements them as Zod schemas in `src/core/schemas` and they change only through a versioned migration.

```ts
// ---------- Saved documents ----------
interface Workspace {
  schemaVersion: number;
  projects: Project[];
  settings: UserSettings;
}
interface Project {
  id: string;
  name: string;
  boardIds: string[];
  createdAt: string;
  updatedAt: string;
}
interface Board {
  id: string;
  projectId: string;
  name: string;
  providerId: 'generic' | 'aws' | 'gcp' | 'azure'; // drives labels, limits, prices
  mode: ModeId; // sandbox | guided | interview | debug | learn | chaos
  problemId?: string; // when practising a Problem
  graph: Graph;
  scenario: Scenario;
  snapshots: { id: string; label: string; at: string; graph: Graph }[];
  lastResult?: SimResult; // cached, never authoritative
}

// ---------- The design ----------
interface Graph {
  nodes: NodeInstance[];
  edges: EdgeInstance[];
  groups: Group[];
}
interface NodeInstance {
  id: string;
  defId: string; // -> ComponentDefinition.id, e.g. 'cache.redis'
  label: string;
  position: { x: number; y: number };
  groupId?: string;
  config: Record<string, unknown>; // validated by def.configSchema
  scaling: {
    replicas: number;
    instanceType: string;
    autoscale?: { min: number; max: number; targetUtil: number; warmupSec: number };
  };
}
interface EdgeInstance {
  id: string;
  source: string;
  target: string; // node ids (+ optional port ids)
  protocolStack: string[]; // bottom-up protocol ids, e.g. ['ip','tcp','tls13','http2']
  sync: boolean; // request/response vs fire-and-forget
  config: {
    timeoutMs?: number;
    retries?: number;
    backoff?: 'none' | 'fixed' | 'exp';
    poolSize?: number;
  };
}
interface Group {
  id: string;
  kind: 'region' | 'az' | 'vpc' | 'subnet' | 'cluster';
  label: string;
  regionId?: string;
  parentId?: string;
  security?: { public: boolean; firewallRules: Rule[] };
}

// ---------- Registry entries ----------
interface ComponentDefinition {
  id: string;
  name: string;
  category: Category;
  tags: string[];
  icon: string;
  providerNames?: Partial<Record<ProviderId, string>>; // 'S3', 'Cloud Storage', 'Blob Storage'
  ports: { id: string; direction: 'in' | 'out' | 'both'; protocols: string[] }[];
  configSchema: ZodObject; // drives inspector form
  defaults: Record<string, unknown>;
  instanceTypes: InstanceType[]; // vCPU, memGB, netGbps, $/hr
  perf: PerfModel; // see engine section
  behaviors?: BehaviorId[]; // 'cache', 'queue', 'loadBalancer', 'replicatedStore', ...
  docs: { summary: string; howItWorks: string; tradeoffs: string[]; interviewTips: string[] };
  security?: { defaultPorts: number[]; threats: string[]; controls: string[] };
}
interface PerfModel {
  serviceTimeMs: { read: number; write: number }; // per request at 1 vCPU baseline
  maxConcurrencyPerInstance: number;
  scaleCurve: 'linear' | 'sublinear' | 'single-writer';
  saturationBehavior: 'queue' | 'reject' | 'degrade';
}
interface ProtocolDefinition {
  id: string;
  name: string;
  osiLayer: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  handshakeRtts: number;
  perMessageOverheadBytes: number;
  multiplexing: boolean;
  reliable: boolean;
  ordered: boolean;
  encrypted: boolean;
  runsOn: string[]; // allowed lower protocols
  docs: {
    summary: string;
    handshakeSteps: string[];
    headerFields: string[];
    securityNotes: string[];
  };
}

// ---------- Traffic & results ----------
interface Scenario {
  usersByRegion: Record<RegionId, number>; // concurrent users
  flows: Flow[]; // named request paths with traffic share
  peakMultiplier: number;
  diurnal: boolean;
  payloadBytes: { req: number; res: number };
  events: ChaosEvent[]; // outages, spikes, packet loss
  seed: number;
  durationSec: number;
}
interface Flow {
  id: string;
  name: string;
  share: number;
  rpsPerUser: number;
  path: { nodeId: string; op: 'read' | 'write'; cacheable?: boolean }[];
}
interface SimResult {
  perNode: Record<string, NodeMetrics>;
  perEdge: Record<string, EdgeMetrics>;
  perFlow: Record<
    string,
    { p50: number; p95: number; p99: number; rps: number; errorRate: number }
  >;
  system: { rps: number; availability: number; costPerMonth: number; bottlenecks: string[] };
  findings: Finding[]; // from review rules: SPOF, missing cache, etc.
  timeline?: TimePoint[]; // for chaos/time-series runs
}
interface NodeMetrics {
  utilization: number;
  rpsIn: number;
  rpsOut: number;
  queueDepth: number;
  latencyMs: { p50: number; p95: number; p99: number };
  errorRate: number;
  hitRate?: number;
  costPerMonth: number;
  explain: Record<string, string>;
}
```

`explain` holds the formula and inputs behind each metric, so the UI can show _why_ a number is what it is.

**Problem entry** (`defineProblem`) holds: `id`, `title`, `level` (1–5), `tags`, functional and non-functional requirements, scale numbers (DAU, read/write ratio, data size), `scenario` preset, `hints[]` (ordered), `referenceSolutions[]` (each a `Graph`), `rubric[]` (rule ids + weights + SLO targets such as p99 < 200 ms at 50k RPS), and `debugVariants[]` (broken graphs with the expected fix).
