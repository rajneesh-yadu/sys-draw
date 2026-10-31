/**
 * canvas — public API.
 * Other modules may import ONLY from this file (enforced by eslint-plugin-boundaries).
 * See ./README.md.
 */
export { CanvasProvider } from './CanvasProvider';
export { BoardCanvas } from './BoardCanvas';
export { Palette } from './Palette';
export { NODE_WIDTH, NODE_HEIGHT, GRID, computeGroupRects, findDropGroup } from './geometry';
export { computeAutoLayout } from './layout';
export { shortcutFor, SHORTCUT_HELP, type ShortcutAction } from './shortcuts';
