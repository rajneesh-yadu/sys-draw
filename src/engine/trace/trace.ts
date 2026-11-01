/**
 * S15 — one request, end to end (NETWORK-SECURITY.md "Request trace").
 *
 * Follows ONE request of a flow from one user region through the routed expression tree (the same
 * route the simulation uses) and lists every step in time order:
 *
 *   DNS lookup → per connection: handshake messages (TCP SYN/SYN-ACK/ACK, TLS ClientHello/…) →
 *   request (one-way ≈ RTT/2) → queue wait Wq → service S → downstream calls → response (RTT/2).
 *
 * Timing (all means, from the steady-state run's queueing numbers):
 * - A hop's RTT is the geo RTT the route computed (propagation + last mile, before protocol costs).
 * - Handshake messages: each costs RTT/2 until the layer's `handshakeRtts` × RTT is used up; the
 *   rest ride in the same flight (TCP's ACK goes with the first data, TLS 1.3's Finished with the
 *   request), so a layer costs exactly what `connectionCost` charges.
 * - Cold (`warm: false`): every hop opens a new connection and the client resolves the name first
 *   — the answer is assumed cached at the ISP's recursive resolver, so DNS = one last-mile RTT.
 *   Warm (`true`, the default): pooled connections, cached DNS. `'resumed'`: new connections with
 *   session resumption (TLS 1.3 / QUIC 0-RTT), DNS cached.
 * - Node time: queue = Wq for the op, service = the response service time (S, or the quorum/acks
 *   wait from S13); data stores and caches count as "DB".
 * - Branches: a cache hit/miss follows `cache` ('miss' by default, so the whole path shows); other
 *   choices (load-balancer targets, regions) take the most likely option, first on ties.
 * - Async calls are listed (flagged `async`) at the moment they fire but do not delay the caller.
 *
 * The critical-path steps tile the timeline, so Σ breakdown = totalMs. With `warm: true` and no
 * retries/errors, totalMs = this branch's mean latency in the simulation.
 */
import type { Flow, ProtocolDefinition } from '@/core';
import {
  handshakeSequence,
  isEncrypted,
  perRequestOverhead,
  stackLabel,
  stackPorts,
  type ResolvedStack,
  type Warmth,
} from '@/network';
import { registry as appRegistry, userRegion, USER_REGIONS } from '@/registry';
import { buildGeoModel } from '../geo/places';
import { compile, hasBehavior, isDataStore, type ComponentSource } from '../model/compile';
import { evaluate } from '../model/evaluate';
import { type Expr, isEmpty } from '../model/expr';
import { fmt, pct } from '../model/format';
import { generateLoad, inferFlow, type FlowLoad } from '../model/load';
import { route, type RoutedFlow } from '../model/route';
import {
  DEFAULT_ENGINE_OPTIONS,
  type CompiledNode,
  type EngineOptions,
  type NodeStats,
  type Op,
  type SimInput,
} from '../model/types';

/** Where time goes. `network` = request/response transfer; `db` = data stores and caches. */
export const TRACE_CATEGORIES = [
  'dns',
  'tcp',
  'tls',
  'handshake',
  'network',
  'queue',
  'service',
  'db',
] as const;
export type TraceCategory = (typeof TRACE_CATEGORIES)[number];

export const TRACE_CATEGORY_LABEL: Readonly<Record<TraceCategory, string>> = Object.freeze({
  dns: 'DNS',
  tcp: 'TCP / QUIC',
  tls: 'TLS',
  handshake: 'App handshake',
  network: 'Network',
  queue: 'Queue',
  service: 'Service',
  db: 'DB / cache',
});

/** Pseudo participant for the DNS resolver (not a node on the board). */
export const TRACE_DNS_ID = 'dns-resolver';

export type TraceStepKind = 'dns' | 'handshake' | 'request' | 'response' | 'queue' | 'service';

export interface TraceStep {
  index: number;
  kind: TraceStepKind;
  category: TraceCategory;
  /** Protocol or stage name: 'DNS', 'TCP', 'TLS 1.3', 'HTTP/2', 'Queue', 'Service'. */
  layer: string;
  osiLayer?: number | undefined;
  protocolId?: string | undefined;
  /** Node ids (or TRACE_DNS_ID); equal for queue/service steps. */
  from: string;
  to: string;
  /** The connection the message travels on (undefined for DNS and node-local steps). */
  edgeId?: string | undefined;
  /** 'forward' = edge source → target; 'back' = target → source. */
  direction?: 'forward' | 'back' | undefined;
  message: string;
  /** Key header fields of the message. */
  headers: string[];
  startMs: number;
  /** Duration of this step. */
  timeMs: number;
  /** Off the caller's critical path (fire-and-forget / consumer side of a queue). */
  async: boolean;
  explain: string;
}

