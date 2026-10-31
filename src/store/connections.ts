/** Connection validation by port protocols, and the default protocol stack for a new edge. */
import type { Graph } from '@/core';
import type { EntryByKind, Registry } from '@/registry';

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
