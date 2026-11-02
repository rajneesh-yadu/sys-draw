/**
 * S24 — sample workflow "Redis, Kafka & RabbitMQ on Kubernetes" (`problem.sample-order-events`).
 * Beyond the generic reference checks in references.test.ts: the sample is discoverable under each
 * featured technology, every featured component has realistic callers and dependencies over the
 * protocols its ports support, the scenario's flows walk the highlighted paths, and a peak run
 * drains both brokers with no lag while the design review reports only the documented scope gaps.
 */
import { describe, expect, it } from 'vitest';
import type { Graph } from '@/core';
import { reviewDesign, simulate } from '@/engine';
import { filterProblems, findProblem, listProblems, startProblem } from '@/problems';
import { registry } from '@/registry';
import { checkConnection, checkProtocolStack, createAppStores } from '@/store';

const ID = 'problem.sample-order-events';
const sample = findProblem(registry, ID)!;
const graph: Graph = sample.referenceSolutions[0]!;
const node = (key: string) => graph.nodes.find((n) => n.id === `node_${key}`)!;
const edgesInto = (key: string) => graph.edges.filter((e) => e.target === `node_${key}`);
const edgesOutOf = (key: string) => graph.edges.filter((e) => e.source === `node_${key}`);
const top = (stack: readonly string[]) => stack[stack.length - 1];
const flow = (key: string) => sample.scenario.flows.find((f) => f.id === `flow_${key}`)!;
const pathOf = (key: string) => flow(key).path.map((s) => s.nodeId.replace(/^node_/, ''));
const run = () => simulate({ graph, scenario: sample.scenario, providerId: 'generic' }, registry);