export interface TraceParticipant {
  id: string;
  label: string;
  kind: 'node' | 'dns';
}

export interface TraceDecision {
  nodeId: string;
  text: string;
}

export interface TraceOptions {
  /** Default true (pooled connections). */
  warm?: Warmth | undefined;
  /** Which branch of a cache hit/miss to follow. Default 'miss'. */
  cache?: 'miss' | 'hit' | undefined;
  registry?: ComponentSource | undefined;
  engine?: Partial<EngineOptions> | undefined;
}

export interface RequestTrace {
  flowId: string;
  flowName: string;
  /** Traced user region (undefined when the board has no user regions). */
  regionId?: string | undefined;
  regionName?: string | undefined;
  warm: Warmth;
  cache: 'miss' | 'hit';
  participants: TraceParticipant[];
  steps: TraceStep[];
  /** End of the critical path (response back at the client). */
  totalMs: number;
  /** Critical-path time per category; sums to totalMs. */
  breakdown: Record<TraceCategory, number>;
  decisions: TraceDecision[];
  /** Caveats: no route, overloaded nodes, assumed stacks… */
  notes: string[];
  explain: string;
}

const emptyBreakdown = (): Record<TraceCategory, number> =>
  Object.fromEntries(TRACE_CATEGORIES.map((c) => [c, 0])) as Record<TraceCategory, number>;

function handshakeCategory(def: ProtocolDefinition | undefined): TraceCategory {
  if (!def) return 'handshake';
  if (def.osiLayer <= 4) return 'tcp';
  if (def.pattern === 'security' || def.encrypted) return 'tls';
  return 'handshake';
}

function topLayer(stack: ResolvedStack): ProtocolDefinition | undefined {
  return stack.layers[stack.layers.length - 1]?.def;
}

/** The user region to trace: the requested one, else the one with most users (first on ties). */
function pickRegion(usersByRegion: Readonly<Record<string, number>>, wanted?: string) {
  if (wanted) return wanted;
  let best: string | undefined;
  let max = -Infinity;
  for (const [id, u] of Object.entries(usersByRegion)) {
    if (u > max) {
      best = id;
      max = u;
    }
  }
  return best;
}

/**
 * Trace one request of `flowId` (undefined = the first flow, or the inferred flow) from users in
 * `userRegionId` (undefined = the region with most users; any registry user region works, even
 * one without users on the board).
 */
