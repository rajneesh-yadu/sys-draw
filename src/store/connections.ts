/** Connection validation by port protocols, and the default protocol stack for a new edge. */
import type { EdgeInstance, Graph } from '@/core';
import { suggestedStacks, type EntryByKind, type Registry } from '@/registry';

type ComponentDef = EntryByKind['component'];
type Port = ComponentDef['ports'][number];

export interface ConnectionRequest {
  source: string;
  target: string;
  sourcePortId?: string | undefined;
  targetPortId?: string | undefined;
}

export type ConnectionCheck =
  | { ok: true; sourcePortId: string; targetPortId: string; protocols: string[] }
  | { ok: false; reason: string };

const isOut = (p: Port) => p.direction === 'out' || p.direction === 'both';
const isIn = (p: Port) => p.direction === 'in' || p.direction === 'both';

/**
 * Can `source` connect to `target`? A connection needs an output port on the source and an
 * input port on the target that share at least one protocol. When port ids are omitted the
 * first compatible pair (in definition order) is chosen. `protocols` is the shared set,
 * best first (see `rankProtocols`).
 */
export function checkConnection(
  registry: Registry,
  graph: Graph,
  req: ConnectionRequest,
): ConnectionCheck {
  if (req.source === req.target) return { ok: false, reason: 'A node cannot connect to itself' };
  const src = graph.nodes.find((n) => n.id === req.source);
  const tgt = graph.nodes.find((n) => n.id === req.target);
  if (!src) return { ok: false, reason: `Unknown source node "${req.source}"` };
  if (!tgt) return { ok: false, reason: `Unknown target node "${req.target}"` };
  const srcDef = registry.get(src.defId, 'component');
  const tgtDef = registry.get(tgt.defId, 'component');
  if (!srcDef) return { ok: false, reason: `Unknown component "${src.defId}"` };
  if (!tgtDef) return { ok: false, reason: `Unknown component "${tgt.defId}"` };

  const outPorts = srcDef.ports.filter(
    (p) => isOut(p) && (req.sourcePortId === undefined || p.id === req.sourcePortId),
  );
  const inPorts = tgtDef.ports.filter(
    (p) => isIn(p) && (req.targetPortId === undefined || p.id === req.targetPortId),
  );
  if (outPorts.length === 0) {
    return {
      ok: false,
      reason:
        req.sourcePortId === undefined
          ? `${srcDef.name} has no output port`
          : `${srcDef.name} has no output port "${req.sourcePortId}"`,
    };
  }
  if (inPorts.length === 0) {
    return {
      ok: false,
      reason:
        req.targetPortId === undefined
          ? `${tgtDef.name} has no input port`
          : `${tgtDef.name} has no input port "${req.targetPortId}"`,
    };
  }

  for (const sp of outPorts) {
    for (const tp of inPorts) {
      const shared = sp.protocols.filter((p) => tp.protocols.includes(p));
      if (shared.length === 0) continue;
      const dup = graph.edges.some(
        (e) =>
          e.source === src.id &&
          e.target === tgt.id &&
          (e.sourcePortId ?? sp.id) === sp.id &&
          (e.targetPortId ?? tp.id) === tp.id,
      );
      if (dup) return { ok: false, reason: `${src.label} is already connected to ${tgt.label}` };
      return {
        ok: true,
        sourcePortId: sp.id,
        targetPortId: tp.id,
        protocols: rankProtocols(registry, shared),
      };
    }
  }
  const speaks = [...new Set(outPorts.flatMap((p) => p.protocols))].join(', ');
  const accepts = [...new Set(inPorts.flatMap((p) => p.protocols))].join(', ');
  return {
    ok: false,
    reason: `No common protocol: ${srcDef.name} speaks ${speaks}; ${tgtDef.name} accepts ${accepts}`,
  };
}

/**
 * Best protocol first: higher OSI layer (unregistered ids such as wire protocols count as 7),
 * then multiplexing, then the original order. Stable.
 */
