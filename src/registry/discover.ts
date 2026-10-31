/**
 * Turns `import.meta.glob` results into entries. A file may export its entry as default or named;
 * every export created by a define* helper is collected, anything else is ignored.
 */
import { registryKindOf, type AnyRegistryEntry, type RegistryKind } from './define';

export interface SourceGroup {
  /** Kind every entry in these files must be. */
  kind: RegistryKind;
  /** `import.meta.glob(..., { eager: true })` result: file path → module namespace. */
  modules: Record<string, unknown>;
}

export interface DiscoveredEntry {
  kind: RegistryKind;
  entry: AnyRegistryEntry;
  /** File the entry came from, e.g. './components/cache/cache.ts'. */
  source: string;
}

export class RegistryLoadError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`Registry failed to load:\n  - ${errors.join('\n  - ')}`);
    this.name = 'RegistryLoadError';
    this.errors = errors;
  }
}

export function discoverEntries(groups: readonly SourceGroup[]): DiscoveredEntry[] {
  const out: DiscoveredEntry[] = [];
  const errors: string[] = [];
  for (const { kind, modules } of groups) {
    for (const path of Object.keys(modules).sort()) {
      const mod = modules[path];
      const seen = new Set<object>();
      if (typeof mod === 'object' && mod !== null) {
        for (const value of Object.values(mod)) {
          const valueKind = registryKindOf(value);
          if (!valueKind || seen.has(value as object)) continue;
          seen.add(value as object);
          if (valueKind !== kind) {
            errors.push(`${path}: exports a ${valueKind} but this folder holds ${kind} entries`);
            continue;
          }
          out.push({ kind, entry: value as AnyRegistryEntry, source: path });
        }
      }
      if (seen.size === 0) {
        errors.push(
          `${path}: exports no define${kind[0]!.toUpperCase()}${kind.slice(1)}(...) entry`,
        );
      }
    }
  }
  if (errors.length > 0) throw new RegistryLoadError(errors);
  return out;
}
