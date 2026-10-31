/**
 * A routed flow is an expression tree: which nodes a request visits, in what order, with which
 * probability, and which parts are off the caller's critical path. Load, errors and latency are
 * all computed by folding over this tree.
 */
import type { Op } from './types';

export type Expr =
  /** Visit a node (reached over `edgeId`), then run `then` (its downstream calls). */
  | { k: 'visit'; nodeId: string; op: Op; edgeId?: string | undefined; then: Expr }
  /** Run each item one after another; latencies add. */
  | { k: 'seq'; items: readonly Expr[] }
  /** Exactly one option runs, with probability p (LB split, cache hit/miss). */
  | { k: 'choice'; options: readonly { p: number; expr: Expr }[] }
  /** Runs, but the caller does not wait for it (queues, fire-and-forget edges). */
  | { k: 'async'; expr: Expr }
  | { k: 'empty' };

export const EMPTY: Expr = Object.freeze({ k: 'empty' }) as Expr;

export function isEmpty(e: Expr): boolean {
  if (e.k === 'empty') return true;
  if (e.k === 'seq') return e.items.every(isEmpty);
  return false;
}

export function seq(items: readonly Expr[]): Expr {
  const kept = items.filter((e) => !isEmpty(e));
  if (kept.length === 0) return EMPTY;
  if (kept.length === 1) return kept[0] as Expr;
  return { k: 'seq', items: kept };
}

export function choice(options: readonly { p: number; expr: Expr }[]): Expr {
  const kept = options.filter((o) => o.p > 0);
  if (kept.length === 0) return EMPTY;
  if (kept.length === 1 && Math.abs((kept[0] as { p: number }).p - 1) < 1e-12) {
    return (kept[0] as { expr: Expr }).expr;
  }
  return { k: 'choice', options: kept };
}

export function asyncExpr(expr: Expr): Expr {
  return isEmpty(expr) ? EMPTY : { k: 'async', expr };
}

export function visit(nodeId: string, op: Op, then: Expr, edgeId?: string): Expr {
  return edgeId === undefined
    ? { k: 'visit', nodeId, op, then }
    : { k: 'visit', nodeId, op, edgeId, then };
}
