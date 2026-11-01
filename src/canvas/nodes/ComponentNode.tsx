import { Handle, Position, type NodeProps } from '@xyflow/react';
import { CircleX, TriangleAlert } from 'lucide-react';
import { memo } from 'react';
import {
  formatMs,
  formatPercent,
  formatRps,
  playbackPoint,
  useSimulationStore,
  UTILIZATION_LEVEL_LABEL,
  type NodeMetrics,
  type NodeTick,
} from '@/store';
import { LEVEL_STYLES, utilizationLevel } from '../overlay';
import type { ComponentFlowNode, PortView } from '../to-flow';
import { RegistryIcon } from './RegistryIcon';
import { useTraceStore } from '../trace/context';
import { currentTraceStep } from '../trace/trace-store';
import { useSecurityStore } from '../security/context';
import { EXPOSURE_STYLE } from '../security/security-store';
import { useLowDetail } from '../lod';

function portTop(i: number, n: number) {
  return `${((i + 1) / (n + 1)) * 100}%`;
}

const handleClass =
  '!h-2.5 !w-2.5 !border-2 !border-white !bg-sky-500 dark:!border-slate-900 hover:!bg-sky-400';

function PortHandles({ ports, hidden = false }: { ports: readonly PortView[]; hidden?: boolean }) {
  // S21: in low detail the handles stay in the layout (React Flow keeps their measured anchors)
  // but are not painted.
  const cls = hidden ? `${handleClass} !invisible` : handleClass;
  const inputs = ports.filter((p) => p.direction !== 'out');
  const outputs = ports.filter((p) => p.direction !== 'in');
  return (
    <>
      {inputs.map((p, i) => (
        <Handle
          key={`in-${p.id}`}
          id={p.id}
          type="target"
          position={Position.Left}
          style={{ top: portTop(i, inputs.length) }}
          className={cls}
          title={`${p.id} (in): ${p.protocols.join(', ')}`}
        />
      ))}
      {outputs.map((p, i) => (
        <Handle
          key={`out-${p.id}`}
          id={p.id}
          type="source"
          position={Position.Right}
          style={{ top: portTop(i, outputs.length) }}
          className={cls}
          title={`${p.id} (out): ${p.protocols.join(', ')}`}
        />
      ))}
    </>
  );
}

/** What the overlay shows: steady-state metrics, or one tick of the failure timeline (S11). */
interface OverlayView {
  utilization: number;
  rpsIn: number;
  p99Ms: number;
  explain: Record<string, string>;
  tick?: { tSec: number; state: NodeTick['state']; errorRate: number } | undefined;
}

function steadyView(m: NodeMetrics): OverlayView {
  return { utilization: m.utilization, rpsIn: m.rpsIn, p99Ms: m.latencyMs.p99, explain: m.explain };
}

function tickView(t: NodeTick, tSec: number): OverlayView {
  return {
    utilization: t.utilization,
    rpsIn: t.rpsIn,
    p99Ms: t.p99Ms,
    explain: {},
    tick: { tSec, state: t.state, errorRate: t.errorRate },
  };
}

/** Performance strip under a node: utilisation pill (colour + %), throughput and p99 (S08). */
function MetricsOverlay({ v }: { v: OverlayView }) {
  const level = utilizationLevel(v.utilization);
  const levelLabel = UTILIZATION_LEVEL_LABEL[level];
  const at = v.tick ? ` at ${v.tick.tSec} s` : '';
  const down = v.tick?.state === 'down';
  return (
    <div
      data-testid="node-overlay"
      data-level={level}
      data-state={v.tick?.state}
      className="pointer-events-auto absolute top-full left-0 mt-1 flex w-full items-center gap-1 text-[10px] leading-none font-medium tabular-nums"
    >
      {down ? (
        <span
          className="flex items-center gap-0.5 rounded bg-red-600 px-1 py-0.5 text-white dark:bg-red-500"
          title={`Down${at}: every call to it fails`}
        >
          <CircleX aria-hidden className="h-2.5 w-2.5" />
          Down
        </span>
      ) : (
        <span
          className={`flex items-center gap-0.5 rounded px-1 py-0.5 ${LEVEL_STYLES[level].pill}`}
          title={`Utilisation ${formatPercent(v.utilization)} (${levelLabel})${at}\n${v.explain.utilization ?? ''}`}
          aria-label={`Utilisation ${formatPercent(v.utilization)}, ${levelLabel}`}
        >
          {level === 'hot' && <TriangleAlert aria-hidden className="h-2.5 w-2.5" />}
          {formatPercent(v.utilization)}
        </span>
      )}
      {v.tick && !down && v.tick.errorRate >= 0.01 && (
        <span
          className="rounded bg-red-100 px-1 py-0.5 text-red-800 dark:bg-red-950 dark:text-red-200"
          title={`${formatPercent(v.tick.errorRate)} of calls fail${at}`}
        >
          {formatPercent(v.tick.errorRate)} err
        </span>
      )}
      <span
        className="rounded bg-white/90 px-1 py-0.5 text-slate-700 dark:bg-slate-900/90 dark:text-slate-300"
        title={v.explain.rpsIn ?? `Requests per second arriving at this component${at}`}
      >
        {formatRps(v.rpsIn)}
      </span>
      {!down && (
        <span
          data-testid="node-p99"
          className="ml-auto rounded bg-slate-800 px-1 py-0.5 text-white dark:bg-slate-200 dark:text-slate-900"
          title={`p99 latency at this component${at}\n${v.explain.latencyMs ?? ''}`}
        >
          p99 {formatMs(v.p99Ms)}
        </span>
      )}
    </div>
  );
}

