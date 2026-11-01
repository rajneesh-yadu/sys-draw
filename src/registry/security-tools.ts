/**
 * Security model shared by review rules, the engine's attack events and the security module (S16):
 * trust zones, exposure, edge encryption and security-group (firewall) evaluation on edges that
 * cross zones. Pure functions over a graph plus registry lookups; nothing here imports React.
 *
 * It lives in the registry (not in `security`) because rule entries and the engine need it and
 * neither may import the security module; `security` re-exports it as its public zone model.
 */
import type {
  ComponentDefinition,
  FirewallRule,
  Graph,
  Group,
  NodeInstance,
  ProtocolDefinition,
  SecurityZone,
} from '@/core';
import { SECURITY_ZONES } from '@/core';

/** A node's zone; clients are on the internet. */
export type ZoneOrInternet = SecurityZone | 'internet';

export const ZONE_LABEL: Record<ZoneOrInternet, string> = {
  internet: 'Internet',
  public: 'Public',
  dmz: 'DMZ',
  private: 'Private',
  data: 'Data',
};

/** Higher = more trusted. */
export const ZONE_TRUST: Record<ZoneOrInternet, number> = {
  internet: 0,
  public: 1,
  dmz: 2,
  private: 3,
  data: 4,
};

export const ZONE_HELP: Record<SecurityZone, string> = {
  public:
    'Reachable from the internet (public subnet, public IPs): only edge services belong here.',
  dmz: 'Between the internet and the inside: load balancers, gateways, WAF, bastion.',
  private: 'No inbound internet access: application servers and workers.',
  data: 'Most restricted: databases, caches and storage, reachable only from the app tier.',
};

/** Security controls a component provides, declared as `control:<id>` tags on its registry entry. */
export const SECURITY_CONTROLS = [
  'waf',
  'ddos-protection',
  'rate-limit',
  'secrets',
  'kms',
  'iam',
  'bastion',
  'vpn',
  'auth',
  'mtls',
] as const;
export type SecurityControl = (typeof SECURITY_CONTROLS)[number];
export const CONTROL_TAG_PREFIX = 'control:';

export const CONTROL_LABEL: Record<SecurityControl, string> = {
  waf: 'WAF',
  'ddos-protection': 'DDoS protection',
  'rate-limit': 'Rate limiting',
  secrets: 'Secrets manager',
  kms: 'KMS encryption at rest',
  iam: 'IAM least privilege',
  bastion: 'Bastion host',
  vpn: 'VPN',
  auth: 'Authentication',
  mtls: 'mTLS',
};

export interface ComponentLookup {
  get(defId: string): ComponentDefinition | undefined;
}
export interface ProtocolLookup {
  get(id: string): ProtocolDefinition | undefined;
}
export interface SecurityLookups {
  components: ComponentLookup;
  protocols?: ProtocolLookup | undefined;
}

export function controlsOf(def: ComponentDefinition | undefined): SecurityControl[] {
  if (!def) return [];
  return def.tags
    .filter((t) => t.startsWith(CONTROL_TAG_PREFIX))
    .map((t) => t.slice(CONTROL_TAG_PREFIX.length))
    .filter((c): c is SecurityControl => (SECURITY_CONTROLS as readonly string[]).includes(c));
}

/** Categories whose nodes hold data (the "data tier"). */
export const DATA_CATEGORIES: readonly string[] = ['database', 'storage', 'cache'];

export function isDataStore(def: ComponentDefinition | undefined): boolean {
  return def !== undefined && DATA_CATEGORIES.includes(def.category);
}
export function isClient(def: ComponentDefinition | undefined): boolean {
  return def?.category === 'clients';
}

// ---------- Zones ----------

/** A group's own zone setting: explicit `zone`, else `public` ⇒ public / private; undefined = none. */
export function ownZone(group: Group): SecurityZone | undefined {
  if (!group.security) return undefined;
  return group.security.zone ?? (group.security.public ? 'public' : 'private');
}

/** The nearest group (the group itself, then its ancestors) that sets a zone. */
export function zoneGroup(
  graph: Pick<Graph, 'groups'>,
  groupId: string | undefined,
): Group | undefined {
  const byId = new Map(graph.groups.map((g) => [g.id, g]));
  const seen = new Set<string>();
  let cur = groupId === undefined ? undefined : byId.get(groupId);
  while (cur && !seen.has(cur.id)) {
    if (ownZone(cur) !== undefined) return cur;
    seen.add(cur.id);
    cur = cur.parentId === undefined ? undefined : byId.get(cur.parentId);
  }
  return undefined;
}

