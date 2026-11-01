/**
 * What the edge inspector shows for a stack: OSI layers, the handshake sequence, ports,
 * encryption status and warnings. Pure functions over registry data.
 */
import type { HandshakeMessage, ProtocolDefinition } from '@/core';
import type { Registry } from '@/registry';
import { connectionCost, type Warmth } from './cost';
import { activeLayers, type ProtocolSource, type ResolvedStack } from './stack';

export const OSI_LAYER_NAMES: Readonly<Record<number, string>> = Object.freeze({
  7: 'Application',
  6: 'Presentation',
  5: 'Session',
  4: 'Transport',
  3: 'Network',
  2: 'Data link',
  1: 'Physical',
});

export interface OsiProtocol {
  id: string;
  name: string;
  /** 'edge' = on this edge's stack; 'assumed' = transport assumed under a bare stack; 'implicit' = always there (IPv4, Ethernet). */
  source: 'edge' | 'assumed' | 'implicit';
}

export interface OsiRow {
  layer: number;
  name: string;
  protocols: OsiProtocol[];
  /** Why the row is empty, or what covers it (e.g. TLS inside QUIC). */
  note?: string | undefined;
}

/** Seven rows, layer 7 first. Missing lower layers are filled from `implicit` registry entries. */
export function osiView(registry: Pick<Registry, 'list'>, stack: ResolvedStack): OsiRow[] {
  const implicit = (registry.list({ kind: 'protocol' }) as ProtocolDefinition[]).filter(
    (p) => p.implicit === true,
  );
  const rows: OsiRow[] = [];
  for (let layer = 7; layer >= 1; layer--) {
    const own: OsiProtocol[] = stack.layers
      .filter((l) => l.def.osiLayer === layer)
      .map((l) => ({ id: l.def.id, name: l.def.name, source: l.assumed ? 'assumed' : 'edge' }));
    const protocols =
      own.length > 0 || layer > 3
        ? own
        : implicit
            .filter((p) => p.osiLayer === layer)
            .map((p) => ({ id: p.id, name: p.name, source: 'implicit' as const }));
    let note: string | undefined;
    if (protocols.length === 0) {
      const enc = stack.layers.find((l) => l.def.osiLayer < 6 && l.def.encrypted);
      if (layer === 6 && enc) note = `TLS 1.3 is built into ${enc.def.name}`;
      else if (layer === 6) note = 'No encryption layer: payloads travel in clear text';
      else if (layer === 5) note = 'Sessions are handled by the protocols above and below';
      else if (layer === 7) note = 'No application protocol (raw transport)';
    }
    rows.push({ layer, name: OSI_LAYER_NAMES[layer] ?? `Layer ${layer}`, protocols, note });
  }
  return rows;
}

export interface HandshakeGroup {
  protocolId: string;
  name: string;
  rtts: number;
  /** Round trips completed before this layer starts. */
  startRtt: number;
  messages: HandshakeMessage[];
}

/**
 * Handshake messages on a connection, bottom-up (TCP before TLS before HTTP), each layer with the
 * RTTs it costs. A warm connection has none; a resumed session uses `resumedHandshakeRtts`.
 */
export function handshakeSequence(stack: ResolvedStack, warm: Warmth = false): HandshakeGroup[] {
  const cost = connectionCost(stack, 1, warm);
  const groups: HandshakeGroup[] = [];
  let start = 0;
  for (const step of cost.steps) {
    const def = activeLayers(stack).find((l) => l.def.id === step.protocolId)?.def;
    const messages: HandshakeMessage[] =
      warm === 'resumed' &&
      def &&
      (def.resumedHandshakeRtts ?? def.handshakeRtts) < def.handshakeRtts
        ? [{ from: 'client', message: 'Resumption ticket / PSK', detail: 'abbreviated handshake' }]
        : (def?.handshakeSequence ??
          (def?.docs.handshakeSteps ?? []).map((s) => ({ from: 'client' as const, message: s })));
    groups.push({
      protocolId: step.protocolId,
      name: step.name,
      rtts: step.rtts,
      startRtt: start,
      messages,
    });
    start += step.rtts;
  }
  return groups;
}

export interface StackPorts {
  protocolId: string;
  name: string;
  ports: number[];
  transport: 'TCP' | 'UDP';
  secure: boolean;
}

/** Typical server port(s) for the top protocol that declares ports, plain or over TLS. */
export function stackPorts(stack: ResolvedStack): StackPorts | undefined {
  const secure = isEncrypted(stack);
  const transport = stack.layers.some((l) => l.def.id === 'udp') ? 'UDP' : 'TCP';
  for (const l of [...stack.layers].reverse()) {
    const p = l.def.ports;
    if (!p) continue;
    const ports = (secure ? (p.secure ?? p.plain) : (p.plain ?? p.secure)) ?? [];
    if (ports.length > 0)
      return { protocolId: l.def.id, name: l.def.name, ports, transport, secure };
  }
  return undefined;
}

