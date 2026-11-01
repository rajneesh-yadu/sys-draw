/**
 * S19 — design-review rules on the real registry. Done-when: every rule has a positive fixture (it
 * reports) and a negative fixture (it stays quiet); rules with a one-click fix are also checked to
 * pass once their fix plan is applied.
 */
import { describe, expect, it } from 'vitest';
import type {
  EdgeInstance,
  Graph,
  Group,
  NodeInstance,
  NodeMetrics,
  Scenario,
  SimResult,
} from '@/core';
import { registry } from '../index';
import type { FixPlan, RuleContext, RuleDefinition } from '../schemas';

// ---------- fixture builders ----------

interface NodeOpts {
  label?: string;
  replicas?: number;
  autoscale?: NonNullable<NodeInstance['scaling']['autoscale']>;
  config?: Record<string, unknown>;
  group?: string;
}
function node(id: string, defId: string, o: NodeOpts = {}): NodeInstance {
  const def = registry.require(defId, 'component');
  return {
    id: `node_${id}`,
    defId,
    label: o.label ?? id,
    position: { x: 0, y: 0 },
    ...(o.group ? { groupId: `grp_${o.group}` } : {}),
    config: { ...def.defaults, ...o.config },
    scaling: {
      replicas: o.replicas ?? 1,
      instanceType: def.instanceTypes[0]!.id,
      ...(o.autoscale ? { autoscale: o.autoscale } : {}),
    },
  };
}
function edge(
  s: string,
  t: string,
  o: { sync?: boolean; config?: EdgeInstance['config'] } = {},
): EdgeInstance {
  return {
    id: `edge_${s}_${t}`,
    source: `node_${s}`,
    target: `node_${t}`,
    protocolStack: ['tcp', 'tls13', 'http1'],
    sync: o.sync ?? true,
    config: o.config ?? {},
  };
}
function group(id: string, kind: Group['kind'], extra: Partial<Group> = {}): Group {
  return { id: `grp_${id}`, kind, label: id, ...extra };
}
const graph = (nodes: NodeInstance[], edges: EdgeInstance[] = [], groups: Group[] = []): Graph => ({
  nodes,
  edges,
  groups,
});

function scenario(patch: Partial<Scenario> = {}): Scenario {
  return {
    usersByRegion: { 'north-america': 100_000 },
    flows: [],
    peakMultiplier: 1,
    diurnal: false,
    payloadBytes: { req: 1000, res: 1000 },
    events: [],
    seed: 1,
    durationSec: 600,
    ...patch,
  };
}

interface FakeMetrics {
  utilization?: number;
  rpsIn?: number;
  p99?: number;
}
function result(perNode: Record<string, FakeMetrics>, extra: Partial<SimResult> = {}): SimResult {
  const metrics = (m: FakeMetrics): NodeMetrics => ({
    utilization: m.utilization ?? 0.3,
    rpsIn: m.rpsIn ?? 100,
    rpsOut: m.rpsIn ?? 100,
    queueDepth: 0,
    latencyMs: { p50: (m.p99 ?? 20) / 3, p95: (m.p99 ?? 20) / 1.5, p99: m.p99 ?? 20 },
    errorRate: 0,
    costPerMonth: 0,
    explain: {},
  });
  return {
    perNode: Object.fromEntries(
      Object.entries(perNode).map(([id, m]) => [`node_${id}`, metrics(m)]),
    ),
    perEdge: {},
    perFlow: {},
    system: { rps: 0, availability: 1, costPerMonth: 0, bottlenecks: [] },
    findings: [],
    ...extra,
  };
}

function ctx(g: Graph, extra: { scenario?: Scenario; result?: SimResult } = {}): RuleContext {
  return {
    graph: g,
    ...extra,
    components: { get: (id) => registry.get(id, 'component') },
    protocols: { get: (id) => registry.get(id, 'protocol') },
  };
}

const rule = (id: string) => registry.require(id, 'rule') as RuleDefinition;
const check = (id: string, c: RuleContext) => rule(id).check(c);

