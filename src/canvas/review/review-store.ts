/**
 * "Review" panel state (S19). The canvas only renders it: the app runs the engine's design review
 * (registry rules + simulation findings) and registers the handler that applies a finding's
 * one-click fix through the board store.
 *
 * The view types mirror the engine's `ReviewFinding` / `DesignReview` (canvas may not import the
 * engine); the app maps one onto the other, so TypeScript checks they stay in step.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { FixHandler, SecuritySeverity } from '../security/security-store';

export const REVIEW_CATEGORIES = [
  'reliability',
  'performance',
  'scalability',
  'security',
  'cost',
] as const;
export type ReviewCategory = (typeof REVIEW_CATEGORIES)[number];
export type ReviewFilter = ReviewCategory | 'all';

export const REVIEW_CATEGORY_LABEL: Record<ReviewCategory, string> = {
  reliability: 'Reliability',
  performance: 'Performance',
  scalability: 'Scalability',
  security: 'Security',
  cost: 'Cost',
};

export interface ReviewViewFinding {
  key: string;
  ruleId: string;
  ruleTitle: string;
  category: ReviewCategory;
  severity: SecuritySeverity;
  title: string;
  message: string;
  fix?: string | undefined;
  /** Present when the finding has a safe one-click fix. */
  fixLabel?: string | undefined;
  targetIds: readonly string[];
  source: 'rule' | 'engine';
}

export interface ReviewView {
  findings: readonly ReviewViewFinding[];
  /** Rules that ran on this board. */
  checked: number;
  /** Rules that did not apply, with their title and why. */
  skipped: readonly { ruleId: string; title: string; reason: string }[];
  /** A simulation result of this board fed the review. */
  hasResult: boolean;
}

export interface ReviewState {
  open: boolean;
  view: ReviewView | null;
  filter: ReviewFilter;
  lastFix: { ok: boolean; message: string } | null;
  fixHandler: FixHandler | null;
  setOpen(open: boolean): void;
  setView(view: ReviewView | null): void;
  setFilter(filter: ReviewFilter): void;
  setFixHandler(fn: FixHandler | null): void;
  /** Applies a finding's fix through the registered handler. */
  fix(key: string): void;
}

export type ReviewStore = StoreApi<ReviewState>;

export function createReviewStore(): ReviewStore {
  return createStore<ReviewState>()((set, get) => ({
    open: false,
    view: null,
    filter: 'all',
    lastFix: null,
    fixHandler: null,
    setOpen: (open) => set({ open, ...(open ? {} : { lastFix: null }) }),
    setView: (view) => set({ view }),
    setFilter: (filter) => set({ filter }),
    setFixHandler: (fixHandler) => set({ fixHandler }),
    fix: (key) => {
      const h = get().fixHandler;
      if (!h) return set({ lastFix: { ok: false, message: 'Fixes are not available here.' } });
      const r = h(key);
      set({
        lastFix: r.ok
          ? { ok: true, message: `Applied: ${r.label} (undo with Ctrl/⌘+Z)` }
          : { ok: false, message: r.reason },
      });
    },
  }));
}

/** Findings per category, for the filter chips. */
export function categoryCounts(
  findings: readonly ReviewViewFinding[],
): Record<ReviewCategory, number> {
  const out = Object.fromEntries(REVIEW_CATEGORIES.map((c) => [c, 0])) as Record<
    ReviewCategory,
    number
  >;
  for (const f of findings) out[f.category] += 1;
  return out;
}

/**
 * Where "jump to" goes: the ids to select (nodes, edges, groups) and the node to centre on (the
 * first node target, else the source of the first edge target).
 */
export function jumpTarget(
  targetIds: readonly string[],
  edges: readonly { id: string; source: string }[],
): { select: string[]; focusNodeId: string | undefined } {
  const select = targetIds.filter((id) => /^(node|edge|grp)_/.test(id));
  const node = select.find((id) => id.startsWith('node_'));
  const edgeId = select.find((id) => id.startsWith('edge_'));
  const focusNodeId = node ?? edges.find((e) => e.id === edgeId)?.source;
  return { select, focusNodeId };
}
