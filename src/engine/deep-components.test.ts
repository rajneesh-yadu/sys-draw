/**
 * S13 — deep components: each real component's behavior, with hand-computed expected values.
 * Service times come from the registry files; `work` = serviceTimeMs (capacity, ρ),
 * `wait` = responseServiceMs (what the caller waits for besides queueing).
 */
import { describe, expect, it } from 'vitest';
import { SimResultSchema, type SimResult } from '@/core';
import { registry } from '@/registry';
import { groupLag } from './behaviors/queue';
import { cacheCapacityItems, cacheModel } from './behaviors/cache';
import { zipfHitRate } from './behaviors/lib/zipf';
import { compile } from './model/compile';
import { DEFAULT_ENGINE_OPTIONS, type CompiledNode, type NodeStats } from './model/types';
import { simulate } from './simulate';
import { edge, flow, graph, node, scenario } from './test-fixtures';

function close(actual: number | undefined, expected: number, tol = 0.01) {
  expect(actual).toBeDefined();
  const a = actual as number;
  const err = expected === 0 ? Math.abs(a) : Math.abs(a - expected) / Math.abs(expected);
  expect(err, `${a} vs ${expected}`).toBeLessThanOrEqual(tol);
}

/** Compile one real component with config overrides. */
function one(
  defId: string,
  config: Record<string, unknown> = {},
  replicas = 1,
  instanceType?: string,
): CompiledNode {
  const def = registry.require(defId, 'component');
  const type = instanceType ?? def.instanceTypes[0]?.id ?? 'small';
  const m = compile(graph([node('x', defId, replicas, config, type)], []), registry);
  expect(m.issues).toEqual([]);
  return m.nodes.get('node_x') as CompiledNode;
}

function run(g: ReturnType<typeof graph>, sc: ReturnType<typeof scenario>): SimResult {
  const r = simulate({ graph: g, scenario: sc }, registry);
  expect(SimResultSchema.safeParse(r).success).toBe(true);
  return r;
}

const wait = (n: CompiledNode) => n.responseServiceMs ?? n.serviceTimeMs;

describe('Kafka (queue: partitions, consumer groups, lag, replication, acks)', () => {
  it('followers multiply broker work by RF; acks sets what the producer waits for', () => {
    // S_w = 1 ms; RF 3 ⇒ work 3 ms. acks=1: wait 1 ms; acks=all: + 2 ms follower round trip.
    const a1 = one('messaging.kafka', { acks: '1' });
    expect(a1.serviceTimeMs).toEqual({ read: 0.5, write: 3 });
    expect(wait(a1)).toEqual({ read: 0.5, write: 1 });
    expect(wait(one('messaging.kafka', { acks: 'all' })).write).toBeCloseTo(3, 9);
    expect(one('messaging.kafka', { replicationFactor: 1, acks: '1' }).serviceTimeMs.write).toBe(1);
  });

  it('group lag: parallelism capped by partitions and by the hottest partition', () => {
    const consumer = { node: { id: 'c' }, replicas: 4, capacityRps: 1000 } as NodeStats;
    // P = 2 < 4 instances ⇒ 2 active ⇒ drain 500; backlog = (800 − 500) × 60 = 18 000; 2 idle.
    expect(groupLag(consumer, 800, 2, 0.5, 60)).toEqual({
      nodeId: 'c',
      drainRps: 500,
      backlog: 18_000,
      idle: 2,
      hotLimited: false,
    });
    // P = 4, hottest partition 50%: one consumer (250 rps) must take half ⇒ drain 500.
    const hot = groupLag(consumer, 800, 4, 0.5, 60);
    expect(hot.drainRps).toBe(500);
    expect(hot.hotLimited).toBe(true);
  });

  it('a consumer group with fewer partitions than consumers falls behind', () => {
    // 12 000 msg/s. Consumer = 4 app servers, writes S = 40 ms, c = 200 ⇒ 5 000 rps each,
    // 20 000 total, but 2 partitions ⇒ 2 active ⇒ drain 10 000 ⇒ lag (12 000 − 10 000) × 60 = 120 000.
    const g = graph(
      [
        node('p', 'client.app'),
        node('k', 'messaging.kafka', 1, { partitions: 2 }, 'small'),
        node('c', 'compute.app-server', 4, {}, 'small'),
      ],
      [edge('p', 'k'), edge('k', 'c', false)],
    );
    const r = run(g, scenario(12_000, [flow('w', ['p', 'k', 'c'], 'write')]));
    const k = r.perNode.node_k;
    expect(k?.explain.lag).toContain('2 consumer(s) idle');
    close(k?.queueDepth, 120_000, 0.02);
    // the producer only waits for the enqueue: flow latency excludes the consumer
    expect(r.perFlow.flow_w?.p50).toBeLessThan(20);
  });

  it('warns when retention outgrows the provisioned disk', () => {
    // 1 000 msg/s × 1 000 B × 168 h × 3600 = 604.8 GB per copy > 100 GB.
    const g = graph(
      [node('p', 'client.app'), node('k', 'messaging.kafka', 1, { storageGb: 100 }, 'small')],
      [edge('p', 'k')],
    );
    const k = run(g, scenario(1000, [flow('w', ['p', 'k'], 'write')])).perNode.node_k;
    expect(k?.explain.retention).toContain('604.8 GB');
    expect(k?.explain.retention).toContain('run out of disk');
  });
});