export function groupZone(graph: Pick<Graph, 'groups'>, groupId: string): SecurityZone | undefined {
  const g = zoneGroup(graph, groupId);
  return g ? ownZone(g) : undefined;
}

/** Zone of a node: clients are on the internet; others take their nearest zoned group's zone. */
export function nodeZone(
  graph: Pick<Graph, 'groups'>,
  node: NodeInstance,
  components: ComponentLookup,
): ZoneOrInternet | undefined {
  if (isClient(components.get(node.defId))) return 'internet';
  const g = zoneGroup(graph, node.groupId);
  return g ? ownZone(g) : undefined;
}

/** Group ids from the node's group up to the root (nearest first). */
export function ancestorGroupIds(
  graph: Pick<Graph, 'groups'>,
  groupId: string | undefined,
): string[] {
  const parent = new Map(graph.groups.map((g) => [g.id, g.parentId]));
  const out: string[] = [];
  let cur = groupId;
  while (cur !== undefined && !out.includes(cur)) {
    out.push(cur);
    cur = parent.get(cur);
  }
  return out;
}

// ---------- Exposure ----------

/**
 * How reachable a node is from the internet:
 * internet (a client), exposed (public zone, or a client connects to it directly), dmz, internal
 * (private / data zone and no client edge), unzoned (no zone and no client edge — assumed internal).
 */
export const EXPOSURES = ['internet', 'exposed', 'dmz', 'internal', 'unzoned'] as const;
export type Exposure = (typeof EXPOSURES)[number];

export const EXPOSURE_LABEL: Record<Exposure, string> = {
  internet: 'Internet',
  exposed: 'Internet-facing',
  dmz: 'DMZ',
  internal: 'Internal',
  unzoned: 'No zone',
};

export interface NodeExposure {
  exposure: Exposure;
  zone: ZoneOrInternet | undefined;
  /** Why, in one sentence. */
  reason: string;
  /** Client nodes with an edge straight to this node. */
  clientSources: string[];
}

export function nodeExposure(
  graph: Graph,
  nodeId: string,
  components: ComponentLookup,
): NodeExposure {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node)
    return { exposure: 'unzoned', zone: undefined, reason: 'Unknown node', clientSources: [] };
  const zone = nodeZone(graph, node, components);
  if (zone === 'internet')
    return {
      exposure: 'internet',
      zone,
      reason: 'A client on the public internet',
      clientSources: [],
    };
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const clientSources = graph.edges
    .filter((e) => e.target === nodeId)
    .map((e) => byId.get(e.source))
    .filter((n): n is NodeInstance => n !== undefined && isClient(components.get(n.defId)))
    .map((n) => n.id);
  if (zone === 'public')
    return {
      exposure: 'exposed',
      zone,
      reason: 'In a public zone: has a route from the internet',
      clientSources,
    };
  if (clientSources.length > 0)
    return {
      exposure: 'exposed',
      zone,
      reason: 'Clients on the internet connect to it directly',
      clientSources,
    };
  if (zone === 'dmz')
    return {
      exposure: 'dmz',
      zone,
      reason: 'In the DMZ: reachable only through edge rules',
      clientSources,
    };
  if (zone === 'private' || zone === 'data')
    return {
      exposure: 'internal',
      zone,
      reason: `In the ${ZONE_LABEL[zone].toLowerCase()} zone: no route from the internet`,
      clientSources,
    };
  return {
    exposure: 'unzoned',
    zone,
    reason: 'Not in a zoned group (set a zone on its subnet/VPC); assumed internal',
    clientSources,
  };
}

// ---------- Encryption and ports ----------

export type EdgeEncryption = 'mtls' | 'tls' | 'plaintext' | 'unknown';

export interface EdgeEncryptionStatus {
  status: EdgeEncryption;
  /** Name of the encrypting layer (top-most encrypted), e.g. 'TLS 1.3'. */
  by?: string | undefined;
}

