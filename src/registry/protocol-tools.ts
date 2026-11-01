/**
 * Protocol lookups (S14): default stack suggestions for a component pair, read from each
 * protocol entry's `suggestedStacks`. Matchers: a component id, 'category:<c>' or 'tag:<t>';
 * an empty list matches any component.
 */
import type { ComponentDefinition, ProtocolSuggestion } from '@/core';
import type { Registry } from './catalog';

export interface StackSuggestion extends ProtocolSuggestion {
  /** The protocol entry that carries the suggestion. */
  protocolId: string;
  /** Higher = more specific match (id 4 > tag 3 > category 2 > any 1, summed over both ends). */
  score: number;
}

type ComponentLike = Pick<ComponentDefinition, 'id' | 'category' | 'tags'>;

/** How specifically `matchers` select `def`: 0 = no match, 1 any, 2 category, 3 tag, 4 id. */
export function matchScore(matchers: readonly string[], def: ComponentLike): number {
  if (matchers.length === 0) return 1;
  let best = 0;
  for (const m of matchers) {
    if (m === def.id) best = Math.max(best, 4);
    else if (m.startsWith('tag:') && def.tags.includes(m.slice(4))) best = Math.max(best, 3);
    else if (m === `category:${def.category}`) best = Math.max(best, 2);
  }
  return best;
}

/** Every suggestion that matches `from → to`, most specific first (registry order breaks ties). */
export function suggestedStacks(
  registry: Pick<Registry, 'list'>,
  from: ComponentLike,
  to: ComponentLike,
): StackSuggestion[] {
  const out: StackSuggestion[] = [];
  for (const p of registry.list({ kind: 'protocol' })) {
    for (const s of p.suggestedStacks ?? []) {
      const a = matchScore(s.from, from);
      const b = matchScore(s.to, to);
      if (a > 0 && b > 0) out.push({ ...s, protocolId: p.id, score: a + b });
    }
  }
  return out
    .map((s, i) => ({ s, i }))
    .sort((x, y) => y.s.score - x.s.score || x.i - y.i)
    .map((x) => x.s);
}
