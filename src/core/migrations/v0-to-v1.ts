import type { Migration, RawDoc } from './types';

/**
 * v0 = the pre-versioned draft format: no `schemaVersion` and no `settings`
 * (settings may also be a partial object). v1 = the first schema in DATA-MODEL.md.
 * Defaults are inlined (not imported) so this migration never changes when v2+ settings do.
 */
const V1_DEFAULT_SETTINGS = {
  theme: 'system',
  defaultProviderId: 'generic',
  autosave: true,
  showFormulas: true,
} as const;

export const v0ToV1: Migration = {
  from: 0,
  to: 1,
  description: 'Add schemaVersion and default user settings',
  up(doc: RawDoc): RawDoc {
    const settings =
      typeof doc.settings === 'object' && doc.settings !== null && !Array.isArray(doc.settings)
        ? (doc.settings as RawDoc)
        : {};
    return {
      ...doc,
      projects: Array.isArray(doc.projects) ? doc.projects : [],
      settings: { ...V1_DEFAULT_SETTINGS, ...settings },
      schemaVersion: 1,
    };
  },
};
