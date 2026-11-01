/**
 * Edge panel → "Network" tab (S14): what travels on this connection. All numbers and texts come
 * from the network module and registry protocol entries; nothing about protocols lives here.
 */
import { useId, useMemo, useState } from 'react';
import {
  encryptionStatus,
  handshakeSequence,
  osiView,
  perRequestOverhead,
  requestLatency,
  resolveStack,
  stackPorts,
  stackWarnings,
  type Warmth,
} from '@/network';
import { registry } from '@/registry';
import {
  formatMs,
  useSimulationStore,
  type EdgeInstance,
  type Graph,
  type Scenario,
} from '@/store';
import { Section } from './common';

const WARMTH: { id: string; label: string; value: Warmth }[] = [
  { id: 'cold', label: 'New connection', value: false },
  { id: 'resumed', label: 'Resumed session', value: 'resumed' },
  { id: 'warm', label: 'Warm (reused)', value: true },
];

const rttLabel = (n: number) => `${n} RTT${n === 1 ? '' : 's'}`;

/** True when one end is a client app: the edge crosses the public internet. */
function crossesInternet(graph: Graph, edge: EdgeInstance): boolean {
  return [edge.source, edge.target].some((id) => {
    const n = graph.nodes.find((x) => x.id === id);
    return n !== undefined && registry.get(n.defId, 'component')?.category === 'clients';
  });
}

function edgeLossRate(scenario: Scenario, edgeId: string): number {
  return scenario.events.reduce(
    (max, ev) =>
      ev.kind === 'packetLoss' && (ev.edgeId === undefined || ev.edgeId === edgeId)
        ? Math.max(max, ev.lossRate)
        : max,
    0,
  );
}

