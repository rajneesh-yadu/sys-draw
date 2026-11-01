import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, X } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { USER_REGIONS } from '@/registry';
import { formatMs, formatPercent, useBoardStore } from '@/store';
import { traceColor } from './colors';
import { useTraceStore, useTraceStoreApi } from './context';
import { breakdownShares, elapsedAt, layerTag, sequenceLayout, STEP_INTERVAL_MS } from './sequence';
import { currentTraceStep, type TraceView, type TraceWarmth } from './trace-store';

const btn =
  'inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none dark:text-slate-200 dark:hover:bg-slate-800';
const select =
  'w-full rounded border border-slate-200 bg-white px-1 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-900';

const WARMTH: { value: string; warm: TraceWarmth; label: string; title: string }[] = [
  {
    value: 'cold',
    warm: false,
    label: 'Cold',
    title: 'First request: DNS lookup and a new connection (handshakes) on every hop',
  },
  {
    value: 'resumed',
    warm: 'resumed',
    label: 'Resumed',
    title: 'New connections, but TLS / QUIC sessions resume (0-RTT); DNS cached',
  },
  {
    value: 'warm',
    warm: true,
    label: 'Warm',
    title: 'Reused (pooled) connections and cached DNS: no handshakes',
  },
];

const warmthValue = (w: TraceWarmth) =>
  w === true ? 'warm' : w === 'resumed' ? 'resumed' : 'cold';

/**
 * Request trace side panel (S15): pick a flow, user region and cold/warm connections; step
 * through one request as a sequence diagram while the canvas animates each packet on its edge.
 */
export function TracePanel() {
  const api = useTraceStoreApi();
  const open = useTraceStore((s) => s.open);
  const playing = useTraceStore((s) => s.playing);

  useEffect(() => {
    if (!playing) return;
    api.getState().advance(); // first step right away
    const t = setInterval(() => api.getState().advance(), STEP_INTERVAL_MS);
    return () => clearInterval(t);
  }, [playing, api]);

  if (!open) return null;
  return (
    <aside
      aria-label="Request trace"
      data-testid="trace-panel"
      className="flex h-full w-96 flex-col overflow-hidden border-l border-slate-200 bg-white text-slate-800 shadow-lg dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
    >
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <h2 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Request trace
        </h2>
        <button
          type="button"
          className={`${btn} ml-auto`}
          onClick={() => api.getState().setOpen(false)}
          aria-label="Close request trace"
        >
          <X aria-hidden className="h-3.5 w-3.5" />
        </button>
      </div>
      <TraceOptions />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <TraceBody />
      </div>
    </aside>
  );
}