export function isEncrypted(stack: ResolvedStack): boolean {
  return stack.layers.some((l) => l.def.encrypted);
}

export interface EncryptionStatus {
  encrypted: boolean;
  /** The layer that encrypts (top-most encrypted), e.g. 'TLS 1.3' or 'QUIC'. */
  by?: string | undefined;
  /** Both sides authenticated with certificates (mTLS). */
  mutual: boolean;
  summary: string;
}

export function encryptionStatus(stack: ResolvedStack): EncryptionStatus {
  const enc = [...stack.layers].reverse().find((l) => l.def.encrypted)?.def;
  if (!enc) {
    return {
      encrypted: false,
      mutual: false,
      summary: 'Plaintext: anyone on the path can read and change the traffic',
    };
  }
  const mutual = enc.id === 'mtls';
  return {
    encrypted: true,
    by: enc.name,
    mutual,
    summary: mutual
      ? `Encrypted and mutually authenticated by ${enc.name}`
      : `Encrypted in transit by ${enc.name} (server authenticated)`,
  };
}

export interface StackWarning {
  level: 'warning' | 'info';
  message: string;
}

export interface WarningContext {
  /** True when the edge crosses the public internet (user ↔ cloud, edge PoP). */
  crossesInternet?: boolean | undefined;
  /** Packet loss on the edge (scenario or chaos), 0..1. */
  lossRate?: number | undefined;
  /** EdgeConfig.newConnectionShare. */
  newConnectionShare?: number | undefined;
}

/** Problems and teaching notes for a stack. */
export function stackWarnings(
  registry: ProtocolSource,
  stack: ResolvedStack,
  ctx: WarningContext = {},
): StackWarning[] {
  const out: StackWarning[] = [];
  const name = (id: string) => registry.get(id, 'protocol')?.name ?? id;
  for (const id of stack.unknown) {
    out.push({
      level: 'warning',
      message: `"${id}" is not in the protocol catalog; its costs are not modelled.`,
    });
  }
  const own = stack.layers.filter((l) => !l.assumed);
  const assumed = stack.layers.find((l) => l.assumed);
  if (assumed) {
    out.push({
      level: 'info',
      message: `No transport on this edge: ${assumed.def.name} is assumed below ${own.map((l) => l.def.name).join(' › ') || 'it'}. Pick a full stack to make it explicit.`,
    });
  }
  // Each placed layer must run on the one below it.
  own.forEach((l, i) => {
    const below = own[i - 1];
    if (below && !l.def.runsOn.includes(below.def.id)) {
      out.push({
        level: 'warning',
        message: `${l.def.name} does not run on ${below.def.name} (it runs on ${l.def.runsOn.map(name).join(' or ')}).`,
      });
    }
  });

  if (!isEncrypted(stack)) {
    out.push(
      ctx.crossesInternet
        ? {
            level: 'warning',
            message:
              'Plaintext over the public internet: credentials and user data can be read or changed in transit. Add TLS.',
          }
        : {
            level: 'info',
            message:
              'Not encrypted. Acceptable only inside a trusted private network; use TLS or mTLS for user data (zero trust).',
          },
    );
  }
  if (stack.layers.some((l) => l.def.id === 'tls12')) {
    out.push({
      level: 'info',
      message: 'TLS 1.2 needs 2 RTTs to connect; TLS 1.3 needs 1 (0 on resumption).',
    });
  }
  const top = own[own.length - 1]?.def;
  if (top?.id === 'http1') {
    out.push({
      level: 'info',
      message:
        'HTTP/1.1 serves one request at a time per connection (head-of-line blocking); browsers open ~6 connections per host. HTTP/2 multiplexes them on one.',
    });
  }
  const t = stack.transport;
  if (top?.multiplexing && t?.loss?.holBlocking === 'connection') {
    const lossy = (ctx.lossRate ?? 0) > 0;
    out.push({
      level: lossy ? 'warning' : 'info',
      message: `${top.name} multiplexes many requests on one ${t.name} connection, so one lost packet stalls all of them${lossy ? ' — and this edge has packet loss' : ''}. HTTP/3 over QUIC limits the stall to one stream.`,
    });
  }
  const cold = connectionCost(stack, 1, false).rtts;
  if (cold >= 3 && (ctx.newConnectionShare ?? 0) > 0.1) {
    out.push({
      level: 'warning',
      message: `A new connection costs ${cold} RTTs and ${Math.round((ctx.newConnectionShare ?? 0) * 100)}% of requests open one. Keep connections alive or use a pool.`,
    });
  }
  if (t?.id === 'udp' && top && !top.reliable) {
    out.push({
      level: 'info',
      message: `${top.name} over UDP: lost datagrams are not resent by the transport; the client retries after a timeout.`,
    });
  }
  return out;
}