export function EdgeNetwork({
  edge,
  graph,
  scenario,
}: {
  edge: EdgeInstance;
  graph: Graph;
  scenario: Scenario;
}) {
  const warmthId = useId();
  const [warmth, setWarmth] = useState<string>('cold');
  const metrics = useSimulationStore((s) => s.result?.perEdge[edge.id]);
  const stack = useMemo(() => resolveStack(registry, edge.protocolStack), [edge.protocolStack]);
  const rtt = metrics?.rttMs;
  const enc = encryptionStatus(stack);
  const ports = stackPorts(stack);
  const overhead = perRequestOverhead(stack, scenario.payloadBytes);
  const warnings = stackWarnings(registry, stack, {
    crossesInternet: crossesInternet(graph, edge),
    lossRate: edgeLossRate(scenario, edge.id),
    newConnectionShare: edge.config.newConnectionShare,
  });
  const selected = WARMTH.find((w) => w.id === warmth) ?? WARMTH[0]!;
  const sequence = handshakeSequence(stack, selected.value);

  return (
    <div className="space-y-4">
      <Section title="Summary">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-slate-500 dark:text-slate-400">Encryption</dt>
          <dd
            data-testid="edge-encryption"
            className={
              enc.encrypted
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-amber-700 dark:text-amber-400'
            }
          >
            {enc.encrypted ? '🔒 ' : '⚠ '}
            {enc.summary}
          </dd>
          <dt className="text-slate-500 dark:text-slate-400">Ports</dt>
          <dd>
            {ports
              ? `${ports.transport} ${ports.ports.join(', ')} (${ports.name}${ports.secure ? ' over TLS' : ''})`
              : 'Application-defined'}
          </dd>
          <dt className="text-slate-500 dark:text-slate-400">Headers</dt>
          <dd title={overhead.explain}>
            +{Math.round(overhead.overheadBytes)} B per request + response
            {overhead.perLayer.length > 0 &&
              ` (${overhead.perLayer.map((l) => `${l.name} ${Math.round(l.bytes)} B`).join(', ')})`}
          </dd>
        </dl>
      </Section>

      <Section title="Request latency">
        <table className="w-full text-xs" aria-label="Request latency by connection state">
          <thead>
            <tr className="text-left text-slate-500 dark:text-slate-400">
              <th className="font-medium">Connection</th>
              <th className="font-medium">Round trips</th>
              <th className="text-right font-medium">Time</th>
            </tr>
          </thead>
          <tbody>
            {WARMTH.map((w) => {
              const r = requestLatency(stack, rtt ?? 0, w.value);
              return (
                <tr key={w.id} title={rtt !== undefined ? r.explain : undefined}>
                  <td>{w.label}</td>
                  <td>{rttLabel(r.rtts)}</td>
                  <td className="text-right tabular-nums">
                    {rtt !== undefined ? formatMs(r.totalMs) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          {rtt !== undefined
            ? `RTT ${formatMs(rtt)} between the two ends (from the last run). One request = 1 RTT; a new connection first pays the handshakes.`
            : 'Run the simulation to turn round trips into milliseconds (place components in Region groups).'}
        </p>
      </Section>

      <Section title="OSI layers">
        <ol
          aria-label="OSI layers"
          className="divide-y divide-slate-100 rounded border border-slate-200 text-xs dark:divide-slate-800 dark:border-slate-700"
        >
          {osiView(registry, stack).map((row) => (
            <li key={row.layer} className="flex gap-2 px-2 py-1">
              <span className="w-28 shrink-0 text-slate-500 dark:text-slate-400">
                {row.layer} {row.name}
              </span>
              <span className="text-slate-800 dark:text-slate-200">
                {row.protocols.length > 0 ? (
                  row.protocols
                    .map(
                      (p) =>
                        `${p.name}${p.source === 'implicit' ? ' (implicit)' : p.source === 'assumed' ? ' (assumed)' : ''}`,
                    )
                    .join(' · ')
                ) : (
                  <span className="text-slate-500 dark:text-slate-400">{row.note ?? '—'}</span>
                )}
              </span>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Handshake">
        <div
          role="radiogroup"
          aria-labelledby={`${warmthId}-label`}
          className="flex flex-wrap gap-1"
        >
          <span id={`${warmthId}-label`} className="sr-only">
            Connection state
          </span>
          {WARMTH.map((w) => (
            <button
              key={w.id}
              type="button"
              role="radio"
              aria-checked={warmth === w.id}
              onClick={() => setWarmth(w.id)}
              className={`rounded border px-2 py-0.5 text-xs focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none ${
                warmth === w.id
                  ? 'border-sky-600 bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-300'
                  : 'border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-400'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
        {sequence.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            No handshake: the request goes out at once (1 RTT for request and response).
          </p>
        ) : (
          <ol aria-label="Handshake sequence" className="space-y-2 text-xs">
            {sequence.map((g) => (
              <li key={g.protocolId}>
                <p className="font-medium text-slate-700 dark:text-slate-300">
                  {g.name} — {rttLabel(g.rtts)}
                  {g.startRtt > 0 ? ` (after ${rttLabel(g.startRtt)})` : ''}
                  {rtt !== undefined ? ` · ${formatMs(g.rtts * rtt)}` : ''}
                </p>
                <ul className="mt-0.5 space-y-0.5 pl-2">
                  {g.messages.map((m, i) => (
                    <li key={i} className="text-slate-600 dark:text-slate-400">
                      <span className="font-mono">
                        {m.from === 'client' ? 'client → server' : 'server → client'}
                      </span>{' '}
                      {m.message}
                      {m.detail !== undefined && (
                        <span className="text-slate-500 dark:text-slate-400"> ({m.detail})</span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </Section>

      {warnings.length > 0 && (
        <Section title="Warnings">
          <ul aria-label="Protocol warnings" className="space-y-1 text-xs">
            {warnings.map((w) => (
              <li
                key={w.message}
                className={
                  w.level === 'warning'
                    ? 'text-amber-800 dark:text-amber-300'
                    : 'text-slate-600 dark:text-slate-400'
                }
              >
                <strong>{w.level === 'warning' ? 'Warning: ' : 'Note: '}</strong>
                {w.message}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