function TraceOptions() {
  const api = useTraceStoreApi();
  const request = useTraceStore((s) => s.request);
  const flows = useBoardStore((s) => s.doc.scenario.flows);
  const users = useBoardStore((s) => s.doc.scenario.usersByRegion);
  const regions = useMemo(
    () => [...USER_REGIONS].sort((a, b) => (users[b.id] ?? 0) - (users[a.id] ?? 0)),
    [users],
  );
  const set = api.getState().setRequest;
  return (
    <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 border-b border-slate-200 px-3 py-2 text-xs dark:border-slate-800">
      <label className="flex flex-col gap-0.5">
        <span className="text-slate-500">Flow</span>
        <select
          className={select}
          value={request.flowId ?? ''}
          onChange={(e) => set({ flowId: e.target.value || undefined })}
        >
          {flows.length === 0 && <option value="">All traffic (inferred)</option>}
          {flows.length > 0 && <option value="">First flow</option>}
          {flows.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-slate-500">Users in</span>
        <select
          className={select}
          value={request.regionId ?? ''}
          onChange={(e) => set({ regionId: e.target.value || undefined })}
        >
          <option value="">Most users</option>
          {regions.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
              {(users[r.id] ?? 0) > 0 ? '' : ' (no users)'}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="col-span-2 flex items-center gap-1">
        <legend className="sr-only">Connection</legend>
        <span className="mr-1 text-slate-500" aria-hidden>
          Connection
        </span>
        {WARMTH.map((w) => (
          <label
            key={w.value}
            title={w.title}
            className={`cursor-pointer rounded border px-1.5 py-0.5 ${
              warmthValue(request.warm) === w.value
                ? 'border-sky-500 bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-200'
                : 'border-slate-200 dark:border-slate-700'
            }`}
          >
            <input
              type="radio"
              name="trace-warmth"
              className="sr-only"
              value={w.value}
              checked={warmthValue(request.warm) === w.value}
              onChange={() => set({ warm: w.warm })}
            />
            {w.label}
          </label>
        ))}
        <label className="ml-auto flex items-center gap-1">
          <span className="text-slate-500">Cache</span>
          <select
            className="rounded border border-slate-200 bg-white px-1 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-900"
            value={request.cache}
            onChange={(e) => set({ cache: e.target.value === 'hit' ? 'hit' : 'miss' })}
          >
            <option value="miss">miss</option>
            <option value="hit">hit</option>
          </select>
        </label>
      </fieldset>
    </div>
  );
}

function TraceBody() {
  const trace = useTraceStore((s) => s.trace);
  const status = useTraceStore((s) => s.status);
  const error = useTraceStore((s) => s.error);
  if (error) {
    return (
      <p role="alert" className="px-3 py-2 text-xs text-red-700 dark:text-red-300">
        {error}
      </p>
    );
  }
  if (!trace) {
    return (
      <p className="px-3 py-2 text-xs text-slate-500">
        {status === 'running' ? 'Tracing…' : 'No trace yet.'}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3 px-3 py-2 text-xs">
      <StepControls trace={trace} />
      <TimeBreakdown trace={trace} />
      <StepDetail />
      <SequenceDiagram trace={trace} />
      {(trace.decisions.length > 0 || trace.notes.length > 0) && (
        <ul
          className="list-disc space-y-0.5 pl-4 text-slate-600 dark:text-slate-300"
          data-testid="trace-notes"
        >
          {trace.decisions.map((d, i) => (
            <li key={`d${i}`}>{d.text}</li>
          ))}
          {trace.notes.map((n, i) => (
            <li key={`n${i}`} className="text-amber-800 dark:text-amber-300">
              {n}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StepControls({ trace }: { trace: TraceView }) {
  const api = useTraceStoreApi();
  const step = useTraceStore((s) => s.step);
  const playing = useTraceStore((s) => s.playing);
  const n = trace.steps.length;
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Step through the request">
      <button
        type="button"
        className={btn}
        onClick={() => api.getState().reset()}
        aria-label="Back to start"
        disabled={step < 0}
      >
        <RotateCcw aria-hidden className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className={btn}
        onClick={() => api.getState().prev()}
        aria-label="Previous step"
        disabled={step < 0}
      >
        <ChevronLeft aria-hidden className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className={`${btn} text-sky-700 dark:text-sky-300`}
        onClick={() => (playing ? api.getState().pause() : api.getState().play())}
        disabled={n === 0}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? (
          <Pause aria-hidden className="h-3.5 w-3.5" />
        ) : (
          <Play aria-hidden className="h-3.5 w-3.5" />
        )}
        {playing ? 'Pause' : 'Play'}
      </button>
      <button
        type="button"
        className={btn}
        onClick={() => api.getState().next()}
        aria-label="Next step"
        disabled={step >= n - 1}
      >
        <ChevronRight aria-hidden className="h-3.5 w-3.5" />
      </button>
      <span
        className="ml-auto text-slate-500 tabular-nums"
        data-testid="trace-position"
        aria-live="polite"
      >
        Step {Math.max(0, step + 1)} / {n} · {formatMs(elapsedAt(trace, step))}
      </span>
    </div>
  );
}

function TimeBreakdown({ trace }: { trace: TraceView }) {
  const parts = breakdownShares(trace.breakdown);
  return (
    <section aria-label="Where time goes" data-testid="trace-breakdown">
      <div className="mb-1 flex items-baseline gap-2">
        <h3 className="font-semibold">Where time goes</h3>
        <span
          className="ml-auto font-semibold tabular-nums"
          data-testid="trace-total"
          title={trace.explain}
        >
          {formatMs(trace.totalMs)}
        </span>
      </div>
      {parts.length > 0 && (
        <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded" aria-hidden>
          {parts.map((p) => (
            <div
              key={p.id}
              title={`${p.label}: ${formatMs(p.ms)} (${formatPercent(p.share)})`}
              style={{ width: `${p.share * 100}%`, background: traceColor(p.id), minWidth: 2 }}
            />
          ))}
        </div>
      )}
      <table className="mt-1 w-full tabular-nums">
        <tbody>
          {parts.map((p) => (
            <tr key={p.id} data-testid={`trace-cat-${p.id}`}>
              <td className="py-0.5">
                <span
                  aria-hidden
                  className="mr-1.5 inline-block h-2 w-2 rounded-sm align-middle"
                  style={{ background: traceColor(p.id) }}
                />
                {p.label}
              </td>
              <td className="text-right">{formatMs(p.ms)}</td>
              <td className="w-12 text-right text-slate-500">{formatPercent(p.share)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function StepDetail() {
  const step = useTraceStore(currentTraceStep);
  const trace = useTraceStore((s) => s.trace);
  if (!step || !trace) {
    return (
      <p className="rounded border border-dashed border-slate-200 px-2 py-1.5 text-slate-500 dark:border-slate-700">
        Press Play or Next to send the request; each packet moves along its connection on the
        canvas.
      </p>
    );
  }
  const name = (id: string) => trace.participants.find((p) => p.id === id)?.label ?? id;
  return (
    <section
      aria-label="Current step"
      data-testid="trace-step-detail"
      className="rounded border border-slate-200 px-2 py-1.5 dark:border-slate-700"
    >
      <div className="flex items-baseline gap-2">
        <span
          className="rounded px-1 text-[10px] font-semibold text-white"
          style={{ background: traceColor(step.category) }}
        >
          {layerTag(step)}
        </span>
        <span className="font-semibold">{step.message}</span>
        {step.async && <span className="text-slate-500">(async)</span>}
      </div>
      <div className="mt-0.5 text-slate-600 dark:text-slate-300">
        {step.from === step.to ? name(step.from) : `${name(step.from)} → ${name(step.to)}`} ·{' '}
        <span className="tabular-nums">
          {formatMs(step.timeMs)} (at {formatMs(step.startMs)})
        </span>
      </div>
      {step.headers.length > 0 && (
        <ul
          className="mt-1 space-y-0.5 font-mono text-[10.5px] text-slate-700 dark:text-slate-300"
          aria-label="Key headers"
        >
          {step.headers.map((h, i) => (
            <li key={i}>{h}</li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-slate-500">{step.explain}</p>
    </section>
  );
}

function SequenceDiagram({ trace }: { trace: TraceView }) {
  const api = useTraceStoreApi();
  const current = useTraceStore((s) => s.step);
  const { columns, rows } = useMemo(() => sequenceLayout(trace), [trace]);
  return (
    <section aria-label="Sequence diagram" data-testid="trace-sequence">
      <h3 className="mb-1 font-semibold">Sequence</h3>
      <div className="relative">
        <div className="sticky top-0 z-10 flex bg-white dark:bg-slate-900">
          {columns.map((c) => (
            <div
              key={c.id}
              className="min-w-0 flex-1 truncate border-b border-slate-200 px-0.5 pb-0.5 text-center text-[10px] font-semibold dark:border-slate-700"
              title={c.label}
            >
              {c.label}
            </div>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-0 top-5" aria-hidden>
          {columns.map((c) => (
            <div
              key={c.id}
              className="absolute top-0 bottom-0 border-l border-dashed border-slate-300 dark:border-slate-700"
              style={{ left: `${c.x}%` }}
            />
          ))}
        </div>
        <ol className="relative">
          {rows.map(({ step, x1, x2, self }) => {
            const active = step.index === current;
            const future = step.index > current;
            const left = Math.min(x1, x2);
            const width = Math.abs(x2 - x1);
            const color = traceColor(step.category);
            return (
              <li key={step.index}>
                <button
                  type="button"
                  onClick={() => api.getState().setStep(step.index)}
                  data-testid="trace-row"
                  data-kind={step.kind}
                  data-active={active || undefined}
                  aria-current={active ? 'step' : undefined}
                  aria-label={`Step ${step.index + 1}: ${step.layer} ${step.message}, ${formatMs(step.timeMs)}`}
                  className={`relative block h-8 w-full text-left focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none ${
                    active
                      ? 'bg-sky-50 dark:bg-sky-950/60'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                  } ${future ? 'opacity-45' : ''}`}
                >
                  <span
                    className={`absolute top-0.5 truncate text-[10px] leading-tight ${self && x1 > 50 ? 'text-right' : ''}`}
                    style={
                      self && x1 > 50
                        ? { right: `${100 - x1 + 2}%`, maxWidth: `${x1 - 2}%` }
                        : {
                            left: `${self ? x1 + 2 : left}%`,
                            maxWidth: `${self ? 98 - x1 : Math.max(width, 40)}%`,
                          }
                    }
                  >
                    <span className="text-slate-500">{step.layer} </span>
                    {step.message}
                    <span className="ml-1 text-slate-500 tabular-nums">
                      {formatMs(step.timeMs)}
                    </span>
                  </span>
                  {self ? (
                    <span
                      aria-hidden
                      className="absolute bottom-1 h-3 w-1.5 -translate-x-1/2 rounded-sm"
                      style={{ left: `${x1}%`, background: color }}
                    />
                  ) : (
                    <span
                      aria-hidden
                      className={`absolute bottom-1.5 h-0 border-t-2 ${step.async ? 'border-dashed' : ''}`}
                      style={{ left: `${left}%`, width: `${width}%`, borderColor: color }}
                    >
                      <span
                        className="absolute -top-[5px] h-0 w-0 border-y-4 border-y-transparent"
                        style={
                          x2 >= x1
                            ? { right: -1, borderLeft: `6px solid ${color}` }
                            : { left: -1, borderRight: `6px solid ${color}` }
                        }
                      />
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
