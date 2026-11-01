import { describe, expect, it } from 'vitest';
import type { Graph, ProviderId } from '@/core';
import {
  componentIcon,
  instancePrice,
  isAvailableOn,
  isProviderOnly,
  mapRegion,
  mapRegionId,
  planProviderSwitch,
  registry,
  serviceLimits,
  servicePricing,
} from './index';
import { GENERAL_PURPOSE_INSTANCES, MEMORY_OPTIMISED_INSTANCES } from './presets';

const CLOUDS = ['aws', 'gcp', 'azure'] as const;
const providers = registry.list({ kind: 'provider' });
const components = registry.list({ kind: 'component' });
const provider = (id: ProviderId) => registry.require(id, 'provider');

describe('provider entries (S12)', () => {
  it.each(providers.map((p) => [p.id, p] as const))(
    '%s: price table carries an "as of" date and a priced region it has',
    (_id, p) => {
      expect(p.pricing.asOf).toMatch(/^20\d\d-\d\d-\d\d$/);
      expect(p.regions.map((r) => r.id)).toContain(p.pricing.region);
    },
  );

  it.each(CLOUDS)('%s: maps every generic instance size to a family size', (id) => {
    const sizes = provider(id).instanceFamilies.flatMap((f) => f.sizes);
    for (const t of [...GENERAL_PURPOSE_INSTANCES, ...MEMORY_OPTIMISED_INSTANCES]) {
      const sz = sizes.find((s) => s.size === t.id);
      expect(sz, t.id).toBeDefined();
      // same shape as the generic preset, so simulated speed is unchanged by the switch
      expect(sz?.vCpu).toBe(t.vCpu);
      expect(sz?.memGb).toBe(t.memGb);
    }
  });

  it.each(CLOUDS)(
    '%s: services reference real components, config fields and instance types',
    (id) => {
      const p = provider(id);
      for (const [compId, svc] of Object.entries(p.services)) {
        const def = registry.get(compId, 'component');
        expect(def, compId).toBeDefined();
        if (!def) continue;
        expect(isAvailableOn(def, id), `${compId} on ${id}`).toBe(true);
        const fields = Object.keys(def.configSchema.shape);
        for (const l of svc.limits ?? []) {
          if (l.check?.kind === 'config')
            expect(fields, `${compId} ${l.id}`).toContain(l.check.field);
          if (l.when) expect(fields, `${compId} ${l.id} when`).toContain(l.when.field);
        }
        for (const typeId of Object.keys(svc.instancePrices ?? {})) {
          expect(
            def.instanceTypes.map((t) => t.id),
            `${compId} ${typeId}`,
          ).toContain(typeId);
        }
        if (svc.nearest) {
          const near = registry.get(svc.nearest, 'component');
          expect(near && !isProviderOnly(near)).toBe(true);
        }
      }
    },
  );

  it.each(CLOUDS)('%s: region genericIds are generic regions, used at most once', (id) => {
    const generic = new Set(provider('generic').regions.map((r) => r.id));
    const used = provider(id)
      .regions.map((r) => r.genericId)
      .filter((g): g is string => g !== undefined);
    for (const g of used) expect(generic.has(g), g).toBe(true);
    expect(new Set(used).size).toBe(used.length);
  });

  it('every generic component names a product on each cloud; provider-only ones on exactly one', () => {
    for (const def of components) {
      if (def.providerNames === undefined) continue; // provider-neutral (clients)
      const on = CLOUDS.filter((c) => def.providerNames?.[c] !== undefined);
      if (isProviderOnly(def)) {
        expect(on, def.id).toHaveLength(1);
        expect(provider(on[0]!).services[def.id]?.nearest, `${def.id} nearest`).toBeDefined();
      } else expect(on, def.id).toEqual([...CLOUDS]);
    }
  });

  it('ships SNS / Pub/Sub / Event Grid, Kinesis / Event Hubs, Aurora and Spanner', () => {
    const topic = registry.require('messaging.topic', 'component');
    expect(topic.providerNames).toEqual({ aws: 'SNS', gcp: 'Pub/Sub', azure: 'Event Grid' });
    const stream = registry.require('messaging.stream', 'component');
    expect(stream.providerNames?.azure).toBe('Event Hubs');
    expect(stream.providerNames?.aws).toBe('Kinesis Data Streams');
    expect(registry.require('database.aurora', 'component').providerNames).toEqual({
      aws: 'Aurora',
    });
    expect(registry.require('database.spanner', 'component').providerNames).toEqual({
      gcp: 'Spanner',
    });
    expect(registry.require('database.nosql', 'component').providerNames?.azure).toBe('Cosmos DB');
  });
});

