import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';
import { memo } from 'react';
import { formatMs, formatRps, useBoardStoreApi, useSimulationStore } from '@/store';
import { edgeStrokeWidth, maxEdgeRps } from '../overlay';
import type { FlowEdge } from '../to-flow';

/**
 * A connection labelled with its top protocol. With a simulation result (S08) its thickness
 * follows the rps it carries and the label adds its latency.
 */
export const ProtocolEdge = memo(function ProtocolEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  selected,
  markerEnd,
  style,
}: EdgeProps<FlowEdge>) {
  const board = useBoardStoreApi();
  const metrics = useSimulationStore((s) => s.result?.perEdge[id]);
  const maxRps = useSimulationStore((s) => maxEdgeRps(s.result?.perEdge));
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const width = metrics ? edgeStrokeWidth(metrics.rps, maxRps) : 1.5;
  const text = typeof label === 'string' ? label : '';
  const title = metrics
    ? [
        `${text} — ${formatRps(metrics.rps)}, latency p50 ${formatMs(metrics.latencyMs.p50)}`,
        metrics.explain.rps,
        metrics.explain.latencyMs,
      ]
        .filter(Boolean)
        .join('\n')
    : text;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        {...(markerEnd !== undefined ? { markerEnd } : {})}
        style={{
          ...style,
          strokeWidth: width,
          ...(selected ? { stroke: '#0ea5e9' } : {}),
        }}
      />
      {(text || metrics) && (
        <EdgeLabelRenderer>
          <div
            data-testid="edge-label"
            data-rps={metrics?.rps}
            data-stroke-width={width}
            title={title}
            onClick={() => board.getState().setSelection([id])}
            className="nodrag nopan pointer-events-auto absolute rounded border border-slate-200 bg-white/95 px-1 py-0.5 text-[10px] leading-none text-slate-700 tabular-nums shadow-sm dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-300"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {text}
            {metrics && (
              <span className="ml-1 text-slate-500 dark:text-slate-400">
                · {formatMs(metrics.latencyMs.p50)}
              </span>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