/** A placed component: icon, label, product name, replica count badge and (S08) performance overlay. */
export const ComponentNode = memo(function ComponentNode({
  id,
  data,
  selected,
}: NodeProps<ComponentFlowNode>) {
  const metrics = useSimulationStore((s) => s.result?.perNode[id]);
  // S11: while scrubbing the failure timeline, show that tick instead of the steady state.
  const tSec = useSimulationStore((s) => playbackPoint(s.result, s.playback)?.tSec);
  const tick = useSimulationStore((s) => playbackPoint(s.result, s.playback)?.nodes?.[id]);
  const view =
    tick && tSec !== undefined ? tickView(tick, tSec) : metrics ? steadyView(metrics) : undefined;
  const level = view ? utilizationLevel(view.utilization) : undefined;
  const down = tick?.state === 'down';
  // S16: security overlay — border and badge by exposure (replaces the utilisation colour).
  const sec = useSecurityStore((s) => (s.open ? s.view?.nodes[id] : undefined));
  const border = !data.known
    ? 'border-dashed border-red-400'
    : sec
      ? `border-2 ${EXPOSURE_STYLE[sec.exposure].border}`
      : down
        ? 'border-2 border-dashed border-red-600 opacity-70 dark:border-red-500'
        : level
          ? `border-2 ${LEVEL_STYLES[level].border}`
          : 'border-slate-300 dark:border-slate-700';
  const replicas = tick && tick.state !== 'down' ? tick.replicas : data.replicas;
  // S15: the traced request is at this node (queue/service) or arriving at it.
  const traceHere = useTraceStore((s) => {
    const st = s.open ? currentTraceStep(s) : undefined;
    if (!st) return undefined;
    if (st.from === id && st.to === id) return st.kind;
    return st.to === id ? 'arriving' : undefined;
  });
  // S21: zoomed out on a large board — border colour + label only (see lod.ts).
  const lowDetail = useLowDetail() && !selected && !traceHere && !sec;
  if (lowDetail) {
    return (
      <div
        data-testid="component-node"
        data-lod="low"
        data-level={level}
        data-state={tick?.state}
        className={`relative flex h-full w-full items-center rounded-lg border bg-white px-3 dark:bg-slate-900 ${border}`}
      >
        <PortHandles ports={data.ports} hidden />
        <div className="truncate text-lg font-semibold text-slate-900 dark:text-slate-100">
          {data.label}
        </div>
      </div>
    );
  }
  return (
    <div
      data-testid="component-node"
      data-level={level}
      data-state={tick?.state}
      data-trace={traceHere}
      data-exposure={sec?.exposure}
      className={`relative flex h-full w-full items-center gap-2.5 rounded-lg border bg-white px-3 shadow-sm dark:bg-slate-900 ${border} ${
        selected
          ? 'ring-2 ring-sky-500/60 ring-offset-1 dark:ring-offset-slate-950'
          : traceHere === 'queue' || traceHere === 'service'
            ? 'ring-4 ring-sky-500/70 ring-offset-1 dark:ring-offset-slate-950'
            : ''
      }`}
    >
      <PortHandles ports={data.ports} />
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
        <RegistryIcon name={data.icon} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
          {data.label}
        </div>
        <div className="truncate text-xs text-slate-500 dark:text-slate-400" title={data.name}>
          {data.name}
        </div>
      </div>
      <span
        className="absolute -top-2 -right-2 rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] leading-none font-semibold text-white tabular-nums dark:bg-slate-200 dark:text-slate-900"
        title={`${replicas} replica${replicas === 1 ? '' : 's'}${replicas !== data.replicas ? ` (autoscaled; ${data.replicas} configured)` : ''}`}
        aria-label={`${replicas} replicas`}
      >
        ×{replicas}
      </span>
      {data.unavailableOn && (
        <span
          data-testid="no-equivalent"
          className="absolute -top-2 -left-2 flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] leading-none font-semibold text-amber-900 dark:bg-amber-900 dark:text-amber-100"
          title={`${data.name} is not available on ${data.unavailableOn}; it keeps its own model and prices.`}
        >
          <TriangleAlert size={10} aria-hidden />
          No {data.unavailableOn} equivalent
        </span>
      )}
      {sec && (
        <span
          data-testid="exposure-badge"
          className={`absolute -bottom-2 left-2 rounded px-1 py-0.5 text-[10px] leading-none font-semibold ${EXPOSURE_STYLE[sec.exposure].pill}`}
          title={sec.reason}
        >
          {sec.label}
        </span>
      )}
      {view && !sec && <MetricsOverlay v={view} />}
    </div>
  );
});
