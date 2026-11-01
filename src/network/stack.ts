/**
 * Resolving an edge's protocol stack (bottom-up ids) against the registry.
 *
 * Stacks saved before S14 may name an application protocol alone (['postgres-wire']); a stack with
 * no transport (OSI layer ≤ 4) is assumed to run on TCP, which is marked `assumed` so the
 * inspector can say so.
 */
import type { ProtocolDefinition } from '@/core';
import type { Registry } from '@/registry';

/** Only `get` is needed for most functions, so a test registry or stub works too. */
export type ProtocolSource = Pick<Registry, 'get'>;

export interface StackLayer {
  def: ProtocolDefinition;
  /** True when the layer is not in the edge's stack but assumed (TCP under a bare app protocol). */
  assumed: boolean;
}

export interface ResolvedStack {
  /** The edge's ids, bottom-up, as stored. */
  ids: readonly string[];
  /** Registered layers bottom-up, including an assumed transport. */
  layers: readonly StackLayer[];
  /** Ids not in the protocol catalog. */
  unknown: readonly string[];
  /** Top-most layer with loss recovery (TCP, QUIC, UDP), if any. */
  transport?: ProtocolDefinition | undefined;
}

/** The transport assumed under a stack that names none. */
export const ASSUMED_TRANSPORT_ID = 'tcp';

export function resolveStack(registry: ProtocolSource, ids: readonly string[]): ResolvedStack {
  const layers: StackLayer[] = [];
  const unknown: string[] = [];
  for (const id of ids) {
    const def = registry.get(id, 'protocol');
    if (def) layers.push({ def, assumed: false });
    else unknown.push(id);
  }
  if (ids.length > 0 && !layers.some((l) => l.def.osiLayer <= 4)) {
    const tcp = registry.get(ASSUMED_TRANSPORT_ID, 'protocol');
    if (tcp) layers.unshift({ def: tcp, assumed: true });
  }
  const transport = [...layers].reverse().find((l) => l.def.loss !== undefined)?.def;
  return { ids, layers, unknown, transport };
}

/** Layers that take part in the math (not implicit or conceptual entries placed by hand). */
export function activeLayers(stack: ResolvedStack): StackLayer[] {
  return stack.layers.filter((l) => l.def.implicit !== true && l.def.conceptual !== true);
}

/** "TCP › TLS 1.3 › HTTP/2" (unknown ids shown as-is). */
export function stackLabel(registry: ProtocolSource, ids: readonly string[]): string {
  return ids.map((id) => registry.get(id, 'protocol')?.name ?? id).join(' › ');
}
