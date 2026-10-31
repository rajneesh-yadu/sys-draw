/** Canvas keyboard shortcuts as a pure key → action table (Ctrl on Windows/Linux, ⌘ on macOS). */
export type ShortcutAction =
  | 'undo'
  | 'redo'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'delete'
  | 'selectAll'
  | 'group'
  | 'ungroup'
  | 'clearSelection';

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export const SHORTCUT_HELP: Record<ShortcutAction, string> = {
  undo: 'Ctrl/⌘+Z',
  redo: 'Ctrl/⌘+Shift+Z or Ctrl+Y',
  copy: 'Ctrl/⌘+C',
  cut: 'Ctrl/⌘+X',
  paste: 'Ctrl/⌘+V',
  delete: 'Delete / Backspace',
  selectAll: 'Ctrl/⌘+A',
  group: 'Ctrl/⌘+G',
  ungroup: 'Ctrl/⌘+Shift+G',
  clearSelection: 'Esc',
};

export function shortcutFor(e: KeyLike): ShortcutAction | null {
  if (e.altKey) return null;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod) {
    if (k === 'z') return e.shiftKey ? 'redo' : 'undo';
    if (k === 'y' && !e.shiftKey) return 'redo';
    if (e.shiftKey) return k === 'g' ? 'ungroup' : null;
    if (k === 'c') return 'copy';
    if (k === 'x') return 'cut';
    if (k === 'v') return 'paste';
    if (k === 'a') return 'selectAll';
    if (k === 'g') return 'group';
    return null;
  }
  if (e.shiftKey) return null;
  if (e.key === 'Delete' || e.key === 'Backspace') return 'delete';
  if (e.key === 'Escape') return 'clearSelection';
  return null;
}

/** Don't steal keys from text fields. */
export function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}