/** Applies a fix plan structurally (the app maps it onto store commands). */
function applyPlan(g: Graph, plan: FixPlan): Graph {
  const out = structuredClone(g);
  let seq = 0;
  for (const s of plan.steps) {
    switch (s.kind) {
      case 'setNodeConfig':
        out.nodes = out.nodes.map((n) =>
          n.id === s.nodeId ? { ...n, config: { ...n.config, ...s.config } } : n,
        );
        break;
      case 'setNodeScaling':
        out.nodes = out.nodes.map((n) => {
          if (n.id !== s.nodeId) return n;
          const scaling = {
            ...n.scaling,
            ...(s.replicas !== undefined ? { replicas: s.replicas } : {}),
          };
          if (s.autoscale === null) delete scaling.autoscale;
          else if (s.autoscale !== undefined) scaling.autoscale = s.autoscale;
          return { ...n, scaling };
        });
        break;
      case 'setEdgeConfig':
        out.edges = out.edges.map((e) => {
          if (e.id !== s.edgeId) return e;
          const config: Record<string, unknown> = { ...e.config };
          for (const [k, v] of Object.entries(s.config)) {
            if (v === null) delete config[k];
            else config[k] = v;
          }
          return { ...e, config: config as EdgeInstance['config'] };
        });
        break;
      case 'insertOnEdge': {
        const e = out.edges.find((x) => x.id === s.edgeId)!;
        const id = `fix${++seq}`;
        out.nodes.push(node(id, s.defId, { label: s.label }));
        out.edges = out.edges.filter((x) => x.id !== e.id);
        out.edges.push(
          { ...e, id: `edge_a${seq}`, target: `node_${id}` },
          { ...e, id: `edge_b${seq}`, source: `node_${id}` },
        );
        break;
      }
      case 'addNode': {
        const id = `fix${++seq}`;
        out.nodes.push(node(id, s.defId, { label: s.label }));
        for (const from of s.connectFrom)
          out.edges.push({ ...edge('x', id), id: `edge_c${seq}_${from}`, source: from });
        break;
      }
      default:
        throw new Error(`step ${s.kind} not used by these rules`);
    }
  }
  return out;
}

/** The rule reports something; applying the fix of its first finding makes it quiet. */
function expectFixClears(id: string, c: RuleContext) {
  const [f] = check(id, c);
  expect(f).toBeDefined();
  const plan = rule(id).fix?.(c, f!);
  expect(plan?.steps.length).toBeGreaterThan(0);
  const fixed = applyPlan(c.graph, plan!);
  expect(check(id, { ...c, graph: fixed }).filter((x) => x.title === f!.title)).toEqual([]);
  return plan!;
}

const S19_RULES = [
  'rule.spof',
  'rule.no-lb-before-replicas',
  'rule.no-cache-hot-read',
  'rule.sync-slow-dependency',
  'rule.no-queue-spiky-writes',
  'rule.unbounded-retries',
  'rule.no-cdn-static-media',
  'rule.single-region-global-users',
  'rule.db-connections-exceed-limit',
  'rule.hot-partition',
  'rule.no-idempotency-payments',
  'rule.no-timeout-sync-call',
  'rule.no-circuit-breaker',
  'rule.overloaded-node',
  'rule.no-autoscaling',
  'rule.stateful-servers',
  'rule.db-missing-index',
  'rule.single-az',
  'rule.queue-without-consumer',
  'rule.cross-region-sync-call',
];

// Shared shapes.
const LB = 'network.load-balancer';
const APP = 'compute.app-server';
const PG = 'database.postgres';

describe('S19 design rules: catalog', () => {
  it('ships 20 design rules, each documented and with findings pointing at its own id', () => {
    expect(S19_RULES).toHaveLength(20);
    for (const id of S19_RULES) {
      const r = rule(id);
      expect(r.docs.summary.length, id).toBeGreaterThan(0);
      expect(r.docs.howToFix.length, id).toBeGreaterThan(0);
      expect(r.category, id).not.toBe('security');
    }
  });

  it('every positive fixture below is covered (one describe per rule)', () => {
    expect(Object.keys(FIXTURES).sort()).toEqual([...S19_RULES].sort());
  });
});

