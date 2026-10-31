/**
 * core — public API.
 * Other modules may import ONLY from this file (enforced by eslint-plugin-boundaries).
 * See ./README.md.
 */
export * from './schemas';
export * from './ids';
export * from './units';
export * from './validation';
export {
  MIGRATIONS,
  CURRENT_SCHEMA_VERSION,
  MigrationError,
  assertMigrationChain,
  getSchemaVersion,
  migrate,
  type Migration,
  type MigrateResult,
  type RawDoc,
} from './migrations';
export { loadWorkspace, type LoadResult } from './load';
export {
  sampleBoard,
  sampleWorkspace,
  sampleWorkspaceV0,
  SAMPLE_IDS,
} from './fixtures/sample-workspace';
