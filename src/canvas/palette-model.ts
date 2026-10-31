/** Palette contents from the registry: provider-filtered components grouped by category. */
import type { EntryByKind, Registry } from '@/registry';
import type { ProviderId } from '@/store';

export type ComponentDef = EntryByKind['component'];

export interface PaletteSection {
  category: string;
  items: { def: ComponentDef; name: string }[];
}

/** Section order for known categories; unknown ones follow alphabetically. */
const CATEGORY_ORDER = [
  'clients',
  'network',
  'compute',
  'cache',
  'database',
  'storage',
  'messaging',
  'security',
  'observability',
];

export function paletteSections(
  registry: Registry,
  provider: ProviderId,
  query: string,
): PaletteSection[] {
  const q = query.trim().toLowerCase();
  const byCat = new Map<string, PaletteSection['items']>();
  for (const def of registry.list({ kind: 'component', provider })) {
    const name = def.providerNames?.[provider] ?? def.name;
    const hay = [name, def.name, def.id, def.category, ...def.tags].join(' ').toLowerCase();
    if (q && !q.split(/\s+/).every((w) => hay.includes(w))) continue;
    const list = byCat.get(def.category) ?? [];
    list.push({ def, name });
    byCat.set(def.category, list);
  }
  const rank = (c: string) => {
    const i = CATEGORY_ORDER.indexOf(c);
    return i === -1 ? CATEGORY_ORDER.length : i;
  };
  return [...byCat.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([category, items]) => ({
      category,
      items: items.sort((a, b) => a.name.localeCompare(b.name)),
    }));
}
