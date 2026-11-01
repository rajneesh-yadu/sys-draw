import { useId, useMemo, useState, type DragEvent } from 'react';
import { registry } from '@/registry';
import { GROUP_KINDS, groupKindLabel, useBoardStore } from '@/store';
import { useCanvasActions } from './actions';
import { DND_MIME, encodePaletteItem, type PaletteItem } from './dnd';
import { RegistryIcon } from './nodes/RegistryIcon';
import { paletteSections } from './palette-model';

function onDragStart(e: DragEvent, item: PaletteItem) {
  e.dataTransfer.setData(DND_MIME, encodePaletteItem(item));
  e.dataTransfer.effectAllowed = 'copy';
}

const itemClass =
  'flex w-full cursor-grab items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none active:cursor-grabbing dark:text-slate-200 dark:hover:bg-slate-800';

/**
 * Component palette from the registry (filtered by the board's provider). Drag an item onto the
 * canvas, or press Enter / click to add it at the centre of the view.
 */
export function Palette() {
  const provider = useBoardStore((s) => s.doc.providerId);
  const [query, setQuery] = useState('');
  const sections = useMemo(() => paletteSections(registry, provider, query), [provider, query]);
  const actions = useCanvasActions();
  const searchId = useId();

  return (
    <div className="flex flex-col gap-2 p-2" data-testid="palette">
      <label htmlFor={searchId} className="sr-only">
        Search components
      </label>
      <input
        id={searchId}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search components…"
        className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none dark:border-slate-700 dark:bg-slate-950"
      />

      {sections.length === 0 && (
        <p className="px-2 text-sm text-slate-500 dark:text-slate-400">
          No components match “{query}”.
        </p>
      )}

      {sections.map((sec) => (
        <section key={sec.category} aria-label={sec.category}>
          <h3 className="px-2 pt-1 pb-0.5 text-[11px] font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase">
            {sec.category}
          </h3>
          <ul>
            {sec.items.map(({ def, name, icon }) => (
              <li key={def.id}>
                <button
                  type="button"
                  draggable
                  onDragStart={(e) => onDragStart(e, { kind: 'component', defId: def.id })}
                  onClick={() => actions.addComponentAt(def.id, actions.viewportCenter())}
                  title={def.docs.summary}
                  className={itemClass}
                  data-def-id={def.id}
                >
                  <RegistryIcon name={icon} className="shrink-0 text-sky-600 dark:text-sky-400" />
                  <span className="truncate">{name}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {!query && (
        <section aria-label="containers">
          <h3 className="px-2 pt-1 pb-0.5 text-[11px] font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase">
            Containers
          </h3>
          <ul>
            {GROUP_KINDS.map((kind) => (
              <li key={kind}>
                <button
                  type="button"
                  draggable
                  onDragStart={(e) => onDragStart(e, { kind: 'group', groupKind: kind })}
                  onClick={() => actions.groupSelection(kind)}
                  title="Drag onto the canvas, or click to wrap the selection (adds an empty one when nothing is selected)"
                  className={itemClass}
                  data-group-kind={kind}
                >
                  <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded border-2 border-dashed border-slate-400" />
                  <span>{groupKindLabel(kind)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
