/**
 * Sample saved documents for tests across modules.
 * One project with one board: client → LB → 2 app servers → DB, in one region/VPC.
 * Component defIds are the generic ids the registry is expected to ship (S03+); core does not check them.
 */
import type { Board, Workspace } from '../schemas';

const T0 = '2026-10-31T12:00:00Z';

export const SAMPLE_IDS = {
  project: 'proj_sample',
  board: 'board_sample',
  region: 'grp_us_east',
  vpc: 'grp_vpc_main',
  client: 'node_client',
  lb: 'node_lb',
  app1: 'node_app_1',
  app2: 'node_app_2',
  db: 'node_db',
} as const;

const I = SAMPLE_IDS;
const httpsStack = ['ip', 'tcp', 'tls13', 'http2'];

export const sampleBoard: Board = {
  id: I.board,
  projectId: I.project,
  name: 'Web app basics',
  providerId: 'generic',
  mode: 'sandbox',
  graph: {
    groups: [
      { id: I.region, kind: 'region', label: 'US East', regionId: 'us-east-1' },
      {
        id: I.vpc,
        kind: 'vpc',
        label: 'Main VPC',
        parentId: I.region,
        security: {
          public: false,
          firewallRules: [
            {
              direction: 'ingress',
              action: 'allow',
              protocol: 'tcp',
              fromPort: 443,
              toPort: 443,
              peer: 'internet',
            },
          ],
        },
      },
    ],
    nodes: [
      {
        id: I.client,
        defId: 'client.web',
        label: 'Web client',
        position: { x: 0, y: 200 },
        config: {},
        scaling: { replicas: 1, instanceType: 'browser' },
      },
      {
        id: I.lb,
        defId: 'network.load-balancer',
        label: 'Load balancer',
        position: { x: 250, y: 200 },
        groupId: I.vpc,
        config: { algorithm: 'round-robin' },
        scaling: { replicas: 1, instanceType: 'standard' },
      },
      {
        id: I.app1,
        defId: 'compute.app-server',
        label: 'App server 1',
        position: { x: 500, y: 100 },
        groupId: I.vpc,
        config: {},
        scaling: { replicas: 1, instanceType: 'medium' },
      },
      {
        id: I.app2,
        defId: 'compute.app-server',
        label: 'App server 2',
        position: { x: 500, y: 300 },
        groupId: I.vpc,
        config: {},
        scaling: { replicas: 1, instanceType: 'medium' },
      },
      {
        id: I.db,
        defId: 'database.postgres',
        label: 'Postgres',
        position: { x: 750, y: 200 },
        groupId: I.vpc,
        config: { readReplicas: 0 },
        scaling: { replicas: 1, instanceType: 'large' },
      },
    ],
    edges: [
      {
        id: 'edge_client_lb',
        source: I.client,
        target: I.lb,
        protocolStack: httpsStack,
        sync: true,
        config: { timeoutMs: 5000 },
      },
      {
        id: 'edge_lb_app1',
        source: I.lb,
        target: I.app1,
        protocolStack: ['ip', 'tcp', 'http1'],
        sync: true,
        config: {},
      },
      {
        id: 'edge_lb_app2',
        source: I.lb,
        target: I.app2,
        protocolStack: ['ip', 'tcp', 'http1'],
        sync: true,
        config: {},
      },
      {
        id: 'edge_app1_db',
        source: I.app1,
        target: I.db,
        protocolStack: ['ip', 'tcp', 'tls13', 'postgres-wire'],
        sync: true,
        config: { timeoutMs: 1000, retries: 2, backoff: 'exp', poolSize: 20 },
      },
      {
        id: 'edge_app2_db',
        source: I.app2,
        target: I.db,
        protocolStack: ['ip', 'tcp', 'tls13', 'postgres-wire'],
        sync: true,
        config: { timeoutMs: 1000, retries: 2, backoff: 'exp', poolSize: 20 },
      },
    ],
  },
  scenario: {
    usersByRegion: { 'north-america': 8000, europe: 2000 },
    flows: [
      {
        id: 'flow_read_page',
        name: 'Load page',
        share: 0.9,
        rpsPerUser: 0.05,
        path: [
          { nodeId: I.client, op: 'read' },
          { nodeId: I.lb, op: 'read' },
          { nodeId: I.app1, op: 'read' },
          { nodeId: I.db, op: 'read', cacheable: true },
        ],
      },
      {
        id: 'flow_submit_form',
        name: 'Submit form',
        share: 0.1,
        rpsPerUser: 0.05,
        path: [
          { nodeId: I.client, op: 'write' },
          { nodeId: I.lb, op: 'write' },
          { nodeId: I.app2, op: 'write' },
          { nodeId: I.db, op: 'write' },
        ],
      },
    ],
    peakMultiplier: 2,
    diurnal: true,
    payloadBytes: { req: 1_000, res: 20_000 },
    events: [
      { id: 'evt_app1_down', kind: 'nodeOutage', nodeId: I.app1, atSec: 30, durationSec: 30 },
    ],
    seed: 42,
    durationSec: 120,
  },
  snapshots: [],
};

export const sampleWorkspace: Workspace = {
  schemaVersion: 1,
  projects: [
    { id: I.project, name: 'Practice', boardIds: [I.board], createdAt: T0, updatedAt: T0 },
  ],
  settings: { theme: 'system', defaultProviderId: 'generic', autosave: true, showFormulas: true },
};

/** The same workspace as saved by the pre-versioned (v0) draft format. */
export const sampleWorkspaceV0: Record<string, unknown> = {
  projects: [
    { id: I.project, name: 'Practice', boardIds: [I.board], createdAt: T0, updatedAt: T0 },
  ],
};
