/**
 * Behavior catalog. Every `./<id>.ts` file exporting `behavior` (via `defineBehavior`) is picked up
 * automatically — adding a behavior never touches the engine loop.
 */
import type { Behavior } from './types';

const modules = import.meta.glob<{ behavior?: Behavior }>(
  ['./*.ts', '!./*.test.ts', '!./index.ts', '!./types.ts'],
  { eager: true },
);

function load(): ReadonlyMap<string, Behavior> {
  const map = new Map<string, Behavior>();
  for (const [file, mod] of Object.entries(modules).sort(([a], [b]) => a.localeCompare(b))) {
    const b = mod.behavior;
    if (!b) throw new Error(`Behavior file ${file} must export \`behavior\` (defineBehavior).`);
    if (map.has(b.id)) throw new Error(`Duplicate behavior id "${b.id}" in ${file}`);
    map.set(b.id, b);
  }
  return map;
}

export const BEHAVIORS: ReadonlyMap<string, Behavior> = load();

export function behaviorsOf(ids: readonly string[]): Behavior[] {
  return ids.map((id) => BEHAVIORS.get(id)).filter((b): b is Behavior => b !== undefined);
}

export { defineBehavior } from './types';
export type { Behavior, Call, RouteOutContext, RouteRestContext, FinishContext } from './types';
