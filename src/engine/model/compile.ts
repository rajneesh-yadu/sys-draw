/**
 * Pipeline step 1 — compile: resolve each node's ComponentDefinition, read its scale and perf
 * model, attach its region from the enclosing groups, and index edges.
 */
import type { Graph } from '@/core';
import type { Registry } from '@/registry';
import { behaviorsOf } from '../behaviors';
import { EVEN_SPEC } from '../scaling/pools';
import { scaleSpecOf } from '../scaling/spec';
import { engineFinding } from './findings';
import type { CompiledEdge, CompiledNode, Model } from './types';

/** Only `get(id, 'component')` is used, so a test registry or a stub works too. */
export type ComponentSource = Pick<Registry, 'get'>;

export function compile(graph: Graph, registry: ComponentSource): Model {
  const issues: Model['issues'] = [];
  const groups = new Map(graph.groups.map((g) => [g.id, g]));

  const regionOf = (groupId: string | undefined): string | undefined => {
    const seen = new Set<string>();
    let cur = groupId;
    while (cur !== undefined && !seen.has(cur)) {
      seen.add(cur);
      const g = groups.get(cur);
      if (!g) return undefined;
      if (g.regionId !== undefined) return g.regionId;
      cur = g.parentId;
    }
    return undefined;
  };

  const nodes = new Map<string, CompiledNode>();
  graph.nodes.forEach((n, index) => {
    const def = registry.get(n.defId, 'component');
    const base = {
      id: n.id,
      label: n.label,
      defId: n.defId,
      config: def ? { ...def.defaults, ...n.config } : n.config,
      replicas: Math.max(1, n.scaling.replicas),
      ...(n.scaling.autoscale ? { autoscale: n.scaling.autoscale } : {}),
      regionId: regionOf(n.groupId),
      groupId: n.groupId,
      index,
    };
    if (!def) {
      issues.push(
        engineFinding(
          'engine.compile',
          'warning',
          'Unknown component',
          `"${n.label}" uses "${n.defId}", which is not in the registry. It is simulated as a zero-latency pass-through.`,
          [n.id],
        ),
      );
      nodes.set(n.id, {
        ...base,
        kind: 'unknown',
        behaviors: [],
        scale: { ...EVEN_SPEC },
        serversPerInstance: 1,
        serviceTimeMs: { read: 0, write: 0 },
        baseServiceTimeMs: { read: 0, write: 0 },
        saturationBehavior: 'queue',
      });
      return;
    }
    let instanceType = def.instanceTypes.find((t) => t.id === n.scaling.instanceType);
    if (!instanceType) {
      instanceType = def.instanceTypes[0];
      issues.push(
        engineFinding(
          'engine.compile',
          'info',
          'Unknown instance type',
          `"${n.label}" uses instance type "${n.scaling.instanceType}", which ${def.name} does not offer; using "${instanceType?.id ?? '?'}".`,
          [n.id],
        ),
      );
    }
    const scale = scaleSpecOf(def, base.config, instanceType);
    const s = def.perf.serviceTimeMs;
    nodes.set(n.id, {
      ...base,
      kind: def.category === 'clients' ? 'source' : 'service',
      scale,
      def,
      category: def.category,
      behaviors: def.behaviors ?? [],
      instanceType,
      serversPerInstance: def.perf.maxConcurrencyPerInstance,
      serviceTimeMs: { read: s.read / scale.speedup, write: s.write / scale.speedup },
      baseServiceTimeMs: { ...s },
      saturationBehavior: def.perf.saturationBehavior,
    });
  });

  const edges = new Map<string, CompiledEdge>();
  const out = new Map<string, CompiledEdge[]>();
  const inbound = new Map<string, CompiledEdge[]>();
  for (const id of nodes.keys()) {
    out.set(id, []);
    inbound.set(id, []);
  }
  graph.edges.forEach((e, index) => {
    if (!nodes.has(e.source) || !nodes.has(e.target) || e.source === e.target) return;
    const ce: CompiledEdge = {
      id: e.id,
      source: e.source,
      target: e.target,
      sync: e.sync,
      protocolStack: e.protocolStack,
      index,
    };
    edges.set(e.id, ce);
    out.get(e.source)?.push(ce);
    inbound.get(e.target)?.push(ce);
  });

  // Upstream behaviors that shape how a target's replicas are loaded (consistent hashing).
  for (const e of edges.values()) {
    const src = nodes.get(e.source);
    const tgt = nodes.get(e.target);
    if (!src || !tgt || tgt.kind !== 'service') continue;
    for (const b of behaviorsOf(src.behaviors)) {
      const v = b.hashVirtualNodes?.(src);
      if (v === undefined) continue;
      const cur = tgt.scale.hashVirtualNodes;
      tgt.scale = { ...tgt.scale, hashVirtualNodes: cur === undefined ? v : Math.min(cur, v) };
    }
  }

  return { nodes, edges, out, inbound, issues };
}

export function hasBehavior(node: CompiledNode, id: string): boolean {
  return node.behaviors.includes(id);
}

export function isDataStore(node: CompiledNode): boolean {
  return node.category === 'database' || node.category === 'storage';
}
