/** The registry object: lookup by id and filtered listing over discovered entries. */
import type { ComponentDefinition, ProviderId } from '@/core';
import { isAvailableOn } from './provider-tools';
import {
  REGISTRY_KINDS,
  type AnyRegistryEntry,
  type EntryByKind,
  type RegistryKind,
} from './define';
import { RegistryLoadError, type DiscoveredEntry } from './discover';

export interface ListFilter<K extends RegistryKind = RegistryKind> {
  kind?: K;
  /** Component category (e.g. 'database') or rule category (e.g. 'security'). Other kinds never match. */
  category?: string;
  /** Entries whose `tags` include this tag. Kinds without tags (protocols, providers) never match. */
  tag?: string;
  /**
   * Components usable on a board with this provider (see `isAvailableOn`) and the provider entry
   * itself. Other kinds are provider-agnostic and always pass.
   */
  provider?: ProviderId;
}

export interface Registry {
  /** Entry with this id, of any kind (ids are unique across kinds). */
  get(id: string): AnyRegistryEntry | undefined;
  get<K extends RegistryKind>(id: string, kind: K): EntryByKind[K] | undefined;
  /** Like `get` but throws a readable error when missing. */
  require<K extends RegistryKind>(id: string, kind: K): EntryByKind[K];
  has(id: string): boolean;
  kindOf(id: string): RegistryKind | undefined;
  /** Source file of an entry, for error messages and dev tools. */
  sourceOf(id: string): string | undefined;
  /** Entries sorted by kind then id (deterministic). */
  list<K extends RegistryKind>(filter: ListFilter<K> & { kind: K }): EntryByKind[K][];
  list(filter?: ListFilter): AnyRegistryEntry[];
  readonly size: number;
}

function matches(kind: RegistryKind, entry: AnyRegistryEntry, f: ListFilter): boolean {
  if (f.kind !== undefined && f.kind !== kind) return false;
  if (f.category !== undefined) {
    if (!('category' in entry) || entry.category !== f.category) return false;
  }
  if (f.tag !== undefined) {
    if (!('tags' in entry) || !entry.tags.includes(f.tag)) return false;
  }
  if (f.provider !== undefined) {
    if (kind === 'component' && !isAvailableOn(entry as ComponentDefinition, f.provider))
      return false;
    if (kind === 'provider' && entry.id !== f.provider) return false;
  }
  return true;
}

export function createRegistry(discovered: readonly DiscoveredEntry[]): Registry {
  const byId = new Map<string, DiscoveredEntry>();
  const errors: string[] = [];
  for (const d of discovered) {
    const prev = byId.get(d.entry.id);
    if (prev) {
      errors.push(
        `Duplicate id "${d.entry.id}" in ${prev.source} (${prev.kind}) and ${d.source} (${d.kind})`,
      );
      continue;
    }
    byId.set(d.entry.id, d);
  }
  if (errors.length > 0) throw new RegistryLoadError(errors);

  const kindRank = (k: RegistryKind) => REGISTRY_KINDS.indexOf(k);
  const sorted = [...byId.values()].sort(
    (a, b) => kindRank(a.kind) - kindRank(b.kind) || (a.entry.id < b.entry.id ? -1 : 1),
  );

  function get(id: string, kind?: RegistryKind): AnyRegistryEntry | undefined {
    const d = byId.get(id);
    if (!d || (kind !== undefined && d.kind !== kind)) return undefined;
    return d.entry;
  }

  const registry = {
    get,
    require(id: string, kind: RegistryKind) {
      const entry = get(id, kind);
      if (!entry) {
        const other = byId.get(id);
        throw new Error(
          other
            ? `Registry id "${id}" is a ${other.kind}, not a ${kind}`
            : `Unknown ${kind} "${id}" — is its file in src/registry and created with define${kind[0]!.toUpperCase()}${kind.slice(1)}?`,
        );
      }
      return entry;
    },
    has: (id: string) => byId.has(id),
    kindOf: (id: string) => byId.get(id)?.kind,
    sourceOf: (id: string) => byId.get(id)?.source,
    list: (filter: ListFilter = {}) =>
      sorted.filter((d) => matches(d.kind, d.entry, filter)).map((d) => d.entry),
    size: byId.size,
  };
  return registry as Registry;
}

/**
 * References that do not resolve to an entry: protocol `runsOn` ids and component port protocols.
 * Returned, not thrown — ports may name protocols a later session adds (e.g. 'udp', 'postgres-wire').
 */
export function findUnresolvedReferences(
  registry: Registry,
): { from: string; field: string; ref: string }[] {
  const out: { from: string; field: string; ref: string }[] = [];
  const isProtocol = (id: string) => registry.kindOf(id) === 'protocol';
  for (const p of registry.list({ kind: 'protocol' })) {
    for (const ref of p.runsOn)
      if (!isProtocol(ref)) out.push({ from: p.id, field: 'runsOn', ref });
  }
  for (const c of registry.list({ kind: 'component' })) {
    c.ports.forEach((port, i) => {
      for (const ref of port.protocols) {
        if (!isProtocol(ref)) out.push({ from: c.id, field: `ports[${i}].protocols`, ref });
      }
    });
  }
  return out;
}
