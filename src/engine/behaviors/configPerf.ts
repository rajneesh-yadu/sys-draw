/**
 * configPerf: applies the `perfEffect` data declared on the component's config fields
 * (lib/perf-effects.ts) — e.g. Kafka `acks: all` waits for followers, RabbitMQ quorum queues
 * replicate through Raft, Redis `appendfsync always` fsyncs every write, mesh mTLS costs CPU.
 *   work  S' = S × Π factor          (capacity / ρ)
 *   wait  R' = R × Π factor + Σ addMs (what the caller waits for, besides queueing; the added
 *                                       round trips are not scaled by other factors)
 */
import { fmt } from '../model/format';
import type { CompiledNode } from '../model/types';
import { responseOf } from './lib/config';
import { activeEffects, type AppliedEffect } from './lib/perf-effects';
import { defineBehavior } from './types';

export function applyEffects(node: CompiledNode, effects: readonly AppliedEffect[]) {
  const f = { read: 1, write: 1 };
  const add = { read: 0, write: 0 };
  for (const e of effects) {
    f.read *= e.read ?? 1;
    f.write *= e.write ?? 1;
    add.read += e.readAddMs ?? 0;
    add.write += e.writeAddMs ?? 0;
  }
  const s = node.serviceTimeMs;
  const r = responseOf(node);
  return {
    serviceTimeMs: { read: s.read * f.read, write: s.write * f.write },
    responseServiceMs: { read: r.read * f.read + add.read, write: r.write * f.write + add.write },
  };
}

function describe(e: AppliedEffect): string {
  const parts: string[] = [];
  if (e.read !== undefined) parts.push(`reads × ${fmt(e.read)}`);
  if (e.write !== undefined) parts.push(`writes × ${fmt(e.write)}`);
  if (e.readAddMs !== undefined) parts.push(`reads wait +${fmt(e.readAddMs)} ms`);
  if (e.writeAddMs !== undefined) parts.push(`writes wait +${fmt(e.writeAddMs)} ms`);
  return `${e.field} = ${e.value}: ${parts.join(', ')} — ${e.why}`;
}

export const behavior = defineBehavior({
  id: 'configPerf',
  tune(node) {
    const effects = activeEffects(node.def, node.config);
    return effects.length > 0 ? applyEffects(node, effects) : undefined;
  },
  finish({ node, stats }) {
    const effects = activeEffects(node.def, node.config);
    if (effects.length === 0) return;
    const r = responseOf(node);
    stats.explain.configEffects =
      `${effects.map(describe).join('; ')}. ⇒ work S = ${fmt(node.serviceTimeMs.read)} ms read / ${fmt(node.serviceTimeMs.write)} ms write; ` +
      `wait ${fmt(r.read)} / ${fmt(r.write)} ms before queueing.`;
  },
});