export function rankProtocols(registry: Registry, ids: readonly string[]): string[] {
  const score = (id: string) => {
    const p = registry.get(id, 'protocol');
    return (p?.osiLayer ?? 7) * 10 + (p?.multiplexing ? 1 : 0);
  };
  return ids
    .map((id, i) => ({ id, i, s: score(id) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.id);
}

/**
 * Bottom-up stack for `protocol`, following `runsOn` and preferring an encrypted lower layer
 * (http2 → tls13 → tcp gives ['tcp','tls13','http2']). Unregistered ids stand alone.
 */
export function defaultProtocolStack(registry: Registry, protocol: string): string[] {
  const topDown = [protocol];
  const seen = new Set(topDown);
  let cur = registry.get(protocol, 'protocol');
  while (cur) {
    const lower = cur.runsOn
      .map((id) => registry.get(id, 'protocol'))
      .filter((p): p is NonNullable<typeof p> => p !== undefined && !seen.has(p.id));
    const next = lower.find((p) => p.encrypted) ?? lower[0];
    if (!next) break;
    topDown.push(next.id);
    seen.add(next.id);
    cur = next;
  }
  return topDown.reverse();
}

/**
 * Every bottom-up stack that can carry `protocol`, following `runsOn` to a protocol with no
 * registered lower layer (http2 → [['tcp','http2'], ['tcp','tls13','http2']]). Unregistered ids
 * (wire protocols a later session adds) stand alone. Sorted: encrypted first, then shorter.
 */
export function protocolStackOptions(registry: Registry, protocol: string): string[][] {
  const out: string[][] = [];
  const walk = (topDown: string[]) => {
    const cur = registry.get(topDown[topDown.length - 1]!, 'protocol');
    const lower = (cur?.runsOn ?? []).filter(
      (id) => registry.kindOf(id) === 'protocol' && !topDown.includes(id),
    );
    if (lower.length === 0) {
      out.push([...topDown].reverse());
      return;
    }
    for (const id of lower) walk([...topDown, id]);
  };
  walk([protocol]);
  const encrypted = (stack: string[]) =>
    stack.some((id) => registry.get(id, 'protocol')?.encrypted === true);
  return out
    .map((stack, i) => ({ stack, i }))
    .sort(
      (a, b) =>
        Number(encrypted(b.stack)) - Number(encrypted(a.stack)) ||
        a.stack.length - b.stack.length ||
        a.i - b.i,
    )
    .map((x) => x.stack);
}

/** Application protocols both ends of an existing edge can speak (its ports' shared set, best first). */
export function edgeSharedProtocols(
  registry: Registry,
  graph: Graph,
  edge: EdgeInstance,
): string[] {
  const src = graph.nodes.find((n) => n.id === edge.source);
  const tgt = graph.nodes.find((n) => n.id === edge.target);
  const srcDef = src && registry.get(src.defId, 'component');
  const tgtDef = tgt && registry.get(tgt.defId, 'component');
  if (!srcDef || !tgtDef) return [];
  const outs = srcDef.ports.filter(
    (p) => isOut(p) && (edge.sourcePortId === undefined || p.id === edge.sourcePortId),
  );
  const ins = tgtDef.ports.filter(
    (p) => isIn(p) && (edge.targetPortId === undefined || p.id === edge.targetPortId),
  );
  const accepts = new Set(ins.flatMap((p) => p.protocols));
  const shared = [...new Set(outs.flatMap((p) => p.protocols))].filter((p) => accepts.has(p));
  return rankProtocols(registry, shared);
}

/** Every valid stack for an edge: one group per shared application protocol, best first. */
export function edgeProtocolStackOptions(
  registry: Registry,
  graph: Graph,
  edge: EdgeInstance,
): string[][] {
  return edgeSharedProtocols(registry, graph, edge).flatMap((p) =>
    protocolStackOptions(registry, p),
  );
}

/**
 * Why `stack` cannot be used on `edge`, or `null` when it can. The top must be a protocol both
 * ports speak; each registered layer must run on the layer below it (its `runsOn`).
 */
export function checkProtocolStack(
  registry: Registry,
  graph: Graph,
  edge: EdgeInstance,
  stack: readonly string[],
): string | null {
  const top = stack[stack.length - 1];
  if (top === undefined) return 'A protocol stack needs at least one protocol';
  if (new Set(stack).size !== stack.length) return 'A protocol appears twice in the stack';
  const name = (id: string) => registry.get(id, 'protocol')?.name ?? id;
  const shared = edgeSharedProtocols(registry, graph, edge);
  if (!shared.includes(top)) {
    return `${name(top)} is not spoken by both ends (they share: ${shared.map(name).join(', ') || 'nothing'})`;
  }
  for (let i = 0; i < stack.length; i++) {
    const p = registry.get(stack[i]!, 'protocol');
    if (!p) continue;
    const below = stack[i - 1];
    if (below === undefined) {
      if (p.runsOn.some((id) => registry.kindOf(id) === 'protocol')) {
        return `${p.name} must run on ${p.runsOn.map(name).join(' or ')}`;
      }
    } else if (!p.runsOn.includes(below)) {
      return `${p.name} cannot run on ${name(below)} (it runs on ${p.runsOn.map(name).join(' or ') || 'nothing'})`;
    }
  }
  return null;
}

export interface EdgeStackSuggestion {
  stack: string[];
  why: string;
}

/**
 * S14: the registry's default stack for this component pair (e.g. browser → CDN: HTTP/3,
 * service → Kafka: Kafka wire over TCP), if one fits: its top protocol must be one both ports
 * speak (and equal `protocol` when given) and every layer must run on the one below.
 */
export function suggestedEdgeStack(
  registry: Registry,
  graph: Graph,
  sourceId: string,
  targetId: string,
  shared: readonly string[],
  protocol?: string,
): EdgeStackSuggestion | undefined {
  const src = graph.nodes.find((n) => n.id === sourceId);
  const tgt = graph.nodes.find((n) => n.id === targetId);
  const srcDef = src && registry.get(src.defId, 'component');
  const tgtDef = tgt && registry.get(tgt.defId, 'component');
  if (!srcDef || !tgtDef) return undefined;
  for (const s of suggestedStacks(registry, srcDef, tgtDef)) {
    const top = s.stack[s.stack.length - 1] as string;
    if (!shared.includes(top) || (protocol !== undefined && protocol !== top)) continue;
    const valid = s.stack.every((id, i) => {
      const p = registry.get(id, 'protocol');
      const below = s.stack[i - 1];
      return (
        p !== undefined && (below === undefined ? p.runsOn.length === 0 : p.runsOn.includes(below))
      );
    });
    if (valid) return { stack: [...s.stack], why: s.why };
  }
  return undefined;
}

/** The suggestion for an existing edge (shown in the edge inspector). */
export function edgeStackSuggestion(
  registry: Registry,
  graph: Graph,
  edge: EdgeInstance,
): EdgeStackSuggestion | undefined {
  return suggestedEdgeStack(
    registry,
    graph,
    edge.source,
    edge.target,
    edgeSharedProtocols(registry, graph, edge),
  );
}
