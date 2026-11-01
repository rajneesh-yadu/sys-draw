/**
 * "Security" overlay model (S16): exposure per node, encryption and zone crossing per edge, zone
 * per group. Pure data for the canvas (the app passes it into the canvas's security store).
 */
import type { Graph } from '@/core';
import {
  edgeEncryption,
  EXPOSURE_LABEL,
  groupZone,
  nodeExposure,
  zoneCrossings,
  ZONE_LABEL,
  type EdgeEncryption,
  type Exposure,
  type GuardVerdict,
  type SecurityLookups,
  type ZoneOrInternet,
} from '@/registry';

export interface NodeSecurityView {
  exposure: Exposure;
  zone?: ZoneOrInternet | undefined;
  /** Short badge text, e.g. "Internet-facing". */
  label: string;
  reason: string;
}

export interface EdgeSecurityView {
  encryption: EdgeEncryption;
  /** Encrypting layer, e.g. "TLS 1.3". */
  by?: string | undefined;
  /** Short badge text: "TLS 1.3", "mTLS", "Plaintext". */
  label: string;
  crossing?:
    | {
        from?: ZoneOrInternet | undefined;
        to?: ZoneOrInternet | undefined;
        verdict?: GuardVerdict | undefined;
        explain: string;
      }
    | undefined;
}

export interface SecurityOverlay {
  nodes: Record<string, NodeSecurityView>;
  edges: Record<string, EdgeSecurityView>;
  /** Zone per group id (own or inherited); groups without a zone are absent. */
  groups: Record<string, ZoneOrInternet>;
}

const ENCRYPTION_LABEL: Record<EdgeEncryption, string> = {
  mtls: 'mTLS',
  tls: 'TLS',
  plaintext: 'Plaintext',
  unknown: 'Unknown',
};

export function securityOverlay(graph: Graph, lookups: SecurityLookups): SecurityOverlay {
  const nodes: SecurityOverlay['nodes'] = {};
  for (const n of graph.nodes) {
    const e = nodeExposure(graph, n.id, lookups.components);
    nodes[n.id] = {
      exposure: e.exposure,
      zone: e.zone,
      label:
        e.zone && e.zone !== 'internet' && e.exposure !== 'exposed'
          ? ZONE_LABEL[e.zone]
          : EXPOSURE_LABEL[e.exposure],
      reason: e.reason,
    };
  }
  const crossings = new Map(zoneCrossings(graph, lookups).map((c) => [c.edgeId, c]));
  const edges: SecurityOverlay['edges'] = {};
  for (const e of graph.edges) {
    const enc = edgeEncryption(lookups.protocols, e.protocolStack);
    const c = crossings.get(e.id);
    edges[e.id] = {
      encryption: enc.status,
      by: enc.by,
      label: enc.status === 'tls' && enc.by ? enc.by : ENCRYPTION_LABEL[enc.status],
      crossing: c && {
        from: c.from,
        to: c.to,
        verdict: c.guard?.verdict,
        explain:
          `Crosses ${c.from ? ZONE_LABEL[c.from] : 'no zone'} → ${c.to ? ZONE_LABEL[c.to] : 'no zone'}` +
          (c.port !== undefined ? ` on ${c.transport.toUpperCase()} ${c.port}` : '') +
          (c.guard ? `. ${c.guard.explain}` : '. No security group on the target side.'),
      },
    };
  }
  const groups: SecurityOverlay['groups'] = {};
  for (const g of graph.groups) {
    const z = groupZone(graph, g.id);
    if (z) groups[g.id] = z;
  }
  return { nodes, edges, groups };
}