describe('prices', () => {
  it('app server: family price, no premium', () => {
    expect(instancePrice(provider('aws'), 'compute.app-server', 'small')).toMatchObject({
      name: 'm7i.large',
      costUsdPerHour: 0.1008,
    });
    expect(instancePrice(provider('gcp'), 'compute.app-server', 'mem-large')?.name).toBe(
      'n2-highmem-8',
    );
    expect(instancePrice(provider('azure'), 'compute.app-server', 'medium')?.costUsdPerHour).toBe(
      0.192,
    );
  });

  it('managed database: explicit price wins, else family × premium with the name prefix', () => {
    expect(instancePrice(provider('aws'), 'database.sql', 'small')).toMatchObject({
      name: 'db.m6i.large',
      costUsdPerHour: 0.171,
    });
    const azure = instancePrice(provider('azure'), 'database.sql', 'medium');
    expect(azure?.name).toBe('Flexible Server ≈ D4s v5');
    expect(azure?.costUsdPerHour).toBeCloseTo(0.192 * 1.3, 10);
    expect(azure?.source).toMatch(/as of 2026-10-01/);
  });

  it('generic provider and unmapped types fall back to the component price', () => {
    expect(instancePrice(provider('generic'), 'compute.app-server', 'small')).toBeUndefined();
    expect(instancePrice(provider('aws'), 'database.aurora', 'db.r6g.large')).toBeUndefined();
    expect(instancePrice(undefined, 'compute.app-server', 'small')).toBeUndefined();
  });

  it('per-service request and storage prices', () => {
    expect(servicePricing(provider('aws'), 'network.api-gateway')).toEqual({
      requestsUsdPerMillion: 3.5,
    });
    expect(servicePricing(provider('azure'), 'storage.object')).toEqual({
      requestsUsdPerMillion: 0.5,
      storageUsdPerGbMonth: 0.018,
    });
    expect(servicePricing(provider('generic'), 'storage.object')).toEqual({});
  });
});

describe('limits', () => {
  it('Lambda concurrency and DynamoDB partition limits', () => {
    const lambda = serviceLimits(provider('aws'), 'compute.serverless-function');
    expect(lambda.find((l) => l.id === 'lambda-concurrency')).toMatchObject({
      value: 1000,
      adjustable: true,
      check: { kind: 'config', field: 'concurrencyLimit' },
    });
    const ddb = serviceLimits(provider('aws'), 'database.nosql').map((l) => [l.id, l.value]);
    expect(ddb).toContainEqual(['dynamodb-partition-reads', 3000]);
    expect(ddb).toContainEqual(['dynamodb-partition-writes', 1000]);
  });

  it('`when` limits apply only to matching config', () => {
    const fifo = (ordering: string) =>
      serviceLimits(provider('aws'), 'messaging.queue', { ordering }).map((l) => l.id);
    expect(fifo('fifo')).toContain('sqs-fifo-throughput');
    expect(fifo('none')).not.toContain('sqs-fifo-throughput');
  });
});