/** Positive (reports ≥ 1 finding) and negative (reports none) fixtures, per rule. */
const FIXTURES: Record<string, { positive: () => RuleContext; negative: () => RuleContext }> = {
  'rule.spof': {
    positive: () =>
      ctx(
        graph(
          [
            node('c', 'client.app'),
            node('app', APP),
            node('db', PG, { config: { highAvailability: false } }),
          ],
          [edge('c', 'app'), edge('app', 'db')],
        ),
      ),
    negative: () =>
      ctx(
        graph(
          [
            node('c', 'client.app'),
            node('lb', LB),
            node('app', APP, { replicas: 2 }),
            node('db', PG),
          ],
          [edge('c', 'lb'), edge('lb', 'app'), edge('app', 'db')],
        ),
      ),
  },
  'rule.no-lb-before-replicas': {
    positive: () =>
      ctx(graph([node('c', 'client.app'), node('app', APP, { replicas: 3 })], [edge('c', 'app')])),
    negative: () =>
      ctx(
        graph(
          [node('c', 'client.app'), node('lb', LB), node('app', APP, { replicas: 3 })],
          [edge('c', 'lb'), edge('lb', 'app')],
        ),
      ),
  },
  'rule.no-cache-hot-read': {
    positive: () =>
      ctx(graph([node('app', APP), node('db', PG)], [edge('app', 'db')]), {
        result: result({ db: { rpsIn: 5000, utilization: 0.5 } }),
      }),
    negative: () =>
      ctx(
        graph(
          [node('app', APP), node('cache', 'cache.redis'), node('db', PG)],
          [edge('app', 'cache'), edge('app', 'db')],
        ),
        { result: result({ db: { rpsIn: 5000, utilization: 0.5 } }) },
      ),
  },
  'rule.sync-slow-dependency': {
    positive: () =>
      ctx(
        graph(
          [node('c', 'client.app'), node('api', APP), node('report', APP)],
          [edge('c', 'api'), edge('api', 'report')],
        ),
        { result: result({ report: { p99: 800 } }) },
      ),
    negative: () =>
      ctx(
        graph(
          [node('c', 'client.app'), node('api', APP), node('report', APP)],
          [edge('c', 'api'), edge('api', 'report', { sync: false })],
        ),
        { result: result({ report: { p99: 800 } }) },
      ),
  },
  'rule.no-queue-spiky-writes': {
    positive: () =>
      ctx(graph([node('api', APP), node('db', PG)], [edge('api', 'db')]), {
        scenario: scenario({
          peakMultiplier: 4,
          flows: [
            {
              id: 'flow_w',
              name: 'Write',
              share: 1,
              rpsPerUser: 0.1,
              path: [{ nodeId: 'node_db', op: 'write' }],
            },
          ],
        }),
      }),
    negative: () =>
      ctx(
        graph(
          [node('api', APP), node('q', 'messaging.queue'), node('worker', APP), node('db', PG)],
          [edge('api', 'q'), edge('q', 'worker'), edge('worker', 'db')],
        ),
        {
          scenario: scenario({
            peakMultiplier: 4,
            flows: [
              {
                id: 'flow_w',
                name: 'Write',
                share: 1,
                rpsPerUser: 0.1,
                path: [{ nodeId: 'node_db', op: 'write' }],
              },
            ],
          }),
        },
      ),
  },
  'rule.unbounded-retries': {
    positive: () =>
      ctx(
        graph(
          [node('a', APP), node('b', APP)],
          [edge('a', 'b', { config: { retries: 5, backoff: 'none' } })],
        ),
      ),
    negative: () =>
      ctx(
        graph(
          [node('a', APP), node('b', APP)],
          [edge('a', 'b', { config: { retries: 2, backoff: 'exp' } })],
        ),
      ),
  },
  'rule.no-cdn-static-media': {
    positive: () =>
      ctx(graph([node('c', 'client.app'), node('s3', 'storage.object')], [edge('c', 's3')])),
    negative: () =>
      ctx(
        graph(
          [node('c', 'client.app'), node('cdn', 'network.cdn'), node('s3', 'storage.object')],
          [edge('c', 'cdn'), edge('cdn', 's3')],
        ),
      ),
  },
  'rule.single-region-global-users': {
    positive: () =>
      ctx(
        graph(
          [node('app', APP, { group: 'use' })],
          [],
          [group('use', 'region', { regionId: 'us-east' })],
        ),
        {
          scenario: scenario({ usersByRegion: { 'north-america': 500, india: 500 } }),
        },
      ),
    negative: () =>
      ctx(
        graph(
          [node('app', APP, { group: 'use' }), node('app2', APP, { group: 'aps' })],
          [],
          [
            group('use', 'region', { regionId: 'us-east' }),
            group('aps', 'region', { regionId: 'ap-south' }),
          ],
        ),
        { scenario: scenario({ usersByRegion: { 'north-america': 500, india: 500 } }) },
      ),
  },
  'rule.db-connections-exceed-limit': {
    positive: () =>
      ctx(
        graph(
          [node('app', APP, { replicas: 30 }), node('db', 'database.sql')],
          [edge('app', 'db')],
        ),
      ),
    negative: () =>
      ctx(
        graph(
          [node('app', APP, { replicas: 10 }), node('db', 'database.sql')],
          [edge('app', 'db')],
        ),
      ),
  },
  'rule.hot-partition': {
    positive: () =>
      ctx(graph([node('kv', 'database.kv-store', { config: { partitions: 4, hotKeySkew: 0.6 } })])),
    negative: () =>
      ctx(graph([node('kv', 'database.kv-store', { config: { partitions: 4, hotKeySkew: 0.3 } })])),
  },
  'rule.no-idempotency-payments': {
    positive: () => ctx(graph([node('pay', APP, { label: 'Payments API' })])),
    negative: () =>
      ctx(
        graph(
          [
            node('pay', APP, { label: 'Payments API' }),
            node('keys', 'database.kv-store', { label: 'Idempotency keys' }),
          ],
          [edge('pay', 'keys')],
        ),
      ),
  },
  'rule.no-timeout-sync-call': {
    positive: () => ctx(graph([node('a', APP), node('b', APP)], [edge('a', 'b')])),
    negative: () =>
      ctx(
        graph([node('a', APP), node('b', APP)], [edge('a', 'b', { config: { timeoutMs: 500 } })]),
      ),
  },
  'rule.no-circuit-breaker': {
    positive: () =>
      ctx(graph([node('a', APP), node('b', APP)], [edge('a', 'b', { config: { retries: 2 } })])),
    negative: () =>
      ctx(
        graph(
          [node('a', APP), node('b', APP)],
          [edge('a', 'b', { config: { retries: 2, breakerErrorThreshold: 0.5 } })],
        ),
      ),
  },
  'rule.overloaded-node': {
    positive: () =>
      ctx(graph([node('app', APP, { replicas: 2 })]), {
        result: result({ app: { utilization: 0.95 } }),
      }),
    negative: () =>
      ctx(graph([node('app', APP, { replicas: 2 })]), {
        result: result({ app: { utilization: 0.5 } }),
      }),
  },
  'rule.no-autoscaling': {
    positive: () =>
      ctx(graph([node('app', APP, { replicas: 8 })]), { scenario: scenario({ diurnal: true }) }),
    negative: () =>
      ctx(
        graph([
          node('app', APP, { autoscale: { min: 2, max: 8, targetUtil: 0.6, warmupSec: 60 } }),
        ]),
        { scenario: scenario({ diurnal: true }) },
      ),
  },
  'rule.stateful-servers': {
    positive: () => ctx(graph([node('app', APP, { replicas: 2, config: { stateless: false } })])),
    negative: () => ctx(graph([node('app', APP, { replicas: 2 }), node('lb', LB)])),
  },
  'rule.db-missing-index': {
    positive: () => ctx(graph([node('db', PG, { config: { queryUsesIndex: false } })])),
    negative: () => ctx(graph([node('db', PG)])),
  },
  'rule.single-az': {
    positive: () =>
      ctx(
        graph(
          [node('app', APP, { group: 'a' }), node('db', PG, { group: 'a' })],
          [],
          [group('a', 'az')],
        ),
      ),
    negative: () =>
      ctx(
        graph(
          [node('app', APP, { group: 'a' }), node('db', PG, { group: 'b' })],
          [],
          [group('a', 'az'), group('b', 'az')],
        ),
      ),
  },
  'rule.queue-without-consumer': {
    positive: () =>
      ctx(graph([node('api', APP), node('q', 'messaging.queue')], [edge('api', 'q')])),
    negative: () =>
      ctx(
        graph(
          [node('api', APP), node('q', 'messaging.queue'), node('w', APP)],
          [edge('api', 'q'), edge('q', 'w')],
        ),
      ),
  },
  'rule.cross-region-sync-call': {
    positive: () =>
      ctx(
        graph(
          [
            node('c', 'client.app'),
            node('app', APP, { group: 'eu' }),
            node('db', PG, { group: 'us' }),
          ],
          [edge('c', 'app'), edge('app', 'db')],
          [
            group('eu', 'region', { regionId: 'eu-west' }),
            group('us', 'region', { regionId: 'us-east' }),
          ],
        ),
      ),
    negative: () =>
      ctx(
        graph(
          [
            node('c', 'client.app'),
            node('app', APP, { group: 'eu' }),
            node('db', PG, { group: 'eu' }),
          ],
          [edge('c', 'app'), edge('app', 'db')],
          [group('eu', 'region', { regionId: 'eu-west' })],
        ),
      ),
  },
};

