/**
 * S21: app-level keyboard shortcuts and the data for the shortcut sheet. The canvas owns its own
 * keys (`SHORTCUT_HELP` from canvas); the sheet lists both, so this table plus the canvas's are
 * the single source for "?".
 */
import { SHORTCUT_HELP, type ShortcutAction } from '@/canvas';

export type AppShortcut = 'commandPalette' | 'shortcuts' | 'toggleLeftPanels' | 'save';

export interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export const APP_SHORTCUT_KEYS: Record<AppShortcut, string> = {
  commandPalette: 'Ctrl/⌘+K',
  shortcuts: '?',
  toggleLeftPanels: 'Ctrl/⌘+B',
  save: 'Ctrl/⌘+S',
};

export const APP_SHORTCUT_LABEL: Record<AppShortcut, string> = {
  commandPalette: 'Command palette (search every action and component)',
  shortcuts: 'Keyboard shortcuts (this sheet)',
  toggleLeftPanels: 'Collapse / expand Projects and Palette',
  save: 'Save now',
};

/** Shortcuts that also fire while typing in a text field. */
const WORKS_IN_FIELDS: ReadonlySet<AppShortcut> = new Set(['commandPalette', 'save']);

export function appShortcutFor(e: KeyEventLike, inTextField = false): AppShortcut | null {
  if (e.altKey) return null;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  let hit: AppShortcut | null = null;
  if (mod && !e.shiftKey && k === 'k') hit = 'commandPalette';
  else if (mod && !e.shiftKey && k === 's') hit = 'save';
  else if (mod && !e.shiftKey && k === 'b') hit = 'toggleLeftPanels';
  else if (!mod && e.key === '?') hit = 'shortcuts';
  if (hit && inTextField && !WORKS_IN_FIELDS.has(hit)) return null;
  return hit;
}

export function isTextField(t: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}

export const CANVAS_ACTION_LABEL: Record<ShortcutAction, string> = {
  undo: 'Undo',
  redo: 'Redo',
  copy: 'Copy selection',
  cut: 'Cut selection',
  paste: 'Paste',
  delete: 'Delete selection',
  selectAll: 'Select everything',
  group: 'Group selection (as the toolbar kind)',
  ungroup: 'Ungroup',
  clearSelection: 'Clear selection / close menus',
};

export interface ShortcutRow {
  keys: string;
  label: string;
}
export interface ShortcutGroup {
  title: string;
  rows: ShortcutRow[];
}

/** Extra canvas gestures that are not key → action pairs. */
const CANVAS_GESTURES: ShortcutRow[] = [
  { keys: 'Shift+drag', label: 'Box-select' },
  { keys: 'Ctrl/⌘/Shift+click', label: 'Add to selection' },
  { keys: 'Scroll / pinch', label: 'Zoom' },
  { keys: 'Drag empty space', label: 'Pan' },
];

const PANEL_KEYS: ShortcutRow[] = [
  { keys: 'Enter / click', label: 'Palette: add the focused component at the centre of the view' },
  { keys: '↑ / ↓', label: 'Metrics top edge focused: resize (Page Up/Down for bigger steps)' },
  { keys: 'Home / End', label: 'Metrics top edge focused: smallest / maximised' },
  { keys: 'Esc', label: 'Close a dialog or the command palette' },
];

export function shortcutSheet(): ShortcutGroup[] {
  const general = (Object.keys(APP_SHORTCUT_KEYS) as AppShortcut[]).map((a) => ({
    keys: APP_SHORTCUT_KEYS[a],
    label: APP_SHORTCUT_LABEL[a],
  }));
  const canvas = (Object.keys(SHORTCUT_HELP) as ShortcutAction[]).map((a) => ({
    keys: SHORTCUT_HELP[a],
    label: CANVAS_ACTION_LABEL[a],
  }));
  return [
    { title: 'General', rows: general },
    { title: 'Canvas', rows: [...canvas, ...CANVAS_GESTURES] },
    { title: 'Panels', rows: PANEL_KEYS },
  ];
}
