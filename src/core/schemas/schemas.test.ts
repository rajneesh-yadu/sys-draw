import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { sampleBoard, sampleWorkspace, SAMPLE_IDS } from '../fixtures/sample-workspace';
import { safeParseReadable } from '../validation';
import {
  BoardSchema,
  ComponentDefinitionSchema,
  GraphSchema,
  ProblemDefinitionSchema,
  ProtocolDefinitionSchema,
  SimResultSchema,
  WorkspaceSchema,
} from './index';

const clone = <T>(v: T): T => structuredClone(v);
const errorsOf = (schema: z.ZodType, input: unknown): string[] => {
  const res = safeParseReadable(schema, input);
  return res.ok ? [] : res.errors;
};

describe('fixtures', () => {
  it('sample workspace and board parse', () => {
    expect(errorsOf(WorkspaceSchema, sampleWorkspace)).toEqual([]);
    expect(errorsOf(BoardSchema, sampleBoard)).toEqual([]);
  });
  it('board is client → LB → 2 servers → DB and listed in its project', () => {
    const { nodes, edges } = sampleBoard.graph;
    expect(nodes.map((n) => n.defId)).toEqual([
      'client.web',
      'network.load-balancer',
      'compute.app-server',
      'compute.app-server',
      'database.postgres',
    ]);
    expect(edges.map((e) => `${e.source}>${e.target}`)).toEqual([
      `${SAMPLE_IDS.client}>${SAMPLE_IDS.lb}`,
      `${SAMPLE_IDS.lb}>${SAMPLE_IDS.app1}`,
      `${SAMPLE_IDS.lb}>${SAMPLE_IDS.app2}`,
      `${SAMPLE_IDS.app1}>${SAMPLE_IDS.db}`,
      `${SAMPLE_IDS.app2}>${SAMPLE_IDS.db}`,
    ]);
    expect(sampleWorkspace.projects[0]?.boardIds).toEqual([sampleBoard.id]);
    expect(sampleBoard.projectId).toBe(sampleWorkspace.projects[0]?.id);
  });
  it('survives a JSON round trip', () => {
    const parsed = BoardSchema.parse(JSON.parse(JSON.stringify(sampleBoard)));
    expect(parsed).toEqual(sampleBoard);
  });
});

describe('readable errors for invalid docs', () => {
  it('reports wrong types with a path', () => {
    const ws = clone(sampleWorkspace) as unknown as { projects: { name: unknown }[] };
    ws.projects[0]!.name = 42;
    expect(errorsOf(WorkspaceSchema, ws)).toEqual([
      'projects[0].name: Invalid input: expected string, received number',
    ]);
  });
  it('reports missing fields and bad enums', () => {
    const b: Record<string, unknown> = clone(sampleBoard);
    delete b.scenario;
    b.mode = 'god-mode';
    const errs = errorsOf(BoardSchema, b);
    expect(errs).toContainEqual(
      expect.stringMatching(/^mode: Invalid option: expected one of "sandbox"/),
    );
    expect(errs).toContainEqual('scenario: Invalid input: expected object, received undefined');
  });
  it('reports dangling edges, unknown groups and duplicate ids', () => {
    const g = clone(sampleBoard.graph);
    g.edges[0]!.target = 'node_ghost';
    g.nodes[1]!.groupId = 'grp_ghost';
    g.nodes[4]!.id = SAMPLE_IDS.app2;
    const errs = errorsOf(GraphSchema, g);
    expect(errs).toContain('nodes[4].id: Duplicate id "node_app_2"');
    expect(errs).toContain('nodes[1].groupId: Unknown group "grp_ghost"');
    expect(errs).toContain('edges[0].target: Edge target "node_ghost" is not a node in this graph');
  });
  it('reports group cycles', () => {
    const g = clone(sampleBoard.graph);
    g.groups[0]!.parentId = SAMPLE_IDS.vpc;
    expect(errorsOf(GraphSchema, g)).toContain(
      'groups[0].parentId: Group "grp_us_east" is nested inside itself',
    );
  });
  it('reports wrong id prefixes', () => {
    const g = clone(sampleBoard.graph);
    g.nodes[0]!.id = 'client';
    expect(errorsOf(GraphSchema, g)[0]).toBe('nodes[0].id: Expected a node id like "node_abc123"');
  });
  it('reports flows and chaos events pointing at missing things', () => {
    const b = clone(sampleBoard);
    b.scenario.flows[0]!.path[2]!.nodeId = 'node_gone';
    b.scenario.events.push({
      id: 'evt_x',
      kind: 'packetLoss',
      lossRate: 0.1,
      edgeId: 'edge_gone',
      atSec: 0,
    });
    expect(errorsOf(BoardSchema, b)).toEqual([
      'scenario.flows[0].path[2].nodeId: Flow "Load page" visits unknown node "node_gone"',
      'scenario.events[1].edgeId: Chaos event "evt_x" targets unknown edge "edge_gone"',
    ]);
  });
  it('rejects out-of-range numbers and bad autoscale', () => {
    const b = clone(sampleBoard);
    b.scenario.flows[0]!.share = 1.5;
    b.graph.nodes[2]!.scaling.autoscale = { min: 4, max: 2, targetUtil: 0.7, warmupSec: 30 };
    const errs = errorsOf(BoardSchema, b);
    expect(errs).toContain('scenario.flows[0].share: Must be ≤ 1');
    expect(errs).toContain('graph.nodes[2].scaling.autoscale.max: max must be ≥ min');
  });
  it('rejects a board listed in two projects', () => {
    const ws = clone(sampleWorkspace);
    ws.projects.push({ ...ws.projects[0]!, id: 'proj_other' });
    expect(errorsOf(WorkspaceSchema, ws)).toEqual([
      'projects[1].boardIds[0]: Board "board_sample" is listed in both "proj_sample" and "proj_other"',
    ]);
  });
});