describe('S24 sample workflow — Redis, Kafka, RabbitMQ on Kubernetes', () => {
  it('is discoverable by the sample tag and by each featured technology', () => {
    const all = listProblems(registry);
    expect(filterProblems(all, { tag: 'sample' }).map((p) => p.id)).toContain(ID);
    for (const tag of ['kafka', 'rabbitmq', 'redis', 'kubernetes'])
      expect(
        filterProblems(all, { tag }).map((p) => p.id),
        tag,
      ).toContain(ID);
    expect(sample.title).toMatch(/^Sample workflow:/);
    expect(sample.docs.summary).toMatch(/Redis.*Kafka.*RabbitMQ.*Kubernetes/s);
  });

  it('loads onto a new board in one step, with its scenario', () => {
    const { boardStore, workspaceStore } = createAppStores();
    const res = startProblem(workspaceStore, sample, { mode: 'sandbox', start: 'reference' });
    expect(res.ok).toBe(true);
    const doc = boardStore.getState().doc;
    expect(doc.graph).toEqual(graph);
    expect(doc.scenario.flows.map((f) => f.id)).toEqual([
      'flow_status',
      'flow_order',
      'flow_project',
    ]);
  });

  it('every edge is a legal connection with a valid protocol stack', () => {
    for (const e of graph.edges) {
      const others = { ...graph, edges: graph.edges.filter((x) => x.id !== e.id) };
      const c = checkConnection(registry, others, { source: e.source, target: e.target });
      expect(c.ok, `${e.id}: ${c.ok ? '' : c.reason}`).toBe(true);
      expect(checkProtocolStack(registry, graph, e, e.protocolStack), e.id).toBeNull();
    }
  });

  it('centres on the four technologies, each wired to real callers and dependencies', () => {
    expect(node('kafka').defId).toBe('messaging.kafka');
    expect(node('rabbit').defId).toBe('messaging.rabbitmq');
    expect(node('redis').defId).toBe('cache.redis');

    // Kafka: a producer over the Kafka wire protocol; two consumer services = two consumer groups.
    expect(edgesInto('kafka').map((e) => [e.source, top(e.protocolStack)])).toEqual([
      ['node_api', 'kafka-wire'],
    ]);
    expect(
      edgesOutOf('kafka')
        .map((e) => e.target)
        .sort(),
    ).toEqual(['node_notifier', 'node_projector']);
    // RabbitMQ: published to over AMQP, drained by one pool of competing workers.
    expect(edgesInto('rabbit').map((e) => [e.source, top(e.protocolStack)])).toEqual([
      ['node_notifier', 'amqp'],
    ]);
    expect(edgesOutOf('rabbit').map((e) => e.target)).toEqual(['node_workers']);
    // Broker → consumer edges are async. They carry only TCP because the Kubernetes input port
    // lists neither kafka-wire nor amqp (documented follow-up); revisit if that port changes.
    for (const e of [...edgesOutOf('kafka'), ...edgesOutOf('rabbit')]) {
      expect(e.sync, e.id).toBe(false);
      expect(e.protocolStack, e.id).toEqual(['tcp']);
    }
    // Redis: read by the API (cache-aside) and written by the Kafka projector, over RESP + TLS.
    expect(edgesInto('redis').map((e) => [e.source, e.protocolStack])).toEqual([
      ['node_api', ['tcp', 'tls13', 'resp']],
      ['node_projector', ['tcp', 'tls13', 'resp']],
    ]);
    // Kubernetes hosts every stateless workload inside one cluster group; none is a pass-through
    // dependency of another (no compute → compute edge).
    const compute = graph.nodes.filter(
      (n) => registry.require(n.defId, 'component').category === 'compute',
    );
    expect(compute.map((n) => n.id).sort()).toEqual(
      ['node_api', 'node_notifier', 'node_projector', 'node_workers'].sort(),
    );
    const cluster = graph.groups.find((g) => g.kind === 'cluster')!;
    for (const n of compute) {
      expect(n.defId).toBe('compute.kubernetes');
      expect(n.groupId).toBe(cluster.id);
      expect(n.scaling.autoscale, n.id).toBeDefined();
    }
    const computeIds = new Set(compute.map((n) => n.id));
    expect(graph.edges.filter((e) => computeIds.has(e.source) && computeIds.has(e.target))).toEqual(
      [],
    );
    // Brokers and their consumers share a zone, so the TCP-only edges cross no boundary.
    const zoneOf = (gid?: string) => graph.groups.find((g) => g.id === gid)?.security?.zone;
    expect(zoneOf(node('kafka').groupId)).toBe(zoneOf(cluster.id));
    expect(zoneOf(node('rabbit').groupId)).toBe(zoneOf(cluster.id));
  });

  it('has flows that walk the highlighted paths, and every node is on one', () => {
    expect(pathOf('status')).toEqual(['client', 'gw', 'api', 'redis', 'db']);
    expect(flow('status').path[3]!.cacheable).toBe(true);
    expect(pathOf('order')).toEqual([
      'client',
      'gw',
      'api',
      'redis',
      'db',
      'kafka',
      'notifier',
      'rabbit',
      'workers',
    ]);
    expect(pathOf('project')).toEqual(['projector', 'redis']);
    // The second consumer group handles every order event: same rate as the order flow.
    expect(flow('project').share * flow('project').rpsPerUser).toBe(
      flow('order').share * flow('order').rpsPerUser,
    );
    const onFlow = new Set(sample.scenario.flows.flatMap((f) => f.path.map((s) => s.nodeId)));
    for (const n of graph.nodes) expect(onFlow.has(n.id), n.label).toBe(true);
  });

  it('runs the peak scenario: SLOs hold, brokers keep up, Redis absorbs the polls', () => {
    const r = run();
    for (const [id, n] of Object.entries(r.perNode))
      expect(n.utilization, `${id} utilisation`).toBeLessThan(0.75);
    for (const f of ['flow_status', 'flow_order', 'flow_project']) {
      expect(r.perFlow[f]!.rps, f).toBeGreaterThan(0);
      expect(r.perFlow[f]!.errorRate, f).toBeLessThan(0.001);
    }
    expect(r.perFlow.flow_status!.p99).toBeLessThan(150);
    expect(r.perFlow.flow_order!.p99).toBeLessThan(200);
    expect(r.system.availability).toBeGreaterThanOrEqual(0.999);

    const kafka = r.perNode.node_kafka!;
    expect(kafka.queueDepth).toBeLessThan(1); // messages (M/M/c wait ≈ 0, no backlog)
    expect(kafka.explain.lag).toMatch(/2 consumer group\(s\)/);
    expect(kafka.explain.lag).toMatch(/projector.*no lag.*dispatcher.*no lag/s);
    const rabbit = r.perNode.node_rabbit!;
    expect(rabbit.queueDepth).toBeLessThan(1);
    expect(rabbit.explain.lag).toMatch(/no backlog/);
    // Workers receive the jobs RabbitMQ hands out; both consumer groups receive Kafka's events.
    for (const id of ['node_workers', 'node_notifier', 'node_projector'])
      expect(r.perNode[id]!.utilization, id).toBeGreaterThan(0);
    expect(r.perNode.node_redis!.hitRate).toBeGreaterThan(0.9);
  });

  it('design review reports only the documented scope gaps (single region, secrets)', () => {
    const review = reviewDesign({ graph, scenario: sample.scenario, registry });
    expect([...new Set(review.findings.map((f) => f.ruleId))].sort()).toEqual([
      'rule.secrets-in-config',
      'rule.single-region-data',
    ]);
  });

  it('has a legible layout: distinct positions and non-overlapping sibling group boxes', () => {
    const at = new Set(graph.nodes.map((n) => `${n.position.x},${n.position.y}`));
    expect(at.size).toBe(graph.nodes.length);
    const x = (k: string) => node(k).position.x;
    expect(x('client')).toBe(Math.min(...graph.nodes.map((n) => n.position.x)));
    const order = ['client', 'gw', 'api', 'projector', 'notifier', 'workers'].map(x);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // Data above the cluster band, brokers below it.
    const y = (k: string) => node(k).position.y;
    expect(Math.max(y('db'), y('redis'))).toBeLessThan(y('api'));
    expect(Math.min(y('kafka'), y('rabbit'))).toBeGreaterThan(y('api'));
    for (const n of graph.nodes) expect(n.label.length, n.id).toBeLessThanOrEqual(50);

    const W = 200;
    const H = 100;
    const box = (gid: string) => {
      const inside = (n: Graph['nodes'][number]) => {
        for (let g = n.groupId; g; g = graph.groups.find((x) => x.id === g)?.parentId)
          if (g === gid) return true;
        return false;
      };
      const ns = graph.nodes.filter(inside);
      return {
        x0: Math.min(...ns.map((n) => n.position.x)),
        y0: Math.min(...ns.map((n) => n.position.y)),
        x1: Math.max(...ns.map((n) => n.position.x + W)),
        y1: Math.max(...ns.map((n) => n.position.y + H)),
      };
    };
    for (const a of graph.groups)
      for (const b of graph.groups) {
        if (a.id >= b.id || a.parentId !== b.parentId) continue;
        const p = box(a.id);
        const q = box(b.id);
        const overlap = p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1;
        expect(overlap, `${a.label} / ${b.label}`).toBe(false);
      }
  });
});
