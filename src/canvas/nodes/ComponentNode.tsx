import { Handle, Position, type NodeProps } from '@xyflow/react';
import { TriangleAlert } from 'lucide-react';
import { memo } from 'react';
import {
  formatMs,
  formatPercent,
  formatRps,
  useSimulationStore,
  UTILIZATION_LEVEL_LABEL,
  type NodeMetrics,
} from '@/store';
import { LEVEL_STYLES, utilizationLevel } from '../overlay';
import type { ComponentFlowNode, PortView } from '../to-flow';
import { RegistryIcon } from './RegistryIcon';

function portTop(i: number, n: number) {
  return `${((i + 1) / (n + 1)) * 100}%`;
}

const handleClass =
  '!h-2.5 !w-2.5 !border-2 !border-white !bg-sky-500 dark:!border-slate-900 hover:!bg-sky-400';

function PortHandles({ ports }: { ports: readonly PortView[] }) {
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
          className={handleClass}
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
          className={handleClass}
          title={`${p.id} (out): ${p.protocols.join(', ')}`}
        />
      ))}
    </>
  );
}

/** Performance strip under a node: utilisation pill (colour + %), throughput and p99 (S08). */
function MetricsOverlay({ m }: { m: NodeMetrics }) {
  const level = utilizationLevel(m.utilization);
  const levelLabel = UTILIZATION_LEVEL_LABEL[level];
  return (
    <div
      data-testid="node-overlay"
      data-level={level}
      className="pointer-events-auto absolute top-full left-0 mt-1 flex w-full items-center gap-1 text-[10px] leading-none font-medium tabular-nums"
    >
      <span
        className={`flex items-center gap-0.5 rounded px-1 py-0.5 ${LEVEL_STYLES[level].pill}`}
        title={`Utilisation ${formatPercent(m.utilization)} (${levelLabel})\n${m.explain.utilization ?? ''}`}
        aria-label={`Utilisation ${formatPercent(m.utilization)}, ${levelLabel}`}
      >
        {level === 'hot' && <TriangleAlert aria-hidden className="h-2.5 w-2.5" />}
        {formatPercent(m.utilization)}
      </span>
      <span
        className="rounded bg-white/90 px-1 py-0.5 text-slate-700 dark:bg-slate-900/90 dark:text-slate-300"
        title={m.explain.rpsIn ?? 'Requests per second arriving at this component'}
      >
        {formatRps(m.rpsIn)}
      </span>
      <span
        data-testid="node-p99"
        className="ml-auto rounded bg-slate-800 px-1 py-0.5 text-white dark:bg-slate-200 dark:text-slate-900"
        title={`p99 latency at this component\n${m.explain.latencyMs ?? ''}`}
      >
        p99 {formatMs(m.latencyMs.p99)}
      </span>
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
  const level = metrics ? utilizationLevel(metrics.utilization) : undefined;
  const border = !data.known
    ? 'border-dashed border-red-400'
    : level
      ? `border-2 ${LEVEL_STYLES[level].border}`
      : 'border-slate-300 dark:border-slate-700';
  return (
    <div
      data-testid="component-node"
      data-level={level}
      className={`relative flex h-full w-full items-center gap-2.5 rounded-lg border bg-white px-3 shadow-sm dark:bg-slate-900 ${border} ${
        selected ? 'ring-2 ring-sky-500/60 ring-offset-1 dark:ring-offset-slate-950' : ''
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
        title={`${data.replicas} replica${data.replicas === 1 ? '' : 's'}`}
        aria-label={`${data.replicas} replicas`}
      >
        ×{data.replicas}
      </span>
      {metrics && <MetricsOverlay m={metrics} />}
    </div>
  );
});