/** Same rule as network's `encryptionStatus`: any encrypted layer encrypts; mTLS is mutual. */
export function edgeEncryption(
  protocols: ProtocolLookup | undefined,
  stack: readonly string[],
): EdgeEncryptionStatus {
  if (stack.length === 0 || !protocols) return { status: 'unknown' };
  const defs = stack.map((id) => protocols.get(id));
  if (defs.some((d) => d === undefined)) {
    const enc = defs.filter((d): d is ProtocolDefinition => d?.encrypted === true).at(-1);
    return enc
      ? { status: enc.id === 'mtls' ? 'mtls' : 'tls', by: enc.name }
      : { status: 'unknown' };
  }
  const enc = (defs as ProtocolDefinition[]).filter((d) => d.encrypted).at(-1);
  if (!enc) return { status: 'plaintext' };
  return { status: enc.id === 'mtls' ? 'mtls' : 'tls', by: enc.name };
}

/** Transport of a stack: UDP for udp/quic stacks, else TCP. */
export function edgeTransport(stack: readonly string[]): 'tcp' | 'udp' {
  return stack.includes('udp') || stack.includes('quic') ? 'udp' : 'tcp';
}

/** Server port of a stack: the top-most layer with ports (secure port when encrypted). */
export function edgePort(
  protocols: ProtocolLookup | undefined,
  stack: readonly string[],
): number | undefined {
  if (!protocols) return undefined;
  const encrypted = stack.some((id) => protocols.get(id)?.encrypted === true);
  for (const id of [...stack].reverse()) {
    const p = protocols.get(id)?.ports;
    if (!p) continue;
    const port = (encrypted ? (p.secure ?? p.plain) : (p.plain ?? p.secure))?.[0];
    if (port !== undefined) return port;
  }
  return undefined;
}

/**
 * Inserts TLS (or mTLS) above the transport when the layer above accepts it (`runsOn`).
 * Returns undefined when the stack cannot be encrypted that way (no TCP, UDP/QUIC, unknown ids).
 */
export function encryptedStack(
  protocols: ProtocolLookup,
  stack: readonly string[],
  layer: 'tls13' | 'mtls' = 'tls13',
): string[] | undefined {
  const tls = protocols.get(layer);
  if (!tls) return undefined;
  const base = stack.filter((id) => id !== 'tls12' && id !== 'tls13' && id !== 'mtls');
  const i = base.indexOf('tcp');
  if (i < 0) return undefined;
  const above = base[i + 1];
  if (above !== undefined) {
    const def = protocols.get(above);
    if (!def || !def.runsOn.includes(layer)) return undefined;
  }
  if (!tls.runsOn.includes('tcp')) return undefined;
  return [...base.slice(0, i + 1), layer, ...base.slice(i + 1)];
}

// ---------- Zone crossings and security groups ----------

const ANY_CIDRS = new Set(['0.0.0.0/0', '::/0', '*', 'any']);

/** Does the rule's peer match a source (by zone and group ancestry)? */
function peerMatches(
  peer: string,
  sourceZone: ZoneOrInternet | undefined,
  sourceGroups: readonly string[],
): boolean {
  const p = peer.trim().toLowerCase();
  if (ANY_CIDRS.has(p)) return true;
  if (p === 'internet') return sourceZone === 'internet' || sourceZone === 'public';
  if (sourceGroups.includes(peer.trim())) return true;
  // Any other CIDR (10.0.0.0/16 …) is read as "inside the network": matches non-internet sources.
  if (/^[0-9a-f:.]+\/\d+$/.test(p)) return sourceZone !== 'internet';
  return false;
}

function portMatches(r: FirewallRule, port: number | undefined): boolean {
  if (r.fromPort === undefined || r.toPort === undefined) return true;
  if (port === undefined) return false;
  return port >= r.fromPort && port <= r.toPort;
}

function protocolMatches(r: FirewallRule, transport: 'tcp' | 'udp'): boolean {
  return r.protocol === 'any' || r.protocol === transport;
}

export type GuardVerdict = 'allow' | 'deny' | 'no-rules';

export interface ZoneCrossing {
  edgeId: string;
  from: ZoneOrInternet | undefined;
  to: ZoneOrInternet | undefined;
  /** Going from less to more trusted (into the inside). */
  inbound: boolean;
  port?: number | undefined;
  transport: 'tcp' | 'udp';
  /** The target's security group (nearest zoned group) and what its ingress rules say. */
  guard?:
    | {
        groupId: string;
        verdict: GuardVerdict;
        /** Index of the deciding rule in the group's firewallRules. */
        ruleIndex?: number | undefined;
        explain: string;
      }
    | undefined;
}

/**
 * Ingress check of one edge against the target's security group: deny rules win, then allow;
 * a group with ingress rules and no match denies (default deny); a group without ingress rules
 * reports `no-rules` (not configured yet — not treated as blocked).
 */