describe('regions and icons', () => {
  it('maps the same metro across providers', () => {
    expect(mapRegionId(provider('generic'), provider('aws'), 'us-east')).toBe('us-east-1');
    expect(mapRegionId(provider('aws'), provider('gcp'), 'us-east-1')).toBe('us-east4');
    expect(mapRegionId(provider('gcp'), provider('azure'), 'asia-south1')).toBe('centralindia');
    expect(mapRegionId(provider('azure'), provider('generic'), 'northeurope')).toBe('eu-west');
    // a generic id left on an AWS board is still understood
    expect(mapRegionId(provider('aws'), provider('azure'), 'ap-south')).toBe('centralindia');
  });

  it('falls back to the nearest region when the metro has none', () => {
    // AWS Ohio has no generic twin; nearest on GCP is N. Virginia (≈ 500 km) over Iowa or S. Carolina
    expect(mapRegionId(provider('aws'), provider('gcp'), 'us-east-2')).toBe('us-east4');
    // generic Ireland → GCP has no Ireland: London is nearest
    expect(mapRegion(provider('generic'), provider('gcp'), 'eu-west')).toEqual({
      id: 'europe-west2',
      exact: false,
      distanceKm: 466, // haversine Dublin → London, checked in Python
    });
    expect(mapRegionId(provider('generic'), provider('aws'), 'nowhere')).toBeUndefined();
  });

  it('provider icons replace the component icon', () => {
    const obj = registry.require('storage.object', 'component');
    expect(componentIcon(obj, provider('generic'))).toBe('archive');
    expect(componentIcon(obj, provider('azure'))).toBe('hard-drive');
  });
});

describe('planProviderSwitch', () => {
  const graph: Graph = {
    nodes: [
      {
        id: 'node_s3',
        defId: 'storage.object',
        label: 'media',
        position: { x: 0, y: 0 },
        config: {},
        scaling: { replicas: 1, instanceType: 'managed' },
        groupId: 'grp_r',
      },
      {
        id: 'node_sp',
        defId: 'database.spanner',
        label: 'ledger',
        position: { x: 0, y: 0 },
        config: {},
        scaling: { replicas: 1, instanceType: 'node' },
      },
      {
        id: 'node_fn',
        defId: 'compute.serverless-function',
        label: 'api',
        position: { x: 0, y: 0 },
        config: {},
        scaling: { replicas: 1, instanceType: '1024mb' },
      },
    ],
    edges: [],
    groups: [{ id: 'grp_r', kind: 'region', label: 'Main', regionId: 'us-central1' }],
  } as unknown as Graph;

  it('relabels, remaps regions and warns where there is no equivalent', () => {
    const plan = planProviderSwitch(registry, graph, undefined, 'gcp', 'aws');
    expect(plan.relabels.find((r) => r.nodeId === 'node_s3')).toMatchObject({
      from: 'Cloud Storage',
      to: 'S3',
    });
    expect(plan.noEquivalent).toHaveLength(1);
    expect(plan.noEquivalent[0]?.targetId).toBe('node_sp');
    expect(plan.noEquivalent[0]?.message).toMatch(/Spanner has no AWS equivalent.*RDS/);
    // Iowa has no AWS region: nearest is Ohio
    expect(plan.regions).toEqual([
      { targetId: 'grp_r', label: 'Main', from: 'us-central1', to: 'us-east-2', nearest: true },
    ]);
    expect(plan.limits.find((l) => l.nodeId === 'node_fn')?.limits.join()).toMatch(
      /Concurrent executions per region.*1,000/,
    );
  });

  it('generic → aws relabels Object Storage to S3', () => {
    const g = { ...graph, nodes: [graph.nodes[0]!], groups: [] } as Graph;
    const plan = planProviderSwitch(registry, g, undefined, 'generic', 'aws');
    expect(plan.relabels[0]).toMatchObject({ from: 'Object Storage', to: 'S3', iconTo: 'package' });
    expect(plan.noEquivalent).toEqual([]);
  });
});
