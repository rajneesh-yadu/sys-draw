import { z } from 'zod';
import { defineComponent } from '../../define';
import { GENERAL_PURPOSE_INSTANCES, MEMORY_OPTIMISED_INSTANCES } from '../../presets';

export default defineComponent({
  id: 'database.mongodb',
  name: 'MongoDB',
  category: 'database',
  tags: ['database', 'mongodb', 'document', 'nosql', 'replica-set', 'sharded'],
  icon: 'leaf',
  providerNames: {
    aws: 'DocumentDB (MongoDB compatible)',
    gcp: 'Firestore with MongoDB compatibility',
    azure: 'Cosmos DB for MongoDB',
  },
  ports: [{ id: 'in', direction: 'in', protocols: ['mongodb-wire', 'tls13', 'tcp'] }],
  configSchema: z.object({
    shards: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .describe('Shards (each a replica set); mongos routes by shard key')
      .meta({ scaling: 'shards' }),
    secondariesPerShard: z
      .number()
      .int()
      .min(0)
      .max(49)
      .describe('Secondaries in each replica set (2 = the usual 3-member set)')
      .meta({ scaling: 'readReplicas' }),
    readPreference: z
      .enum(['primary', 'primaryPreferred', 'secondary', 'secondaryPreferred', 'nearest'])
      .describe('Which members serve reads (anything but primary may read stale data)'),
    writeConcern: z
      .enum(['w1', 'majority'])
      .describe('Acknowledge after the primary (w:1) or a majority of members (survives failover)')
      .meta({
        perfEffect: {
          majority: {
            writeAddMs: 1.5,
            why: 'waits for a majority of the replica set to journal the write',
          },
        },
      }),
    readConcern: z
      .enum(['local', 'majority', 'linearizable'])
      .describe(
        'local = fastest; majority = never rolled back; linearizable = latest, via the primary',
      )
      .meta({
        advanced: true,
        perfEffect: {
          linearizable: {
            readAddMs: 2,
            why: 'the primary confirms with a majority that it is still primary',
          },
        },
      }),
    shardKeySkew: z
      .number()
      .min(0)
      .max(1)
      .describe('Share of traffic on the hottest shard (monotonic keys like timestamps → 1)')
      .meta({ advanced: true, scaling: 'keySkew' }),
    storageGb: z
      .number()
      .min(1)
      .max(1e7)
      .describe('Data stored (one copy)')
      .meta({ scaling: 'storageGb' }),
  }),
  defaults: {
    shards: 1,
    secondariesPerShard: 2,
    readPreference: 'primary',
    writeConcern: 'majority',
    readConcern: 'local',
    shardKeySkew: 0,
    storageGb: 200,
  },
  instanceTypes: [...GENERAL_PURPOSE_INSTANCES, ...MEMORY_OPTIMISED_INSTANCES],
  perf: {
    serviceTimeMs: { read: 1.5, write: 3 },
    maxConcurrencyPerInstance: 16,
    scaleCurve: 'single-writer',
    saturationBehavior: 'queue',
  },
  behaviors: ['replicaReads', 'configPerf'],
  docs: {
    summary:
      'A document database storing JSON-like (BSON) documents with flexible schemas, secondary indexes and aggregation, scaled with replica sets and sharding.',
    howItWorks:
      'Each shard is a replica set: one primary takes writes and records them in its oplog; secondaries replicate the oplog asynchronously and elect a new primary if it fails. writeConcern majority makes a write survive failover by waiting for a majority to journal it. Reads go to the primary unless readPreference allows secondaries (more capacity, possibly stale). Sharding splits collections by a shard key into chunks balanced across shards; mongos routers send each query to the owning shard, or to all shards if the query lacks the key.',
    tradeoffs: [
      'Flexible schema and rich queries on documents, but cross-document transactions and joins ($lookup) are costlier than in SQL.',
      'w:majority is durable but adds a replication round trip; w:1 can lose acknowledged writes on failover.',
      'A bad shard key (monotonic, low cardinality) makes one hot shard and scatter-gather queries.',
    ],
    interviewTips: [
      'Use it for document-shaped data read whole (product catalogs, user profiles, CMS content).',
      'Embed data read together; reference data that grows without bound.',
      'Pick a high-cardinality, evenly-written shard key (hashed user_id), and use majority writes for anything important.',
    ],
  },
  security: {
    defaultPorts: [27017, 27018, 27019],
    threats: [
      'Databases left open without authentication (historic mass ransom attacks)',
      'NoSQL operator injection ($where, $ne) from unvalidated JSON input',
    ],
    controls: [
      'SCRAM/x.509 auth and RBAC; bind to private IPs',
      'TLS, encryption at rest, input validation / schema validation',
    ],
  },
});
