/**
 * The mode registry: every `controllers/*.ts` default export is auto-discovered, like registry
 * entries. Adding a mode = adding one controller file (its id must be a core `ModeId`).
 */
import { isModeController } from './define';
import type { AnyModeController, ModeId } from './types';

export class ModeRegistryError extends Error {}

export interface ModeRegistry {
  list(): AnyModeController[];
  get(id: string): AnyModeController | undefined;
  require(id: string): AnyModeController;
}

export function createModeRegistry(modules: Record<string, unknown>): ModeRegistry {
  const byId = new Map<string, AnyModeController>();
  for (const [file, mod] of Object.entries(modules)) {
    const entry = (mod as { default?: unknown }).default;
    if (!isModeController(entry))
      throw new ModeRegistryError(`${file}: default export is not a defineMode(...) controller`);
    if (byId.has(entry.id)) throw new ModeRegistryError(`${file}: duplicate mode id "${entry.id}"`);
    byId.set(entry.id, entry);
  }
  const sorted = [...byId.values()].sort((a, b) => a.order - b.order);
  return {
    list: () => sorted,
    get: (id) => byId.get(id),
    require(id) {
      const m = byId.get(id);
      if (!m) throw new ModeRegistryError(`Unknown mode "${id}"`);
      return m;
    },
  };
}

/** The app's modes, discovered from controllers/ (test files excluded). */
export const modes: ModeRegistry = createModeRegistry(
  import.meta.glob(['./controllers/*.ts', '!./controllers/*.test.ts'], { eager: true }),
);

export const modeLabel = (id: ModeId | string): string => modes.get(id)?.label ?? id;