describe.each(S19_RULES)('%s', (id) => {
  it('positive fixture: reports a finding with this rule id', () => {
    const found = check(id, FIXTURES[id]!.positive());
    expect(found.length).toBeGreaterThan(0);
    for (const f of found) {
      expect(f.ruleId).toBe(id);
      expect(f.title.length).toBeGreaterThan(0);
      expect(f.message.length).toBeGreaterThan(0);
    }
  });
  it('negative fixture: reports nothing', () => {
    expect(check(id, FIXTURES[id]!.negative())).toEqual([]);
  });
});

// ---------- details and fixes ----------

describe('S19 design rules: details and one-click fixes', () => {
  it('spof: flags the lone app server and the database without a standby; fixes both', () => {
    const c = FIXTURES['rule.spof']!.positive();
    expect(
      check('rule.spof', c)
        .map((f) => f.targetIds[0])
        .sort(),
    ).toEqual(['node_app', 'node_db']);
    const plan = expectFixClears('rule.spof', c);
    // app: 2 replicas + a load balancer on the client edge (or the DB standby, whichever is first)
    expect(plan.steps.map((s) => s.kind)).toEqual(
      expect.arrayContaining([expect.stringMatching(/setNodeScaling|setNodeConfig/)]),
    );
    const db = check('rule.spof', c).find((f) => f.targetIds[0] === 'node_db')!;
    expect(rule('rule.spof').fix!(c, db)!.steps).toEqual([
      { kind: 'setNodeConfig', nodeId: 'node_db', config: { highAvailability: true } },
    ]);
    const app = check('rule.spof', c).find((f) => f.targetIds[0] === 'node_app')!;
    expect(rule('rule.spof').fix!(c, app)!.steps.map((s) => s.kind)).toEqual([
      'setNodeScaling',
      'insertOnEdge',
    ]);
  });

  it('spof: managed services and unreachable components are not flagged', () => {
    const c = ctx(
      graph(
        [
          node('c', 'client.app'),
          node('lb', LB),
          node('q', 'messaging.queue'),
          node('lonely', APP),
        ],
        [edge('c', 'lb')],
      ),
    );
    expect(check('rule.spof', c)).toEqual([]);
  });

  it('spof: no fix for a stateful server', () => {
    const c = ctx(
      graph(
        [node('c', 'client.app'), node('app', APP, { config: { stateless: false } })],
        [edge('c', 'app')],
      ),
    );
    const [f] = check('rule.spof', c);
    expect(rule('rule.spof').fix!(c, f!)).toBeUndefined();
  });

  it('no-lb-before-replicas: fix inserts a load balancer', () => {
    const plan = expectFixClears(
      'rule.no-lb-before-replicas',
      FIXTURES['rule.no-lb-before-replicas']!.positive(),
    );
    expect(plan.steps[0]).toMatchObject({ kind: 'insertOnEdge', defId: LB });
  });

  it('no-lb-before-replicas: queue consumers and single instances are fine', () => {
    const c = ctx(
      graph(
        [node('q', 'messaging.queue'), node('w', APP, { replicas: 4 }), node('one', APP)],
        [edge('q', 'w'), edge('w', 'one')],
      ),
    );
    expect(check('rule.no-lb-before-replicas', c)).toEqual([]);
  });

  it('no-cache-hot-read: quiet without a result, on a cold DB, or on a write-heavy DB; fix adds a cache', () => {
    const g = FIXTURES['rule.no-cache-hot-read']!.positive().graph;
    expect(check('rule.no-cache-hot-read', ctx(g))).toEqual([]);
    expect(
      check('rule.no-cache-hot-read', ctx(g, { result: result({ db: { rpsIn: 50 } }) })),
    ).toEqual([]);
    const writes = scenario({
      flows: [
        {
          id: 'flow_w',
          name: 'W',
          share: 1,
          rpsPerUser: 1,
          path: [{ nodeId: 'node_db', op: 'write' }],
        },
      ],
    });
    expect(
      check(
        'rule.no-cache-hot-read',
        ctx(g, { result: result({ db: { rpsIn: 5000 } }), scenario: writes }),
      ),
    ).toEqual([]);
    const plan = expectFixClears(
      'rule.no-cache-hot-read',
      FIXTURES['rule.no-cache-hot-read']!.positive(),
    );
    expect(plan.steps[0]).toMatchObject({
      kind: 'addNode',
      defId: 'cache.redis',
      connectFrom: ['node_app'],
    });
  });

  it('sync-slow-dependency: a fast dependency is fine', () => {
    const c = {
      ...FIXTURES['rule.sync-slow-dependency']!.positive(),
      result: result({ report: { p99: 80 } }),
    };
    expect(check('rule.sync-slow-dependency', c)).toEqual([]);
  });

  it('no-queue-spiky-writes: steady traffic is fine; a 2× spike event counts as spiky', () => {
    const c = FIXTURES['rule.no-queue-spiky-writes']!.positive();
    const steady = { ...c, scenario: { ...c.scenario!, peakMultiplier: 1.5 } };
    expect(check('rule.no-queue-spiky-writes', steady)).toEqual([]);
    const spike = {
      ...steady,
      scenario: {
        ...steady.scenario,
        events: [{ id: 'event_s', kind: 'trafficSpike' as const, atSec: 10, multiplier: 2.5 }],
      },
    };
    expect(check('rule.no-queue-spiky-writes', spike)).toHaveLength(1);
  });

  it('unbounded-retries: too many retries without backoff is an error; fix caps at 3 with exp backoff', () => {
    const c = FIXTURES['rule.unbounded-retries']!.positive();
    expect(check('rule.unbounded-retries', c)[0]!.severity).toBe('error');
    const plan = expectFixClears('rule.unbounded-retries', c);
    expect(plan.steps).toEqual([
      { kind: 'setEdgeConfig', edgeId: 'edge_a_b', config: { retries: 3, backoff: 'exp' } },
    ]);
  });

  it('no-cdn-static-media: fix inserts a CDN', () => {
    const plan = expectFixClears(
      'rule.no-cdn-static-media',
      FIXTURES['rule.no-cdn-static-media']!.positive(),
    );
    expect(plan.steps[0]).toMatchObject({ kind: 'insertOnEdge', defId: 'network.cdn' });
  });

  it('single-region-global-users: nearby users and unplaced boards are not judged', () => {
    const c = FIXTURES['rule.single-region-global-users']!.positive();
    expect(
      check('rule.single-region-global-users', {
        ...c,
        scenario: scenario({ usersByRegion: { 'north-america': 900, india: 50 } }),
      }),
    ).toEqual([]);
    expect(
      check('rule.single-region-global-users', { ...c, graph: graph([node('app', APP)]) }),
    ).toEqual([]);
  });

  it('db-connections-exceed-limit: counts instances × pool at the autoscaling max; fixes Postgres with pooling', () => {
    const [f] = check(
      'rule.db-connections-exceed-limit',
      FIXTURES['rule.db-connections-exceed-limit']!.positive(),
    );
    expect(f!.title).toContain('600');
    const auto = ctx(
      graph(
        [
          node('app', APP, { autoscale: { min: 2, max: 40, targetUtil: 0.6, warmupSec: 60 } }),
          node('db', 'database.sql'),
        ],
        [edge('app', 'db', { config: { poolSize: 5 } })],
      ),
    );
    expect(check('rule.db-connections-exceed-limit', auto)).toEqual([]); // 40 × 5 = 200 ≤ 500
    expect(rule('rule.db-connections-exceed-limit').fix!(auto, f!)).toBeUndefined();
    const pg = ctx(
      graph(
        [
          node('app', APP, { replicas: 6 }),
          node('db', PG, { config: { connectionPooling: false } }),
        ],
        [edge('app', 'db')],
      ),
    );
    const plan = expectFixClears('rule.db-connections-exceed-limit', pg);
    expect(plan.steps).toEqual([
      { kind: 'setNodeConfig', nodeId: 'node_db', config: { connectionPooling: true } },
    ]);
  });

  it('hot-partition: Kafka keySkew counts; saturated partitions are errors', () => {
    const kafka = ctx(graph([node('k', 'messaging.kafka', { config: { keySkew: 0.5 } })]), {
      result: result({ k: { utilization: 0.9 } }),
    });
    const [f] = check('rule.hot-partition', kafka);
    expect(f!.severity).toBe('error');
    expect(f!.message).toContain('12 partitions');
  });

  it('no-idempotency-payments: only payment-like services; fix adds a key store', () => {
    expect(
      check('rule.no-idempotency-payments', ctx(graph([node('feed', APP, { label: 'Feed API' })]))),
    ).toEqual([]);
    const plan = expectFixClears(
      'rule.no-idempotency-payments',
      FIXTURES['rule.no-idempotency-payments']!.positive(),
    );
    expect(plan.steps[0]).toMatchObject({
      kind: 'addNode',
      label: 'Idempotency keys',
      connectFrom: ['node_pay'],
    });
  });

  it('no-timeout-sync-call: fix uses 3 × the callee p99 when known, else 1 s', () => {
    const c = FIXTURES['rule.no-timeout-sync-call']!.positive();
    expect(expectFixClears('rule.no-timeout-sync-call', c).steps[0]).toMatchObject({
      config: { timeoutMs: 1000 },
    });
    const withResult = { ...c, result: result({ b: { p99: 120 } }) };
    expect(expectFixClears('rule.no-timeout-sync-call', withResult).steps[0]).toMatchObject({
      config: { timeoutMs: 400 },
    });
  });

  it('no-circuit-breaker: fix adds a breaker', () => {
    expectFixClears('rule.no-circuit-breaker', FIXTURES['rule.no-circuit-breaker']!.positive());
  });

  it('overloaded-node: ≥ 100 % is critical; fix scales to ~60 %', () => {
    const c = FIXTURES['rule.overloaded-node']!.positive();
    const [f] = check('rule.overloaded-node', c);
    expect(f!.severity).toBe('error');
    expect(rule('rule.overloaded-node').fix!(c, f!)!.steps).toEqual([
      { kind: 'setNodeScaling', nodeId: 'node_app', replicas: 4 }, // ⌈2 × 0.95 / 0.6⌉
    ]);
    const sat = { ...c, result: result({ app: { utilization: 1.3 } }) };
    expect(check('rule.overloaded-node', sat)[0]!.severity).toBe('critical');
    const db = ctx(graph([node('db', PG)]), { result: result({ db: { utilization: 0.9 } }) });
    const [g] = check('rule.overloaded-node', db);
    expect(rule('rule.overloaded-node').fix!(db, g!)).toBeUndefined(); // no automatic DB fix
  });

  it('no-autoscaling: steady traffic is fine; fix autoscales between ¼ of the fleet and its size', () => {
    const c = FIXTURES['rule.no-autoscaling']!.positive();
    expect(check('rule.no-autoscaling', { ...c, scenario: scenario() })).toEqual([]);
    const plan = expectFixClears('rule.no-autoscaling', c);
    expect(plan.steps[0]).toMatchObject({ autoscale: { min: 2, max: 8, targetUtil: 0.6 } });
  });

  it('stateful-servers: sticky load balancers are flagged too', () => {
    const c = ctx(graph([node('lb', LB, { config: { stickySessions: true } })]));
    expect(check('rule.stateful-servers', c)).toHaveLength(1);
  });

  it('db-missing-index: small tables are fine; fix turns the index on', () => {
    const small = ctx(
      graph([node('db', PG, { config: { queryUsesIndex: false, tableRows: 5000 } })]),
    );
    expect(check('rule.db-missing-index', small)).toEqual([]);
    expectFixClears('rule.db-missing-index', FIXTURES['rule.db-missing-index']!.positive());
  });

  it('single-az: boards without AZ groups are not judged', () => {
    expect(check('rule.single-az', ctx(graph([node('app', APP), node('db', PG)])))).toEqual([]);
  });

  it('queue-without-consumer: fix adds a worker', () => {
    expectFixClears(
      'rule.queue-without-consumer',
      FIXTURES['rule.queue-without-consumer']!.positive(),
    );
  });

  it('cross-region-sync-call: store-to-store replication is exempt', () => {
    const c = ctx(
      graph(
        [node('c', 'client.app'), node('a', PG, { group: 'eu' }), node('b', PG, { group: 'us' })],
        [edge('c', 'a'), edge('a', 'b')],
        [
          group('eu', 'region', { regionId: 'eu-west' }),
          group('us', 'region', { regionId: 'us-east' }),
        ],
      ),
    );
    expect(check('rule.cross-region-sync-call', c)).toEqual([]);
  });
});