describe('RabbitMQ (queue + configPerf)', () => {
  it('quorum queues, persistence and confirms cost writes', () => {
    // S_w = 0.25: work × 1.6 (Raft) × 1.5 (disk) = 0.6 ms; wait = 0.6 + 1 + 0.5 = 2.1 ms.
    const n = one('messaging.rabbitmq');
    close(n.serviceTimeMs.write, 0.6, 1e-9);
    close(wait(n).write, 2.1, 1e-9);
    const fast = one('messaging.rabbitmq', {
      queueType: 'classic',
      persistent: false,
      publisherConfirms: false,
    });
    expect(fast.serviceTimeMs.write).toBe(0.25);
  });

  it('competing consumers drain together (work queue, no partitions)', () => {
    const g = graph(
      [
        node('p', 'client.app'),
        node('q', 'messaging.rabbitmq', 1, {}, 'small'),
        node('c', 'compute.app-server', 1, {}, 'small'),
      ],
      [edge('p', 'q'), edge('q', 'c', false)],
    );
    const r = run(g, scenario(100, [flow('w', ['p', 'q', 'c'], 'write')]));
    expect(r.perNode.node_q?.explain.lag).toContain('no backlog');
    expect(r.perNode.node_q?.explain.configEffects).toContain('queueType = quorum');
  });
});

describe('Redis (Zipf cache, replicas, persistence)', () => {
  it('hit rate comes from key popularity vs memory', () => {
    // mem-medium 32 GiB × 1 shard × 0.75 ÷ (1024 + 64) B = 23 685 481 items of 50 M keys.
    const n = one('cache.redis');
    expect(cacheCapacityItems(n)).toBe(23_685_481);
    const m = cacheModel(n, DEFAULT_ENGINE_OPTIONS);
    expect(m.source).toBe('zipf');
    close(m.hitRate, zipfHitRate(50_000_000, 23_685_481, 0.8, 'lru'), 1e-12);
    expect(m.hitRate).toBeGreaterThan(0.6);
    expect(m.hitRate).toBeLessThan(1);
    // 4 shards hold everything; LFU beats LRU at the same size
    expect(cacheModel(one('cache.redis', { shards: 4 }), DEFAULT_ENGINE_OPTIONS).hitRate).toBe(1);
    expect(
      cacheModel(one('cache.redis', { evictionPolicy: 'allkeys-lfu' }), DEFAULT_ENGINE_OPTIONS)
        .hitRate,
    ).toBeGreaterThan(m.hitRate);
    // an explicit hitRate still overrides
    expect(cacheModel(one('cache.redis', { hitRate: 0.5 }), DEFAULT_ENGINE_OPTIONS).hitRate).toBe(
      0.5,
    );
  });

  it('only misses reach the database (cache-aside)', () => {
    const g = graph(
      [
        node('c', 'client.app'),
        node('app', 'compute.app-server', 4, {}, 'small'),
        node('r', 'cache.redis', 1, {}, 'mem-medium'),
        node('db', 'database.postgres', 1, { readReplicas: 2 }, 'small'),
      ],
      [edge('c', 'app'), edge('app', 'r'), edge('app', 'db')],
    );
    const r = run(g, scenario(1000, [flow('read', ['c', 'app', 'r', 'db'])]));
    const h = r.perNode.node_r?.hitRate as number;
    close(r.perNode.node_db?.rpsIn, 1000 * (1 - h));
    expect(r.perNode.node_r?.explain.hitRate).toContain("Che's approximation");
  });

  it('replicas serve reads only with readPreference = replicas; aof-always slows writes', () => {
    const primary = one('cache.redis', { replicasPerShard: 2 });
    expect(primary.scale.readReplicas).toBe(0);
    expect(primary.scale.standby).toBe(2);
    expect(
      one('cache.redis', { replicasPerShard: 2, readPreference: 'replicas' }).scale.readReplicas,
    ).toBe(2);
    close(one('cache.redis', { persistence: 'aof-always' }).serviceTimeMs.write, 0.075, 1e-9);
  });
});

