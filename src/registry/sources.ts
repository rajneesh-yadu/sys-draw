/**
 * Auto-discovery: every file matching these globs is loaded. Adding a file is enough (F2).
 * Globs must be string literals (Vite rewrites them at build time). Test files are excluded.
 */
import type { SourceGroup } from './discover';

export const REGISTRY_SOURCES: readonly SourceGroup[] = [
  {
    kind: 'component',
    modules: import.meta.glob(['./components/**/*.ts', '!./components/**/*.test.ts'], {
      eager: true,
    }),
  },
  {
    kind: 'protocol',
    modules: import.meta.glob(['./protocols/**/*.ts', '!./protocols/**/*.test.ts'], {
      eager: true,
    }),
  },
  {
    kind: 'provider',
    modules: import.meta.glob(['./providers/**/*.ts', '!./providers/**/*.test.ts'], {
      eager: true,
    }),
  },
  // One folder per problem; its index.ts exports the entry, sibling files hold graphs etc.
  { kind: 'problem', modules: import.meta.glob('./problems/*/index.ts', { eager: true }) },
  {
    kind: 'rule',
    modules: import.meta.glob(['./rules/**/*.ts', '!./rules/**/*.test.ts'], { eager: true }),
  },
  {
    kind: 'lesson',
    modules: import.meta.glob(['./lessons/**/*.ts', '!./lessons/**/*.test.ts'], { eager: true }),
  },
];
