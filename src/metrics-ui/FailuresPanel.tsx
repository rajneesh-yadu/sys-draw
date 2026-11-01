/**
 * Failures over time (S11): edit the board's chaos events, then read the engine's timeline —
 * availability and p99 per second with event markers — and scrub/play it. Scrubbing sets the
 * simulation store's playback tick, which colours the canvas for that second.
 *
 * Two small charts share the time axis (never one chart with two y-scales). Each has a hover
 * tooltip; the marker list and the table are the text views of the same data.
 */
import { Pause, Play, Trash2 } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  formatMs,
  formatPercent,
  formatRps,
  playbackPoint,
  useBoardStore,
  useBoardStoreApi,
  useSimulationStore,
  useSimulationStoreApi,
  CHAOS_EVENT_KINDS,
  type ChaosEvent,
  type ChaosEventKind,
  type Graph,
  type SimResult,
  type TimePoint,
} from '@/store';
import {
  boardRegions,
  buildChaosEvent,
  CHAOS_KIND_META,
  chaosEventLabel,
  chaosWhen,
  emptyDraft,
  eventSpans,
  PLAYBACK_MS_PER_TICK,
  type ChaosDraft,
} from './chaos';

const LINE = '#0284c7';
const CHART_W = 560;
const CHART_H = 96;

const input =
  'w-full rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none dark:border-slate-600 dark:bg-slate-800';
const btn =
  'inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800';

export function FailuresPanel() {
  const result = useSimulationStore((s) => s.result);
  const events = useBoardStore((s) => s.doc.scenario.events);
  const graph = useBoardStore((s) => s.doc.graph);
  return (
    <section
      aria-label="Failures over time"
      data-testid="failures-panel"
      className="space-y-3 border-t border-slate-100 p-3 dark:border-slate-800"
    >
      <h3 className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
        Failures over time
      </h3>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-4">
        <ChaosEditor events={events} graph={graph} />
        {result?.timeline && result.timeline.length > 0 ? (
          <Timeline result={result} timeline={result.timeline} />
        ) : (
          <p className="text-xs text-slate-400">
            Add a chaos event to replay the run second by second: outages, spikes and slowdowns, how
            health checks, retries, circuit breakers and autoscaling react, and when the system
            recovers.
          </p>
        )}
      </div>
    </section>
  );
}

// ───────────────────────────── Editor ─────────────────────────────