describe('Memcached (Zipf cache over consistent-hashed nodes)', () => {
  it('memory adds up across nodes', () => {
    // 1 node: 32 GiB × 0.9 ÷ 1088 B = 28 422 577 items < 50 M keys ⇒ h < 1.
    const n1 = one('cache.memcached', { nodes: 1 });
    expect(cacheCapacityItems(n1)).toBe(28_422_577);
    expect(cacheModel(n1, DEFAULT_ENGINE_OPTIONS).hitRate).toBeLessThan(1);
    // 2 nodes: 56 845 155 ≥ 50 M ⇒ everything fits.
    expect(cacheModel(one('cache.memcached', { nodes: 2 }), DEFAULT_ENGINE_OPTIONS).hitRate).toBe(
      1,
    );
  });
});

describe('Cassandra (quorum N/R/W, consistent hashing)', () => {
  it('work and wait follow R, W and N', () => {
    // N = 3, R = W = 2. S_r = 2, S_w = 0.5. Work: read 2 × 2 = 4, write 3 × 0.5 = 1.5.
    // Wait: read = slowest of 2 = 2 × (1 + 1/2) = 3; write = 2nd fastest of 3 = 0.5 × (1/3 + 1/2).
    const n = one('database.cassandra', {}, 3, 'small');
    expect(n.serviceTimeMs).toEqual({ read: 4, write: 1.5 });
    close(wait(n).read, 3, 1e-9);
    close(wait(n).write, 0.5 * (1 / 3 + 1 / 2), 1e-9);
    expect(n.scale.hashVirtualNodes).toBe(16);
    const fast = one('database.cassandra', { readConsistency: 'ONE', writeConsistency: 'ONE' }, 3);
    close(wait(fast).write, 0.5 / 3, 1e-9);
    expect(fast.serviceTimeMs.read).toBe(2);
  });

  it('reports consistency and spreads load with ring imbalance', () => {
    // 1 000 reads/s on 3 nodes, work 4 ms, c = 32. Hottest node f = 1 + √(2 ln 3 / 16) = 1.37056:
    // λ_hot = 1000 × 1.37056 / 3 = 456.85 ⇒ ρ = 456.85 × 0.004 / 32 = 0.057107.
    const g = graph(
      [node('c', 'client.app'), node('db', 'database.cassandra', 3, {}, 'small')],
      [edge('c', 'db')],
    );
    const r = run(g, scenario(1000, [flow('r', ['c', 'db'])]));
    close(r.perNode.node_db?.utilization, 0.057107);
    expect(r.perNode.node_db?.explain.quorum).toContain('R + W = 4 > N');
    const weak = run(
      graph(
        [
          node('c', 'client.app'),
          node(
            'db',
            'database.cassandra',
            3,
            { readConsistency: 'ONE', writeConsistency: 'ONE' },
            'small',
          ),
        ],
        [edge('c', 'db')],
      ),
      scenario(10, [flow('r', ['c', 'db'])]),
    );
    expect(weak.perNode.node_db?.explain.quorum).toContain('eventual consistency');
  });

  it('caps N at the cluster size', () => {
    const n = one('database.cassandra', { readConsistency: 'ALL' }, 2);
    expect(n.serviceTimeMs.read).toBe(4); // R = N = 2
  });
});