describe('registry entry schemas', () => {
  const component = {
    id: 'cache.redis',
    name: 'Redis',
    category: 'cache',
    tags: ['in-memory'],
    icon: 'redis',
    providerNames: { aws: 'ElastiCache', gcp: 'Memorystore' },
    ports: [{ id: 'in', direction: 'in', protocols: ['resp'] }],
    configSchema: z.object({
      ttlSec: z.number().int().positive(),
      maxMemoryGb: z.number().positive(),
    }),
    defaults: { ttlSec: 300, maxMemoryGb: 4 },
    instanceTypes: [{ id: 'small', vCpu: 2, memGb: 4, netGbps: 5, costUsdPerHour: 0.05 }],
    perf: {
      serviceTimeMs: { read: 0.2, write: 0.3 },
      maxConcurrencyPerInstance: 10_000,
      scaleCurve: 'linear',
      saturationBehavior: 'queue',
    },
    behaviors: ['cache'],
    docs: {
      summary: 'In-memory key-value cache',
      howItWorks: '…',
      tradeoffs: [],
      interviewTips: [],
    },
  };

  it('accepts a valid component', () => {
    expect(errorsOf(ComponentDefinitionSchema, component)).toEqual([]);
  });
  it('rejects defaults that break configSchema, empty docs and typos', () => {
    const errs = errorsOf(ComponentDefinitionSchema, {
      ...component,
      defaults: { ttlSec: -1, maxMemoryGb: 4 },
      docs: { ...component.docs, summary: '  ' },
      defualts: {},
    });
    expect(errs).toContain('(root): Unrecognized key: "defualts"');
    expect(errs).toContain('docs.summary: Must not be empty');
  });
  it('checks defaults against configSchema', () => {
    const errs = errorsOf(ComponentDefinitionSchema, {
      ...component,
      defaults: { ttlSec: -1, maxMemoryGb: 4 },
    });
    expect(errs).toEqual([
      'defaults.ttlSec: defaults do not match configSchema: Too small: expected number to be >0',
    ]);
  });
  it('requires configSchema to be a zod object', () => {
    expect(errorsOf(ComponentDefinitionSchema, { ...component, configSchema: {} })).toEqual([
      'configSchema: configSchema must be a Zod object schema (z.object({...}))',
    ]);
  });

  it('accepts a protocol and rejects a bad OSI layer', () => {
    const http2 = {
      id: 'http2',
      name: 'HTTP/2',
      osiLayer: 7,
      handshakeRtts: 0,
      perMessageOverheadBytes: 9,
      multiplexing: true,
      reliable: true,
      ordered: true,
      encrypted: false,
      runsOn: ['tcp', 'tls13'],
      docs: {
        summary: 'Binary, multiplexed HTTP',
        handshakeSteps: [],
        headerFields: [':method'],
        securityNotes: [],
      },
    };
    expect(errorsOf(ProtocolDefinitionSchema, http2)).toEqual([]);
    expect(errorsOf(ProtocolDefinitionSchema, { ...http2, osiLayer: 8 })).toHaveLength(1);
  });

  it('accepts a problem with a reference solution and validates the rubric', () => {
    const problem = {
      id: 'problem.web-basics',
      title: 'Web basics',
      level: 1,
      tags: [],
      requirements: { functional: ['Serve pages'], nonFunctional: ['p99 < 200 ms'] },
      scale: { dau: 1e5, readWriteRatio: 9, dataSizeBytes: 1e9 },
      scenario: sampleBoard.scenario,
      hints: ['Add a cache'],
      referenceSolutions: [sampleBoard.graph],
      rubric: [
        { ruleId: 'rule.spof', weight: 1 },
        { slo: { metric: 'p99', op: 'lt', value: 200, atRps: 50_000 }, weight: 2 },
      ],
      debugVariants: [],
    };
    expect(errorsOf(ProblemDefinitionSchema, problem)).toEqual([]);
    expect(errorsOf(ProblemDefinitionSchema, { ...problem, rubric: [{ weight: 1 }] })).toEqual([
      'rubric[0]: A rubric item needs a ruleId, an slo, or both',
    ]);
  });
});

describe('SimResult', () => {
  it('parses a minimal result', () => {
    const lat = { p50: 10, p95: 20, p99: 30 };
    const result = {
      perNode: {
        [SAMPLE_IDS.db]: {
          utilization: 1.2,
          rpsIn: 1200,
          rpsOut: 0,
          queueDepth: 40,
          latencyMs: lat,
          errorRate: 0.05,
          costPerMonth: 300,
          explain: { utilization: 'ρ = λ/(cμ) = 1200/(1×1000) = 1.2' },
        },
      },
      perEdge: {},
      perFlow: { flow_read_page: { ...lat, rps: 900, errorRate: 0 } },
      system: { rps: 1000, availability: 0.999, costPerMonth: 500, bottlenecks: [SAMPLE_IDS.db] },
      findings: [
        {
          ruleId: 'rule.spof',
          severity: 'warning',
          title: 'SPOF',
          message: 'One DB',
          targetIds: [SAMPLE_IDS.db],
        },
      ],
    };
    expect(errorsOf(SimResultSchema, result)).toEqual([]);
    expect(errorsOf(BoardSchema, { ...sampleBoard, lastResult: result })).toEqual([]);
  });
});