export function traceRequest(
  board: SimInput,
  flowId: string | undefined,
  userRegionId: string | undefined,
  opts: TraceOptions = {},
): RequestTrace {
  const registry = opts.registry ?? appRegistry;
  const options: EngineOptions = { ...DEFAULT_ENGINE_OPTIONS, ...opts.engine };
  const warm: Warmth = opts.warm ?? true;
  const cacheBranch = opts.cache ?? 'miss';
  const { graph, scenario } = board;

  const model = compile(graph, registry);
  const geo = buildGeoModel(model, graph, scenario, registry, board.providerId);
  const flows: Flow[] = scenario.flows.length > 0 ? scenario.flows : [inferFlow(options)];
  const flow = flows.find((f) => f.id === flowId) ?? flows[0]!;
  const notes: string[] = [];
  if (flowId !== undefined && flow.id !== flowId)
    notes.push(`Flow "${flowId}" not found; traced "${flow.name}".`);

  // Steady-state queueing for every flow and region (the trace's queue/service times).
  const loads = generateLoad(scenario, flows);
  const plan = route(loads, model, options, geo);
  const routedAll: RoutedFlow[] = plan.flows.map((f) => ({
    ...f,
    rps: isEmpty(f.expr) ? 0 : f.rps,
  }));
  const { stats } = evaluate(model, routedAll, options, scenario.durationSec);

  // The traced route: this flow from this user region (routed afresh so any region works).
  const regionId = pickRegion(scenario.usersByRegion, userRegionId);
  const region = regionId ? userRegion(regionId) : undefined;
  if (userRegionId && !region) notes.push(`Unknown user region "${userRegionId}".`);
  const base = loads.find((l) => l.flow.id === flow.id) as FlowLoad;
  const one: FlowLoad = {
    ...base,
    byRegion: regionId
      ? [
          {
            regionId,
            users: scenario.usersByRegion[regionId] ?? 0,
            diurnal: 1,
            rps: 1,
            explain: '',
          },
        ]
      : [],
  };
  const traced = route([one], model, options, geo).flows[0];
  const expr: Expr = traced?.expr ?? { k: 'empty' };

  const steps: TraceStep[] = [];
  const breakdown = emptyBreakdown();
  const decisions: TraceDecision[] = [];
  const participants: TraceParticipant[] = [];
  const seen = new Set<string>();
  const addParticipant = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    participants.push(
      id === TRACE_DNS_ID
        ? { id, label: 'DNS resolver', kind: 'dns' }
        : { id, label: model.nodes.get(id)?.label ?? id, kind: 'node' },
    );
  };
  const userPlaceMs = region?.lastMileMs ?? 0;
  let dnsDone = warm !== false;

  const push = (s: Omit<TraceStep, 'index'>) => {
    addParticipant(s.from);
    addParticipant(s.to);
    steps.push({ ...s, index: steps.length });
    if (!s.async) breakdown[s.category] += s.timeMs;
    return s.startMs + s.timeMs;
  };

  const label = (id: string) => model.nodes.get(id)?.label ?? id;

  const nodeTime = (node: CompiledNode, s: NodeStats | undefined, op: Op) => {
    const svc = node.responseServiceMs?.[op] ?? node.serviceTimeMs[op];
    const total = s ? s.responseMs[op] : svc;
    return { queue: Math.max(0, total - svc), service: svc };
  };

  const pickOption = (e: Expr & { k: 'choice' }, at: string | undefined): Expr => {
    const empty = e.options.find((o) => isEmpty(o.expr));
    const full = e.options.find((o) => !isEmpty(o.expr));
    if (empty && full) {
      const hit = empty.p;
      const take = cacheBranch === 'hit' ? empty : full;
      decisions.push({
        nodeId: at ?? '',
        text:
          cacheBranch === 'hit'
            ? `Cache hit (hit rate ${pct(hit)}): the request is answered without going further.`
            : `Cache miss (${pct(1 - hit)} of reads, hit rate ${pct(hit)}): the read goes on to the next tier.`,
      });
      return take.expr;
    }
    let best = e.options[0]!;
    for (const o of e.options) if (o.p > best.p + 1e-12) best = o;
    const first = firstVisit(best.expr);
    if (first && e.options.length > 1) {
      decisions.push({
        nodeId: at ?? '',
        text: `${at ? `"${label(at)}"` : 'Entry'} → "${label(first)}" (${pct(best.p)} of requests; ${e.options.length} options).`,
      });
    }
    return best.expr;
  };

  const run = (e: Expr, caller: string | undefined, t: number, async: boolean): number => {
    switch (e.k) {
      case 'empty':
        return t;
      case 'seq': {
        let now = t;
        for (const item of e.items) now = run(item, caller, now, async);
        return now;
      }
      case 'choice':
        return run(pickOption(e, caller), caller, t, async);
      case 'async':
        run(e.expr, caller, t, true);
        return t;
      case 'visit':
        return visitStep(e, caller, t, async);
    }
  };

  const visitStep = (
    e: Expr & { k: 'visit' },
    caller: string | undefined,
    t0: number,
    async: boolean,
  ): number => {
    const node = model.nodes.get(e.nodeId);
    if (!node) return t0;
    let t = t0;
    const edge = e.edgeId !== undefined ? model.edges.get(e.edgeId) : undefined;
    const rtt = e.net ? (e.net.rttMs ?? e.net.ms) : 0;
    const half = rtt / 2;
    const netExplain = e.net?.explain
      ? e.net.explain
      : 'Both ends in the same place (or nothing placed in a region): RTT 0 ms';
    const from = caller ?? edge?.source ?? node.id;
    const top = edge ? topLayer(edge.stack) : undefined;
    const sKey = top?.name ?? 'Request';

    if (edge) {
      const callerNode = model.nodes.get(from);
      if (!dnsDone && callerNode?.kind === 'source') {
        dnsDone = true;
        const dnsHalf = userPlaceMs / 2;
        const dnsExplain = `Name not cached on the device: ask the ISP's recursive resolver (answer assumed cached there), one last-mile RTT = ${fmt(userPlaceMs)} ms${region ? ` (${region.name})` : ''}`;
        t = push({
          kind: 'dns',
          category: 'dns',
          layer: 'DNS',
          osiLayer: 7,
          protocolId: 'dns',
          from,
          to: TRACE_DNS_ID,
          message: `Query A/AAAA "${node.label}"`,
          headers: ['UDP 53', 'Transaction id, flags RD', `Question: ${node.label} A / AAAA`],
          startMs: t,
          timeMs: dnsHalf,
          async,
          explain: dnsExplain,
        });
        t = push({
          kind: 'dns',
          category: 'dns',
          layer: 'DNS',
          osiLayer: 7,
          protocolId: 'dns',
          from: TRACE_DNS_ID,
          to: from,
          message: 'Answer: address + TTL',
          headers: ['Flags RA', 'Answer with TTL (cached by the client until it expires)'],
          startMs: t,
          timeMs: dnsHalf,
          async,
          explain: dnsExplain,
        });
      }

      addParticipant(from);
      addParticipant(node.id);
      // Connection setup, layer by layer (none when warm).
      for (const g of handshakeSequence(edge.stack, warm)) {
        const def = edge.stack.layers.find((l) => l.def.id === g.protocolId)?.def;
        let budget = g.rtts * rtt;
        const msgs =
          g.messages.length > 0 ? g.messages : [{ from: 'client' as const, message: g.name }];
        msgs.forEach((m, i) => {
          const last = i === msgs.length - 1;
          const d = last ? budget : Math.min(half, budget);
          budget -= d;
          t = push({
            kind: 'handshake',
            category: handshakeCategory(def),
            layer: g.name,
            osiLayer: def?.osiLayer,
            protocolId: g.protocolId,
            from: m.from === 'client' ? from : node.id,
            to: m.from === 'client' ? node.id : from,
            edgeId: edge.id,
            direction: m.from === 'client' ? 'forward' : 'back',
            message: m.message,
            headers: [
              ...(m.detail ? [m.detail] : []),
              ...(def?.docs.headerFields.slice(0, 2) ?? []),
            ],
            startMs: t,
            timeMs: d,
            async,
            explain:
              `${g.name} handshake: ${fmt(g.rtts)} RTT × ${fmt(rtt)} ms = ${fmt(g.rtts * rtt)} ms on a new connection` +
              (d > 0
                ? `; this message travels one way ≈ RTT/2 = ${fmt(d)} ms`
                : '; sent in the same flight as the next message (no extra wait)') +
              `. ${netExplain}`,
          });
        });
      }

      const ports = stackPorts(edge.stack);
      const ov = perRequestOverhead(edge.stack, scenario.payloadBytes);
      const enc = [...edge.stack.layers].reverse().find((l) => l.def.encrypted)?.def;
      t = push({
        kind: 'request',
        category: 'network',
        layer: sKey,
        osiLayer: top?.osiLayer,
        protocolId: top?.id,
        from,
        to: node.id,
        edgeId: edge.id,
        direction: 'forward',
        message: `${e.op === 'read' ? 'Read' : 'Write'} request${edge.sync ? '' : ' (async)'}`,
        headers: [
          `Stack: ${stackLabel(registry, edge.protocolStack)}`,
          ...(ports ? [`Port ${ports.ports.join('/')} (${ports.transport})`] : []),
          enc ? `Encrypted by ${enc.name}` : 'Plaintext',
          `Payload ${fmt(scenario.payloadBytes.req)} B (+${fmt(ov.overheadBytes)} B headers per request/response)`,
          ...(top?.docs.headerFields.slice(0, 2) ?? []),
        ],
        startMs: t,
        timeMs: half,
        async,
        explain: `One way ≈ RTT/2 = ${fmt(half)} ms. ${netExplain}${isEncrypted(edge.stack) ? '' : '. Not encrypted on this hop'}`,
      });
    }

    addParticipant(node.id);
    if (node.kind !== 'source') {
      const s = stats.get(node.id);
      const { queue, service } = nodeTime(node, s, e.op);
      if (s?.saturated || (s?.errorRate ?? 0) > 0.01) {
        notes.push(
          `"${node.label}" is overloaded (utilisation ${pct(s?.utilization ?? 1)}, ${pct(s?.errorRate ?? 0)} of requests fail): its queue wait is capped at ρ = ${fmt(options.rhoCap)}.`,
        );
      }
      if (queue > 0) {
        t = push({
          kind: 'queue',
          category: 'queue',
          layer: 'Queue',
          from: node.id,
          to: node.id,
          message: `Wait for a free worker (${e.op})`,
          headers: [
            `Utilisation ${pct(s?.utilization ?? 0)}`,
            `P(wait) ${pct(s?.waitProbability ?? 0)}`,
          ],
          startMs: t,
          timeMs: queue,
          async,
          explain: `Mean queue wait Wq for ${e.op}s at utilisation ${pct(s?.utilization ?? 0)} (M/M/c) = ${fmt(queue)} ms`,
        });
      }
      const db = isDataStore(node) || node.category === 'cache';
      t = push({
        kind: 'service',
        category: db ? 'db' : 'service',
        layer: db ? 'Data store' : 'Service',
        from: node.id,
        to: node.id,
        message: `${node.label}: ${e.op === 'read' ? 'read' : 'write'}`,
        headers: [
          `S_${e.op} = ${fmt(service)} ms`,
          ...(node.replicas > 1 ? [`${node.replicas} replicas`] : []),
        ],
        startMs: t,
        timeMs: service,
        async,
        explain:
          node.responseServiceMs && node.responseServiceMs[e.op] !== node.serviceTimeMs[e.op]
            ? `Response service time (quorum / acks wait) = ${fmt(service)} ms (work per request ${fmt(node.serviceTimeMs[e.op])} ms)`
            : `Service time S_${e.op} = ${fmt(service)} ms${s?.explain.latencyMs ? `. ${s.explain.latencyMs}` : ''}`,
      });
    }

    t = run(e.then, node.id, t, async);

    if (edge && (edge.sync || hasBehavior(node, 'queue'))) {
      t = push({
        kind: 'response',
        category: 'network',
        layer: sKey,
        osiLayer: top?.osiLayer,
        protocolId: top?.id,
        from: node.id,
        to: from,
        edgeId: edge.id,
        direction: 'back',
        message: hasBehavior(node, 'queue') ? 'Ack (message stored)' : 'Response',
        headers: [
          `Payload ${fmt(e.op === 'read' ? scenario.payloadBytes.res : Math.min(scenario.payloadBytes.res, 200))} B`,
          ...(top?.docs.headerFields.slice(0, 1) ?? []),
        ],
        startMs: t,
        timeMs: half,
        async,
        explain: `One way ≈ RTT/2 = ${fmt(half)} ms. ${netExplain}`,
      });
    }
    return t;
  };

  const totalMs = run(expr, undefined, 0, false);
  if (steps.length === 0) {
    notes.push(
      model.nodes.size === 0
        ? 'The board is empty: add a client and connect it to your system.'
        : 'No request path for this flow: connect a client to your system (or define the flow path).',
    );
  }
  if (warm === false && totalMs > 0) {
    const pooled = steps.filter((s) => s.kind === 'handshake' && !s.async).length;
    if (pooled > 0)
      notes.push(
        'Cold: every hop opens a new connection. In production, servers keep pools of warm connections to their dependencies, so usually only the client hops pay handshakes.',
      );
  }
  for (const id of new Set(steps.map((s) => s.edgeId).filter((x): x is string => !!x))) {
    const ed = model.edges.get(id);
    if (ed?.stack.layers.some((l) => l.assumed))
      notes.push(
        `"${label(ed.source)}" → "${label(ed.target)}": no transport in the stack, TCP assumed.`,
      );
  }

  const parts = TRACE_CATEGORIES.filter((c) => breakdown[c] > 0).map(
    (c) => `${TRACE_CATEGORY_LABEL[c]} ${fmt(breakdown[c])}`,
  );
  return {
    flowId: flow.id,
    flowName: flow.name,
    ...(regionId ? { regionId, regionName: region?.name ?? regionId } : {}),
    warm,
    cache: cacheBranch,
    participants,
    steps,
    totalMs,
    breakdown,
    decisions,
    notes: [...new Set(notes)],
    explain:
      steps.length > 0
        ? `One ${warm === false ? 'cold (first)' : warm === 'resumed' ? 'resumed-session' : 'warm'} request${region ? ` from ${region.name}` : ''} = ${parts.join(' + ')} = ${fmt(totalMs)} ms (means: queue Wq and service S from the steady-state run; each message one way ≈ RTT/2)`
        : 'No steps.',
  };
}

/** The first node visited by an expression (for decision labels). */
function firstVisit(e: Expr): string | undefined {
  switch (e.k) {
    case 'visit':
      return e.nodeId;
    case 'seq':
      for (const i of e.items) {
        const v = firstVisit(i);
        if (v) return v;
      }
      return undefined;
    case 'choice':
      return e.options[0] ? firstVisit(e.options[0].expr) : undefined;
    case 'async':
      return firstVisit(e.expr);
    case 'empty':
      return undefined;
  }
}

/** User regions a trace can start from (all registry regions; the board's first). */
export function traceRegions(
  usersByRegion: Readonly<Record<string, number>>,
): { id: string; name: string; users: number }[] {
  const all = USER_REGIONS.map((r) => ({
    id: r.id,
    name: r.name,
    users: usersByRegion[r.id] ?? 0,
  }));
  return [...all.filter((r) => r.users > 0), ...all.filter((r) => r.users <= 0)];
}
