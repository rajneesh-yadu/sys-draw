/** Migrate + validate in one call: the entry point persistence uses for anything read from disk. */
import { migrate, MigrationError } from './migrations';
import { WorkspaceSchema, type Workspace } from './schemas';
import { safeParseReadable, type ParseResult } from './validation';

export type LoadResult<T> = ParseResult<T> & { fromVersion?: number; applied?: string[] };

export function loadWorkspace(raw: unknown): LoadResult<Workspace> {
  try {
    const { doc, fromVersion, applied } = migrate(raw);
    return { ...safeParseReadable(WorkspaceSchema, doc), fromVersion, applied };
  } catch (err) {
    if (err instanceof MigrationError) return { ok: false, errors: [`(root): ${err.message}`] };
    throw err;
  }
}
