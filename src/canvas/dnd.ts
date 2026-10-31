/** Drag-and-drop payload from the palette to the canvas. */
import type { GroupKind } from '@/store';

export const DND_MIME = 'application/x-sysdraw-item';

export type PaletteItem =
  { kind: 'component'; defId: string } | { kind: 'group'; groupKind: GroupKind };

export function encodePaletteItem(item: PaletteItem): string {
  return JSON.stringify(item);
}

export function decodePaletteItem(raw: string): PaletteItem | null {
  try {
    const v = JSON.parse(raw) as Partial<PaletteItem> & Record<string, unknown>;
    if (v.kind === 'component' && typeof v.defId === 'string')
      return { kind: 'component', defId: v.defId };
    if (v.kind === 'group' && typeof v.groupKind === 'string') {
      return { kind: 'group', groupKind: v.groupKind as GroupKind };
    }
  } catch {
    /* not ours */
  }
  return null;
}