function ChaosEditor({ events, graph }: { events: readonly ChaosEvent[]; graph: Graph }) {
  const board = useBoardStoreApi();
  const [draft, setDraft] = useState<ChaosDraft>(() => emptyDraft());
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const id = useId();
  const meta = CHAOS_KIND_META[draft.kind];
  const regions = boardRegions(graph);

  const save = (next: ChaosEvent[]) => {
    const res = board.getState().dispatch({ type: 'updateScenario', patch: { events: next } });
    setError(res.ok ? null : res.reason);
    return res.ok;
  };
  const add = () => {
    const built = buildChaosEvent(draft);
    if (!built.ok) return setError(built.reason);
    if (save([...events, built.event])) {
      setDraft(emptyDraft(draft.kind));
      setAdding(false);
    }
  };

  const targetOptions = (): { value: string; label: string }[] => {
    const nodes = graph.nodes.map((n) => ({ value: n.id, label: n.label }));
    const edges = graph.edges.map((e) => ({
      value: e.id,
      label: `${graph.nodes.find((n) => n.id === e.source)?.label ?? '?'} → ${graph.nodes.find((n) => n.id === e.target)?.label ?? '?'}`,
    }));
    switch (meta.target) {
      case 'node':
      case 'node?':
        return nodes;
      case 'group':
        return graph.groups.map((g) => ({ value: g.id, label: `${g.label} (${g.kind})` }));
      case 'region':
      case 'region?':
      case 'region-pair':
        return regions.map((r) => ({ value: r, label: r }));
      case 'edge?':
        return edges;
      case 'node-or-edge?':
        return [...nodes, ...edges];
    }
  };
  const optional = meta.target.endsWith('?');
  const everything =
    meta.target === 'region?'
      ? 'All users'
      : meta.target === 'node?'
        ? 'All compute'
        : 'Every connection';

  return (
    <div className="space-y-2">
      {events.length === 0 ? (
        <p className="text-xs text-slate-400">No chaos events yet.</p>
      ) : (
        <ul className="space-y-0.5" data-testid="chaos-events">
          {events.map((ev) => (
            <li key={ev.id} className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate" title={CHAOS_KIND_META[ev.kind].help}>
                <span className="font-medium">{chaosEventLabel(ev, graph)}</span>{' '}
                <span className="text-slate-500">{chaosWhen(ev)}</span>
              </span>
              <button
                type="button"
                className={btn}
                aria-label={`Remove ${chaosEventLabel(ev, graph)}`}
                onClick={() => save(events.filter((x) => x.id !== ev.id))}
              >
                <Trash2 aria-hidden className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {!adding ? (
        <button
          type="button"
          className={`${btn} font-medium text-sky-700 dark:text-sky-300`}
          onClick={() => setAdding(true)}
        >
          Add chaos event…
        </button>
      ) : (
        <form
          className="grid grid-cols-2 gap-x-2 gap-y-1"
          aria-label="Add chaos event"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <label className="col-span-2 text-[10px] text-slate-500">
            Event
            <select
              className={input}
              value={draft.kind}
              onChange={(e) => {
                setDraft({ ...emptyDraft(e.target.value as ChaosEventKind), atSec: draft.atSec });
                setError(null);
              }}
            >
              {CHAOS_EVENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {CHAOS_KIND_META[k].label}
                </option>
              ))}
            </select>
          </label>
          <p id={`${id}-help`} className="col-span-2 text-[10px] text-slate-500">
            {meta.help}
          </p>
          <label className="col-span-2 text-[10px] text-slate-500">
            {meta.target === 'region-pair' ? 'Region A' : 'Target'}
            <select
              className={input}
              value={draft.target}
              aria-describedby={`${id}-help`}
              onChange={(e) => setDraft({ ...draft, target: e.target.value })}
            >
              <option value="">{optional ? everything : 'Choose…'}</option>
              {targetOptions().map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {meta.target === 'region-pair' && (
            <label className="col-span-2 text-[10px] text-slate-500">
              Region B
              <select
                className={input}
                value={draft.target2}
                onChange={(e) => setDraft({ ...draft, target2: e.target.value })}
              >
                <option value="">Choose…</option>
                {regions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="text-[10px] text-slate-500">
            Starts at (s)
            <input
              className={input}
              type="number"
              min={0}
              value={draft.atSec}
              onChange={(e) => setDraft({ ...draft, atSec: e.target.value })}
            />
          </label>
          <label className="text-[10px] text-slate-500">
            Lasts (s, empty = to the end)
            <input
              className={input}
              type="number"
              min={1}
              value={draft.durationSec}
              onChange={(e) => setDraft({ ...draft, durationSec: e.target.value })}
            />
          </label>
          {meta.params.map((p) => (
            <label key={p.key} className="text-[10px] text-slate-500">
              {p.label}
              {p.optional ? ' (optional)' : ''}
              <input
                className={input}
                type="number"
                min={p.min}
                {...(p.max !== undefined ? { max: p.max } : {})}
                step={p.step}
                value={draft.params[p.key] ?? ''}
                onChange={(e) =>
                  setDraft({ ...draft, params: { ...draft.params, [p.key]: e.target.value } })
                }
              />
            </label>
          ))}
          <div className="col-span-2 flex items-center gap-2">
            <button type="submit" className={`${btn} font-medium text-sky-700 dark:text-sky-300`}>
              Add event
            </button>
            <button
              type="button"
              className={btn}
              onClick={() => {
                setAdding(false);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

// ───────────────────────────── Timeline ─────────────────────────────

function Timeline({ result, timeline }: { result: SimResult; timeline: readonly TimePoint[] }) {
  const sim = useSimulationStoreApi();
  const playback = useSimulationStore((s) => s.playback);
  const markers = useMemo(() => result.timelineEvents ?? [], [result.timelineEvents]);
  const n = timeline.length;
  const tickSec = n > 1 ? (timeline[1] as TimePoint).tSec - (timeline[0] as TimePoint).tSec : 1;
  const endSec = ((timeline[n - 1] as TimePoint).tSec ?? 0) + tickSec;
  const current = playbackPoint(result, playback);
  const spans = useMemo(() => eventSpans(markers, endSec), [markers, endSec]);

  useEffect(() => {
    if (!playback.playing) return;
    const h = setInterval(() => sim.getState().advance(), PLAYBACK_MS_PER_TICK);
    return () => clearInterval(h);
  }, [playback.playing, sim]);

  const data = useMemo(
    () => timeline.map((p) => ({ t: p.tSec, availability: p.availability * 100, p99: p.p99Ms })),
    [timeline],
  );
  const indexOfT = (t: number) => Math.round(t / tickSec);
  const onChartClick = (state: { activeLabel?: unknown } | null) => {
    const t = Number(state?.activeLabel);
    if (Number.isFinite(t)) sim.getState().setTick(indexOfT(t));
  };
  const minAvail = Math.min(...timeline.map((p) => p.availability));

  const chart = (key: 'availability' | 'p99', title: string, fmt: (v: number) => string) => (
    <figure aria-label={title} className="text-slate-500">
      <figcaption className="text-[10px] font-medium text-slate-600 dark:text-slate-300">
        {title}
      </figcaption>
      <LineChart
        width={CHART_W}
        height={CHART_H}
        data={data}
        margin={{ top: 4, right: 12, bottom: 0, left: 0 }}
        onClick={onChartClick}
        className="cursor-crosshair"
      >
        <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.12} />
        {spans.map((s) => (
          <ReferenceArea
            key={s.eventId}
            x1={s.from}
            x2={Math.min(s.to, (timeline[n - 1] as TimePoint).tSec)}
            fill="currentColor"
            fillOpacity={0.07}
            ifOverflow="hidden"
          />
        ))}
        {markers.map((m, i) => (
          <ReferenceLine
            key={`${m.kind}-${m.tSec}-${i}`}
            x={m.tSec}
            stroke="currentColor"
            strokeOpacity={0.45}
            strokeDasharray="3 3"
          />
        ))}
        {current && (
          <ReferenceLine x={current.tSec} stroke={LINE} strokeWidth={2} ifOverflow="hidden" />
        )}
        <XAxis
          dataKey="t"
          type="number"
          domain={[0, (timeline[n - 1] as TimePoint).tSec]}
          tick={{ fontSize: 10, fill: 'currentColor' }}
          tickFormatter={(v: number) => `${v} s`}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          width={52}
          tick={{ fontSize: 10, fill: 'currentColor' }}
          tickFormatter={(v: number) => fmt(v)}
          axisLine={false}
          tickLine={false}
          {...(key === 'availability'
            ? { domain: [minAvail >= 0.99 ? 90 : 0, 100] as [number, number] }
            : {})}
        />
        <Tooltip
          cursor={{ stroke: 'currentColor', strokeOpacity: 0.3 }}
          labelFormatter={(v) => `t = ${String(v)} s`}
          formatter={(v) => [fmt(Number(v)), title]}
          contentStyle={{ fontSize: 11, padding: '2px 6px' }}
        />
        <Line
          dataKey={key}
          stroke={LINE}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
          isAnimationActive={false}
        />
      </LineChart>
    </figure>
  );

  return (
    <div className="min-w-0 space-y-2" data-testid="timeline">
      <Scrubber timeline={timeline} />
      <div className="overflow-x-auto">
        {chart('availability', 'Availability', (v) => `${Math.round(v * 10) / 10}%`)}
        {chart('p99', 'p99 latency', (v) => formatMs(v))}
      </div>
      {markers.length > 0 && (
        <ol
          className="space-y-0.5 text-xs"
          data-testid="timeline-markers"
          aria-label="Timeline events"
        >
          {markers.map((m, i) => (
            <li key={`${m.kind}-${m.tSec}-${i}`}>
              <button
                type="button"
                className="w-full rounded px-1 text-left hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none dark:hover:bg-slate-800"
                onClick={() => sim.getState().setTick(indexOfT(m.tSec))}
              >
                <span className="inline-block w-12 tabular-nums text-slate-500">{m.tSec} s</span>
                {m.label}
              </button>
            </li>
          ))}
        </ol>
      )}
      <details className="text-xs">
        <summary className="cursor-pointer text-slate-500">Show as table</summary>
        <TimelineTable timeline={timeline} />
      </details>
    </div>
  );
}

function Scrubber({ timeline }: { timeline: readonly TimePoint[] }) {
  const sim = useSimulationStoreApi();
  const playback = useSimulationStore((s) => s.playback);
  const result = useSimulationStore((s) => s.result);
  const events = useBoardStore((s) => s.doc.scenario.events);
  const graph = useBoardStore((s) => s.doc.graph);
  const p = playbackPoint(result, playback);
  const n = timeline.length;
  const active = (p?.activeEventIds ?? [])
    .map((id) => events.find((e) => e.id === id))
    .filter((e): e is ChaosEvent => e !== undefined);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={btn}
          onClick={() => (playback.playing ? sim.getState().pause() : sim.getState().play())}
          aria-label={playback.playing ? 'Pause timeline' : 'Play timeline'}
        >
          {playback.playing ? (
            <Pause aria-hidden className="h-3 w-3" />
          ) : (
            <Play aria-hidden className="h-3 w-3" />
          )}
          {playback.playing ? 'Pause' : 'Play'}
        </button>
        <input
          type="range"
          className="min-w-0 flex-1 accent-sky-600"
          min={0}
          max={n - 1}
          step={1}
          value={playback.tick ?? 0}
          aria-label="Timeline position"
          aria-valuetext={p ? `${p.tSec} seconds` : 'Steady state'}
          onChange={(e) => sim.getState().setTick(Number(e.target.value))}
        />
        <button
          type="button"
          className={btn}
          disabled={playback.tick === null}
          onClick={() => sim.getState().setTick(null)}
          title="Show the steady-state numbers on the canvas again"
        >
          Steady state
        </button>
      </div>
      <p className="text-xs tabular-nums" data-testid="timeline-readout" aria-live="polite">
        {p ? (
          <>
            <span className="font-semibold">t = {p.tSec} s</span> · {formatRps(p.rps)} ·
            availability{' '}
            <span
              className={
                p.availability < 0.99 ? 'font-semibold text-red-700 dark:text-red-300' : ''
              }
            >
              {formatPercent(p.availability)}
            </span>{' '}
            · p99 {formatMs(p.p99Ms)}
            {active.length > 0 && (
              <span className="text-slate-500">
                {' '}
                · {active.map((e) => chaosEventLabel(e, graph)).join(', ')}
              </span>
            )}
          </>
        ) : (
          <span className="text-slate-500">
            Canvas shows the steady state. Drag the slider or press Play to replay the run.
          </span>
        )}
      </p>
    </div>
  );
}

function TimelineTable({ timeline }: { timeline: readonly TimePoint[] }) {
  return (
    <table className="mt-1 w-full text-xs tabular-nums">
      <caption className="sr-only">Availability and latency per second</caption>
      <thead>
        <tr className="text-left text-[10px] tracking-wide text-slate-500 uppercase">
          <th scope="col">t</th>
          <th scope="col" className="text-right">
            rps
          </th>
          <th scope="col" className="text-right">
            Availability
          </th>
          <th scope="col" className="text-right">
            p50
          </th>
          <th scope="col" className="text-right">
            p99
          </th>
        </tr>
      </thead>
      <tbody>
        {timeline.map((p) => (
          <tr key={p.tSec} className="border-t border-slate-100 dark:border-slate-800">
            <th scope="row" className="text-left font-normal">
              {p.tSec} s
            </th>
            <td className="text-right">{formatRps(p.rps)}</td>
            <td className="text-right">{formatPercent(p.availability)}</td>
            <td className="text-right">{formatMs(p.p50Ms)}</td>
            <td className="text-right">{formatMs(p.p99Ms)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
