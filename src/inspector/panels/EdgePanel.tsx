/**
 * Edge panel: protocol stack picker (filtered by ports + runsOn) with the registry's suggested
 * stack, sync/async, timeout, retries; "Network" tab (S14) with OSI layers, handshakes, ports,
 * encryption and warnings.
 */
import { useId, useMemo, useState } from 'react';
import { z } from 'zod';
import { connectionCost, encryptionStatus, resolveStack, stackLabel } from '@/network';
import { registry } from '@/registry';
import {
  EdgeConfigSchema,
  edgeProtocolStackOptions,
  edgeStackSuggestion,
  type EdgeConfigPatch,
  type EdgeInstance,
  type Graph,
  type Scenario,
} from '@/store';
import type { FieldOverrides } from '../form/model';
import { SchemaForm } from '../form/SchemaForm';
import { ProtocolDocs } from './DocsView';
import { EdgeNetwork } from './EdgeNetwork';
import { PanelTitle, Section, Tabs } from './common';
import { useDispatch } from './use-dispatch';

const EdgeFormSchema = z.object({ sync: z.boolean(), ...EdgeConfigSchema.shape });

const EDGE_OVERRIDES: FieldOverrides = {
  sync: {
    label: 'Synchronous (caller waits for the reply)',
    help: 'Off = asynchronous: fire-and-forget, e.g. into a queue',
  },
  timeoutMs: { label: 'Timeout', help: 'Give up waiting after this long (empty = engine default)' },
  retries: { help: 'Extra attempts after a failure or timeout' },
  backoff: {
    label: 'Retry backoff',
    advanced: true,
    help: 'Wait between retries: none, fixed or exponential',
  },
  poolSize: {
    label: 'Connection pool',
    advanced: true,
    help: 'Connections kept open to the target',
  },
  breakerErrorThreshold: {
    label: 'Circuit breaker: open at failure ratio',
    advanced: true,
    help: 'Open when this share of calls failed over the last 10 s (e.g. 0.5); empty = no breaker',
  },
  newConnectionShare: {
    label: 'New connections',
    help: 'Share of requests that open a new connection and pay its handshakes (0 = keep-alive / pooled, 1 = every request)',
  },
  breakerOpenSec: {
    label: 'Circuit breaker: open for (s)',
    advanced: true,
    help: 'Fail fast this long before letting a trial through (default 30 s)',
  },
};

/** Bottom-up stack → "TCP › TLS 1.3 › HTTP/2". */
const label = (stack: readonly string[]) => stackLabel(registry, stack);

export function EdgePanel({
  edge,
  graph,
  scenario,
}: {
  edge: EdgeInstance;
  graph: Graph;
  scenario: Scenario;
}) {
  const dispatch = useDispatch();
  const pickerId = useId();
  const [pickError, setPickError] = useState<string | null>(null);
  const source = graph.nodes.find((n) => n.id === edge.source);
  const target = graph.nodes.find((n) => n.id === edge.target);

  const options = useMemo(() => {
    const opts = edgeProtocolStackOptions(registry, graph, edge);
    const cur = edge.protocolStack.join('/');
    return opts.some((o) => o.join('/') === cur) ? opts : [edge.protocolStack, ...opts];
  }, [graph, edge]);

  const resolved = useMemo(() => resolveStack(registry, edge.protocolStack), [edge.protocolStack]);
  const handshakeRtts = connectionCost(resolved, 1).rtts;
  const encrypted = encryptionStatus(resolved).encrypted;
  const suggestion = useMemo(() => edgeStackSuggestion(registry, graph, edge), [graph, edge]);
  const showSuggestion =
    suggestion !== undefined && suggestion.stack.join('/') !== edge.protocolStack.join('/');
  const pick = (stack: string[]) => {
    const res = dispatch({ type: 'updateEdge', edgeId: edge.id, protocolStack: stack });
    setPickError(res.ok ? null : res.reason);
  };

  const settings = (
    <>
      <Section title="Protocol stack">
        <div>
          <label
            htmlFor={pickerId}
            className="mb-0.5 block text-xs font-medium text-slate-700 dark:text-slate-300"
          >
            Stack (bottom › top)
          </label>
          <select
            id={pickerId}
            className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none dark:border-slate-600 dark:bg-slate-800"
            value={edge.protocolStack.join('/')}
            aria-invalid={pickError !== null}
            aria-describedby={`${pickerId}-sum${pickError !== null ? ` ${pickerId}-err` : ''}`}
            onChange={(e) => pick(e.target.value.split('/'))}
          >
            {options.map((o) => (
              <option key={o.join('/')} value={o.join('/')}>
                {label(o)}
              </option>
            ))}
          </select>
          <p id={`${pickerId}-sum`} className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {handshakeRtts} handshake RTT{handshakeRtts === 1 ? '' : 's'} on a new connection ·{' '}
            {encrypted ? 'encrypted in transit' : 'plaintext — add TLS for anything sensitive'}
          </p>
          {showSuggestion && (
            <div className="mt-1 rounded border border-sky-200 bg-sky-50 p-2 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200">
              <p>
                <strong>Suggested:</strong> {label(suggestion.stack)} — {suggestion.why}
              </p>
              <button
                type="button"
                className="mt-1 rounded border border-sky-400 px-2 py-0.5 font-medium hover:bg-sky-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none dark:hover:bg-sky-900"
                onClick={() => pick(suggestion.stack)}
              >
                Use {label(suggestion.stack)}
              </button>
            </div>
          )}
          {pickError !== null && (
            <p id={`${pickerId}-err`} role="alert" className="mt-0.5 text-xs text-red-600">
              {pickError}
            </p>
          )}
        </div>
      </Section>
      <Section title="Behaviour">
        <SchemaForm
          label="Connection settings"
          schema={EdgeFormSchema}
          value={{ sync: edge.sync, ...edge.config }}
          overrides={EDGE_OVERRIDES}
          onCommit={(p) => {
            if ('sync' in p)
              return dispatch({ type: 'updateEdge', edgeId: edge.id, sync: p.sync === true });
            const config = Object.fromEntries(
              Object.entries(p).map(([k, v]) => [k, v === undefined ? null : v]),
            ) as EdgeConfigPatch;
            return dispatch({ type: 'updateEdge', edgeId: edge.id, config });
          }}
        />
      </Section>
    </>
  );

  const docs = (
    <div className="space-y-3">
      {[...edge.protocolStack].reverse().map((id) => {
        const p = registry.get(id, 'protocol');
        return p ? (
          <ProtocolDocs key={id} def={p} />
        ) : (
          <p key={id} className="text-xs text-slate-500 dark:text-slate-400">
            {id}: no docs yet (protocol not in the registry).
          </p>
        );
      })}
    </div>
  );

  return (
    <div>
      <div className="px-3 pt-3">
        <PanelTitle
          title="Connection"
          subtitle={`${source?.label ?? edge.source} → ${target?.label ?? edge.target}`}
        />
      </div>
      <Tabs
        tabs={[
          { id: 'settings', label: 'Settings', content: settings },
          {
            id: 'network',
            label: 'Network',
            content: <EdgeNetwork edge={edge} graph={graph} scenario={scenario} />,
          },
          { id: 'docs', label: 'Docs', content: docs },
        ]}
      />
    </div>
  );
}