describe('DynamoDB-style KV store (partition budgets)', () => {
  it('derives partitions and per-partition capacity from units', () => {
    // 50 GB ⇒ ⌈50/10⌉ = 5 partitions (> 4 configured). c = 100.
    // Eventual 1 KB read = 0.5 RU ⇒ work = 100 × 1000 × 0.5 / 3000 = 16.667 ms (6 000 reads/s per partition).
    // Write with 1 GSI = 2 WU ⇒ work = 100 × 1000 × 2 / 1000 = 200 ms (500 writes/s per partition).
    const n = one('database.kv-store');
    expect(n.scale.shards).toBe(5);
    close(n.serviceTimeMs.read, 16.6667);
    close(n.serviceTimeMs.write, 200, 1e-9);
    expect(wait(n)).toEqual({ read: 4, write: 6 });
    close(one('database.kv-store', { readConsistency: 'strong' }).serviceTimeMs.read, 33.3333);
  });

  it('a hot key throttles its partition while the table is far from full', () => {
    // 3 000 writes/s, 50% on one key: hot partition gets 1 500 > 500 ⇒ 1 000 rejected;
    // the other 4 get 375 each (fine) ⇒ error rate 1 000 / 3 000 = 33.3%.
    const g = graph(
      [node('c', 'client.app'), node('kv', 'database.kv-store', 1, { hotKeySkew: 0.5 }, 'managed')],
      [edge('c', 'kv')],
    );
    const r = run(g, scenario(3000, [flow('w', ['c', 'kv'], 'write')]));
    close(r.perNode.node_kv?.errorRate, 1 / 3);
    expect(r.perNode.node_kv?.explain.partitions).toContain('throttled');
  });
});

describe('PostgreSQL (indexes on/off, write amplification, sync replication)', () => {
  it('a missing index turns lookups into table scans', () => {
    // index off: 2 + 10 000 000 / 5 000 = 2 002 ms of work per read.
    expect(one('database.postgres', { queryUsesIndex: false }).serviceTimeMs.read).toBe(2002);
    expect(one('database.postgres').serviceTimeMs.read).toBe(2);
    const g = (indexed: boolean) =>
      graph(
        [
          node('c', 'client.app'),
          node('db', 'database.postgres', 1, { queryUsesIndex: indexed }, 'small'),
        ],
        [edge('c', 'db')],
      );
    const sc = scenario(20, [flow('r', ['c', 'db'])]);
    expect(run(g(false), sc).system.bottlenecks).toEqual(['node_db']);
    expect(run(g(true), sc).perNode.node_db?.utilization).toBeLessThan(0.01);
  });

  it('indexes slow writes; sync replication waits for a standby', () => {
    // 2 secondary indexes: 4 × (1 + 0.3 × 2) = 6.4 ms; sync: wait 6.4 + 1 + 4 = 11.4 ms.
    const n = one('database.postgres', { replication: 'sync' });
    close(n.serviceTimeMs.write, 6.4, 1e-9);
    close(wait(n).write, 11.4, 1e-9);
    close(one('database.postgres').serviceTimeMs.write, 6.4, 1e-9);
    close(wait(one('database.postgres')).write, 6.4, 1e-9);
  });
});

describe('MongoDB (replica sets, read preference, write concern)', () => {
  it('readPreference decides whether secondaries add read capacity', () => {
    const p = one('database.mongodb');
    expect(p.scale.readReplicas).toBe(0);
    expect(p.scale.standby).toBe(2);
    expect(
      one('database.mongodb', { readPreference: 'secondaryPreferred' }).scale.readReplicas,
    ).toBe(2);
  });

  it('w:majority waits for replication, w:1 does not', () => {
    expect(wait(one('database.mongodb')).write).toBe(4.5); // 3 + 1.5
    expect(wait(one('database.mongodb', { writeConcern: 'w1' })).write).toBe(3);
    expect(one('database.mongodb').serviceTimeMs.write).toBe(3);
  });
});

describe('Elasticsearch (scatter-gather over shards)', () => {
  it('a search runs on every shard and waits for the slowest', () => {
    // P = 3, 1 replica, S_r = 5, S_w = 2. Search work 15, wait 5 × H_3 = 9.1667.
    // Index work 2 × 2 = 4, wait 2 + 2 × H_1 = 4.
    const n = one('database.elasticsearch', {}, 3);
    expect(n.serviceTimeMs).toEqual({ read: 15, write: 4 });
    close(wait(n).read, 5 * (1 + 1 / 2 + 1 / 3), 1e-9);
    expect(wait(n).write).toBe(4);
    expect(n.scale.storageCopies).toBe(2);
    expect(one('database.elasticsearch', { queryType: 'term' }, 3).serviceTimeMs.read).toBe(7.5);
  });

  it('explains the fan-out and refresh delay', () => {
    const g = graph(
      [node('c', 'client.app'), node('es', 'database.elasticsearch', 3, {}, 'mem-medium')],
      [edge('c', 'es')],
    );
    const s = run(g, scenario(10, [flow('r', ['c', 'es'])])).perNode.node_es;
    expect(s?.explain.shards).toContain('fans out to all 3 shards');
    expect(s?.explain.shards).toContain('every 1 s');
  });
});