export function evaluateIngress(
  group: Group,
  source: { zone: ZoneOrInternet | undefined; groupIds: readonly string[] },
  port: number | undefined,
  transport: 'tcp' | 'udp',
): NonNullable<ZoneCrossing['guard']> {
  const rules = group.security?.firewallRules ?? [];
  const ingress = rules.map((r, i) => ({ r, i })).filter((x) => x.r.direction === 'ingress');
  const what = `${transport.toUpperCase()}${port !== undefined ? ` ${port}` : ''}`;
  if (ingress.length === 0)
    return {
      groupId: group.id,
      verdict: 'no-rules',
      explain: `"${group.label}" has no ingress rules yet: ${what} is not checked.`,
    };
  const matching = ingress.filter(
    (x) =>
      protocolMatches(x.r, transport) &&
      portMatches(x.r, port) &&
      peerMatches(x.r.peer, source.zone, source.groupIds),
  );
  const deny = matching.find((x) => x.r.action === 'deny');
  if (deny)
    return {
      groupId: group.id,
      verdict: 'deny',
      ruleIndex: deny.i,
      explain: `Denied by "${group.label}" rule ${deny.i + 1} (${deny.r.peer}).`,
    };
  const allow = matching.find((x) => x.r.action === 'allow');
  if (allow)
    return {
      groupId: group.id,
      verdict: 'allow',
      ruleIndex: allow.i,
      explain: `Allowed by "${group.label}" rule ${allow.i + 1} (${allow.r.peer} → ${what}).`,
    };
  return {
    groupId: group.id,
    verdict: 'deny',
    explain: `No ingress rule of "${group.label}" allows ${what} from this source (default deny).`,
  };
}

/** Every edge whose two ends are in different zones (or one end on the internet). */
export function zoneCrossings(graph: Graph, lookups: SecurityLookups): ZoneCrossing[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out: ZoneCrossing[] = [];
  for (const e of graph.edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) continue;
    const from = nodeZone(graph, s, lookups.components);
    const to = nodeZone(graph, t, lookups.components);
    if (from === to || (from === undefined && to === undefined)) continue;
    const port = edgePort(lookups.protocols, e.protocolStack);
    const transport = edgeTransport(e.protocolStack);
    const tg = zoneGroup(graph, t.groupId);
    const crossing: ZoneCrossing = {
      edgeId: e.id,
      from,
      to,
      inbound:
        (from === undefined ? 0 : ZONE_TRUST[from]) < (to === undefined ? 0 : ZONE_TRUST[to]),
      port,
      transport,
    };
    if (tg)
      crossing.guard = evaluateIngress(
        tg,
        { zone: from, groupIds: ancestorGroupIds(graph, s.groupId) },
        port,
        transport,
      );
    out.push(crossing);
  }
  return out;
}

/** Ports that must never be open to the internet (admin and database ports). */
export const ADMIN_PORTS: Readonly<Record<number, string>> = {
  22: 'SSH',
  23: 'Telnet',
  3389: 'RDP',
  5900: 'VNC',
  3306: 'MySQL',
  5432: 'PostgreSQL',
  1433: 'SQL Server',
  6379: 'Redis',
  11211: 'Memcached',
  27017: 'MongoDB',
  9042: 'Cassandra',
  9200: 'Elasticsearch',
  2379: 'etcd',
  2181: 'ZooKeeper',
  9092: 'Kafka',
};

/** Admin ports a rule opens (all of them when the rule has no port range). */
export function adminPortsIn(r: FirewallRule): number[] {
  return Object.keys(ADMIN_PORTS)
    .map(Number)
    .filter((p) => portMatches(r, p) && (r.protocol === 'tcp' || r.protocol === 'any'));
}

/** True when the rule lets anyone on the internet in. */
export function opensToInternet(r: FirewallRule): boolean {
  const p = r.peer.trim().toLowerCase();
  return (
    r.direction === 'ingress' && r.action === 'allow' && (p === 'internet' || ANY_CIDRS.has(p))
  );
}

/** Node ids inside a group (nested groups included). */
export function nodesInside(
  graph: Pick<Graph, 'nodes' | 'groups'>,
  groupId: string,
): NodeInstance[] {
  return graph.nodes.filter((n) => ancestorGroupIds(graph, n.groupId).includes(groupId));
}

export { SECURITY_ZONES };
