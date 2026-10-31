import { Handle, Position, type NodeProps } from '@xyflow/react';
import { memo } from 'react';
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

/** A placed component: icon, label, product name and replica count badge. */
export const ComponentNode = memo(function ComponentNode({
  data,
  selected,
}: NodeProps<ComponentFlowNode>) {
  return (
    <div
      data-testid="component-node"
      className={`relative flex h-full w-full items-center gap-2.5 rounded-lg border bg-white px-3 shadow-sm dark:bg-slate-900 ${
        selected
          ? 'border-sky-500 ring-2 ring-sky-500/40'
          : data.known
            ? 'border-slate-300 dark:border-slate-700'
            : 'border-dashed border-red-400'
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
    </div>
  );
});