describe('ClickHouse (columnar scans, batched inserts)', () => {
  it('query work ∝ rows × columns ÷ cores', () => {
    // 1e8 rows × 3 cols / (50 000 values/ms × 2 vCPU) = 3 000 ms + 5 ms overhead.
    expect(one('database.clickhouse').serviceTimeMs.read).toBe(3005);
    // 8× the vCPU (xlarge, linear) ⇒ 8× faster.
    close(one('database.clickhouse', {}, 1, 'xlarge').serviceTimeMs.read, 3005 / 8, 1e-9);
    // inserts: 10 + 50 000 / 200 000 = 10.25 ms
    expect(one('database.clickhouse').serviceTimeMs.write).toBe(10.25);
  });

  it('warns about many small inserts', () => {
    const g = graph(
      [
        node('c', 'client.app'),
        node('ch', 'database.clickhouse', 1, { rowsPerInsert: 10 }, 'small'),
      ],
      [edge('c', 'ch')],
    );
    const s = run(g, scenario(50, [flow('w', ['c', 'ch'], 'write')])).perNode.node_ch;
    expect(s?.explain.inserts).toContain('too many parts');
  });
});

describe('ZooKeeper / etcd (consensus)', () => {
  it('commits wait for a majority; members never add write capacity', () => {
    // 3 members: commit = S_w × (1 + fastest of 2 followers) = 2 × 1.5 = 3 ms;
    // linearizable read: 0.3 × 1.5 = 0.45 ms, only the leader serves.
    const n3 = one('database.coordination');
    close(wait(n3).write, 3, 1e-9);
    close(wait(n3).read, 0.45, 1e-9);
    expect(n3.scale.readReplicas).toBe(0);
    expect(n3.scale.standby).toBe(2);
    // 5 members: 2 × (1 + 1/3 + 1/4) = 3.1667 ms
    close(wait(one('database.coordination', { members: 5 })).write, 2 * (1 + 1 / 3 + 1 / 4), 1e-9);
    // local reads: every member serves
    const local = one('database.coordination', { readMode: 'local' });
    expect(local.scale.readReplicas).toBe(2);
    expect(wait(local).read).toBe(0.3);
  });

  it('write capacity is one leader whatever the ensemble size', () => {
    const cap = (members: number) => {
      const g = graph(
        [node('c', 'client.app'), node('zk', 'database.coordination', 1, { members }, 'small')],
        [edge('c', 'zk')],
      );
      return run(g, scenario(100, [flow('w', ['c', 'zk'], 'write')])).perNode.node_zk;
    };
    // c = 8, S_w = 2 ms ⇒ 4 000 writes/s for 3 or 5 members
    close(cap(3)?.utilization, 100 / 4000);
    close(cap(5)?.utilization, 100 / 4000);
    expect(cap(4)?.explain.consensus).toContain('even ensemble');
  });
});

describe('Reverse proxy (Nginx / Envoy)', () => {
  it('TLS termination and connection reuse change its cost', () => {
    // 0.1 ms × 1.6 (TLS) = 0.16; no keep-alive: × 1.3 = 0.208 work, + 0.5 ms wait.
    close(one('network.reverse-proxy').serviceTimeMs.read, 0.16, 1e-9);
    const cold = one('network.reverse-proxy', { upstreamKeepalive: false });
    close(cold.serviceTimeMs.read, 0.208, 1e-9);
    close(wait(cold).read, 0.708, 1e-9);
  });

  it('load-balances upstreams like an LB', () => {
    const g = graph(
      [
        node('c', 'client.app'),
        node('px', 'network.reverse-proxy', 1, { algorithm: 'round-robin' }, 'small'),
        node('a', 'compute.app-server', 1, {}, 'small'),
        node('b', 'compute.app-server', 3, {}, 'small'),
      ],
      [edge('c', 'px'), edge('px', 'a'), edge('px', 'b')],
    );
    const r = run(g, scenario(400));
    close(r.perNode.node_a?.rpsIn, 10); // inferred flow: 400 × 0.1 rps, 1 of 4 replicas
    close(r.perNode.node_b?.rpsIn, 30);
  });
});

