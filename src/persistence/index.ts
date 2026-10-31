/**
 * persistence — public API.
 * Other modules may import ONLY from this file (enforced by eslint-plugin-boundaries).
 * See ./README.md.
 */
export {
  createMemoryAdapter,
  type MemoryAdapter,
  type StorageAdapter,
  type StorageWrite,
  type StoredBoard,
  type StoredUi,
  type StoredWorkspace,
} from './adapter';
export { createDexieAdapter, DEFAULT_DB_NAME } from './dexie-adapter';
export {
  BoardLayoutSchema,
  SAVE_FORMAT,
  SAVE_KINDS,
  boardFile,
  parseSaveFile,
  projectFile,
  saveFileName,
  serializeSaveFile,
  toWorkspaceData,
  workspaceFile,
  type ParseOptions,
  type ParseSaveResult,
  type ParsedSaveFile,
  type SaveFile,
  type SaveKind,
} from './save-file';
export {
  DEFAULT_AUTOSAVE_DELAY_MS,
  importSaveFile,
  openWorkspace,
  startAutosave,
  type Autosave,
  type AutosaveOptions,
  type AutosaveStatus,
  type ImportResult,
  type OpenResult,
  type SaveState,
} from './session';
