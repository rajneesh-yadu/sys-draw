import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';
import { memo, useEffect, useRef } from 'react';
import {
  formatMs,
  formatPercent,
  formatRps,
  playbackPoint,
  useBoardStoreApi,
  useSimulationStore,
} from '@/store';
import { edgeStrokeWidth, maxEdgeRps, tickEdgeStyle } from '../overlay';
import { traceColor } from '../trace/colors';
import { useTraceStore } from '../trace/context';
import { PACKET_ANIMATION_MS } from '../trace/sequence';
import { currentTraceStep, type TraceViewStep } from '../trace/trace-store';
import type { FlowEdge } from '../to-flow';
import { useSecurityStore } from '../security/context';
import { ENCRYPTION_STROKE } from '../security/security-store';

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
  // S11: while scrubbing the failure timeline, thickness and colour follow that tick.
  const tick = useSimulationStore((s) => playbackPoint(s.result, s.playback)?.edges?.[id]);
  const tickMax = useSimulationStore((s) => maxEdgeRps(playbackPoint(s.result, s.playback)?.edges));
  const tickStyle = tick ? tickEdgeStyle(tick) : undefined;
  // S15: the request trace's packet on this edge, and whether the traced request uses it.
  const packet = useTraceStore((s) => {
    const st = s.open ? currentTraceStep(s) : undefined;
    return st?.edgeId === id ? st : undefined;
  });
  const traced = useTraceStore(
    (s) => s.open && (s.trace?.steps.some((x) => x.edgeId === id && !x.async) ?? false),
  );
  // S16: security overlay — colour by encryption, dashed when plaintext, zone crossing badge.
  const sec = useSecurityStore((s) => (s.open ? s.view?.edges[id] : undefined));
  const secStroke = sec ? ENCRYPTION_STROKE[sec.encryption] : undefined;
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const width = tick
    ? edgeStrokeWidth(tick.rps, tickMax)
    : metrics
      ? edgeStrokeWidth(metrics.rps, maxRps)
      : 1.5;
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
  const tickTitle = tick
    ? `${formatRps(tick.rps)}, ${formatPercent(tick.errorRate)} of calls fail${tick.breaker ? `, circuit breaker ${tick.breaker}` : ''}`
    : '';
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        {...(markerEnd !== undefined ? { markerEnd } : {})}
        style={{
          ...style,
          strokeWidth: width,
          ...(tickStyle?.stroke ? { stroke: tickStyle.stroke } : {}),
          ...(tickStyle?.dashed ? { strokeDasharray: '6 4' } : {}),
          ...(secStroke
            ? { stroke: secStroke.stroke, ...(secStroke.dashed ? { strokeDasharray: '6 4' } : {}) }
            : {}),
          ...(traced ? { stroke: '#0ea5e9', strokeDasharray: '4 3' } : {}),
          ...(selected ? { stroke: '#0ea5e9' } : {}),
        }}
      />
      {packet && <TracePacket key={packet.index} edgeId={id} path={path} step={packet} />}
      {(text || metrics || sec) && (
        <EdgeLabelRenderer>
          <div
            data-testid="edge-label"
            data-rps={metrics?.rps}
            data-stroke-width={width}
            data-breaker={tick?.breaker}
            data-encryption={sec?.encryption}
            title={[title, tickTitle, sec?.crossing?.explain].filter(Boolean).join('\n')}
            onClick={() => board.getState().setSelection([id])}
            className="nodrag nopan pointer-events-auto absolute rounded border border-slate-200 bg-white/95 px-1 py-0.5 text-[10px] leading-none text-slate-700 tabular-nums shadow-sm dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-300"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {text}
            {metrics && !tickStyle?.badge && (
              <span className="ml-1 text-slate-500 dark:text-slate-400">
                · {formatMs(metrics.latencyMs.p50)}
              </span>
            )}
            {sec && (
              <span
                data-testid="edge-encryption"
                className={`ml-1 font-semibold ${sec.encryption === 'plaintext' ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}
              >
                · {sec.label}
              </span>
            )}
            {sec?.crossing?.verdict === 'deny' && (
              <span className="ml-1 font-semibold text-red-700 dark:text-red-300">· blocked</span>
            )}
            {tickStyle?.badge && (
              <span className="ml-1 font-semibold text-red-700 dark:text-red-300">
                · {tickStyle.badge}
              </span>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

/**
 * S15: one packet of the traced request travelling along the edge (forward = source → target).
 * SMIL `animateMotion` begins on mount (an animation added to a running SVG with begin="0s" would
 * already be over), so each step replays from the start.
 */
function TracePacket({
  edgeId,
  path,
  step,
}: {
  edgeId: string;
  path: string;
  step: TraceViewStep;
}) {
  const anim = useRef<SVGAnimateMotionElement>(null);
  useEffect(() => {
    anim.current?.beginElement?.();
  }, []);
  return (
    <g
      data-testid="trace-packet"
      data-edge-id={edgeId}
      data-direction={step.direction}
      data-step={step.index}
      data-category={step.category}
      pointerEvents="none"
    >
      <title>{`${step.layer}: ${step.message}`}</title>
      <circle r={7} fill={traceColor(step.category)} stroke="#ffffff" strokeWidth={2}>
        <animateMotion
          ref={anim}
          begin="indefinite"
          dur={`${PACKET_ANIMATION_MS}ms`}
          fill="freeze"
          path={path}
          keyPoints={step.direction === 'back' ? '1;0' : '0;1'}
          keyTimes="0;1"
          calcMode="linear"
        />
      </circle>
    </g>
  );
}