describe('Service mesh', () => {
  it('sidecars cost more than ambient; mTLS adds CPU', () => {
    // sidecar: 0.15 × 1.5 × 1.2 = 0.27 work, + 0.6 ms wait. ambient: 0.18 work, + 0.2 ms.
    const side = one('network.service-mesh');
    close(side.serviceTimeMs.read, 0.27, 1e-9);
    close(wait(side).read, 0.87, 1e-9);
    const amb = one('network.service-mesh', { dataPlane: 'ambient' });
    close(amb.serviceTimeMs.read, 0.18, 1e-9);
    close(wait(amb).read, 0.38, 1e-9);
    close(
      one('network.service-mesh', { dataPlane: 'ambient', mtls: 'off' }).serviceTimeMs.read,
      0.15,
      1e-9,
    );
  });
});

describe('Kubernetes cluster (pod packing)', () => {
  it('nodes fit pods by their requests; bigger nodes fit more, not faster, pods', () => {
    // small: min(⌊(2 − 0.5)/0.5⌋, ⌊(8 − 1)/1⌋) = 3 pods × 4 = 12 servers.
    const small = one('compute.kubernetes', {}, 1, 'small');
    expect(small.serversPerInstance).toBe(12);
    // large: min(⌊7.5/0.5⌋, ⌊31/1⌋) = 15 pods × 4 = 60; service time unchanged (10 ms).
    const large = one('compute.kubernetes', {}, 1, 'large');
    expect(large.serversPerInstance).toBe(60);
    expect(large.serviceTimeMs.read).toBe(10);
  });

  it('capacity = nodes × pods × concurrency ÷ S', () => {
    // 3 small nodes × 12 servers, S = 10 ms ⇒ 3 600 rps; 900 rps ⇒ ρ = 0.25.
    const g = graph(
      [node('c', 'client.app'), node('k', 'compute.kubernetes', 3, {}, 'small')],
      [edge('c', 'k')],
    );
    const s = run(g, scenario(900, [flow('r', ['c', 'k'])])).perNode.node_k;
    close(s?.utilization, 0.25);
    expect(s?.explain.pods).toContain('3 node(s) × 3 = 9 pods');
  });

  it('flags pods that do not fit', () => {
    const g = graph(
      [node('c', 'client.app'), node('k', 'compute.kubernetes', 1, { podCpuRequest: 4 }, 'small')],
      [edge('c', 'k')],
    );
    expect(run(g, scenario(1)).perNode.node_k?.explain.pods).toContain('Pending');
  });
});

describe('Prometheus + Grafana (TSDB sizing)', () => {
  it('sizes ingest, storage and memory from active series', () => {
    // 1e6 / 15 = 66 666.7 samples/s; × 1.5 B × 15 d × 86 400 = 129.6 GB; 1e6 × 4 KiB = 3.815 GiB.
    const g = (series: number) =>
      graph(
        [
          node('gr', 'client.app'),
          node('p', 'observability.prometheus', 1, { activeSeries: series }, 'mem-medium'),
        ],
        [edge('gr', 'p')],
      );
    const s = run(g(1_000_000), scenario(10)).perNode.node_p;
    expect(s?.explain.tsdb).toContain('66666.7 samples/s');
    expect(s?.explain.tsdb).toContain('129.6 GB');
    expect(s?.explain.tsdb).toContain('3.815 GB');
    expect(run(g(10_000_000), scenario(10)).perNode.node_p?.explain.tsdb).toContain('OOM');
  });
});

describe('every S13 component has docs and at least one behavior', () => {
  it.each([
    'messaging.kafka',
    'messaging.rabbitmq',
    'cache.redis',
    'cache.memcached',
    'database.cassandra',
    'database.kv-store',
    'database.postgres',
    'database.mongodb',
    'database.elasticsearch',
    'database.clickhouse',
    'database.coordination',
    'network.reverse-proxy',
    'network.service-mesh',
    'compute.kubernetes',
    'observability.prometheus',
  ])('%s', (id) => {
    const def = registry.require(id, 'component');
    expect(def.docs.howItWorks.length).toBeGreaterThan(200);
    expect(def.docs.tradeoffs.length).toBeGreaterThanOrEqual(3);
    expect(def.docs.interviewTips.length).toBeGreaterThanOrEqual(3);
    expect(def.behaviors?.length).toBeGreaterThan(0);
  });
});
