/** A raw saved document: whatever JSON.parse produced, before validation. */
export type RawDoc = Record<string, unknown>;

/**
 * One step from `from` to `from + 1`. `up` receives a deep copy, so it may mutate and return it.
 * Migrations work on raw JSON, never on the current TS types (those change over time).
 */
export interface Migration {
  from: number;
  to: number;
  description: string;
  up: (doc: RawDoc) => RawDoc;
}
