/** Pure helpers for the trace panel's sequence diagram and timing bar (S15). */
import type { TraceView, TraceViewSegment, TraceViewStep } from './trace-store';

/** Packet travel time on the canvas, and the pause between steps while playing. */
export const PACKET_ANIMATION_MS = 900;
export const STEP_INTERVAL_MS = 1200;

export interface SequenceColumn {
  id: string;
  label: string;
  kind: 'node' | 'dns';
  /** Lifeline centre, % of the diagram width. */
  x: number;
}

export interface SequenceRow {
  step: TraceViewStep;
  /** Arrow start/end, % of width; equal for node-local steps (queue, service). */
  x1: number;
  x2: number;
  self: boolean;
}

export function sequenceLayout(trace: Pick<TraceView, 'participants' | 'steps'>): {
  columns: SequenceColumn[];
  rows: SequenceRow[];
} {
  const n = Math.max(1, trace.participants.length);
  const columns = trace.participants.map((p, i) => ({ ...p, x: ((i + 0.5) / n) * 100 }));
  const xOf = new Map(columns.map((c) => [c.id, c.x]));
  const rows = trace.steps.map((step) => {
    const x1 = xOf.get(step.from) ?? 0;
    const x2 = xOf.get(step.to) ?? x1;
    return { step, x1, x2, self: step.from === step.to };
  });
  return { columns, rows };
}

/** Non-zero segments with their share of the total (critical path only). */
export function breakdownShares(
  breakdown: readonly TraceViewSegment[],
): (TraceViewSegment & { share: number })[] {
  const total = breakdown.reduce((s, b) => s + b.ms, 0);
  return breakdown
    .filter((b) => b.ms > 0)
    .map((b) => ({ ...b, share: total > 0 ? b.ms / total : 0 }));
}

/** Elapsed critical-path time when step `i` ends (−1 ⇒ 0). */
export function elapsedAt(trace: Pick<TraceView, 'steps'>, i: number): number {
  const s = i >= 0 ? trace.steps[i] : undefined;
  return s ? s.startMs + s.timeMs : 0;
}

/** Edges the request travels on (critical path), for highlighting. */
export function tracedEdgeIds(trace: Pick<TraceView, 'steps'> | null): ReadonlySet<string> {
  return new Set(trace?.steps.filter((s) => s.edgeId && !s.async).map((s) => s.edgeId!) ?? []);
}

/** "OSI L4 · TCP" style tag. */
export function layerTag(step: Pick<TraceViewStep, 'layer' | 'osiLayer'>): string {
  return step.osiLayer ? `L${step.osiLayer} · ${step.layer}` : step.layer;
}
