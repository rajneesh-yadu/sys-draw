/**
 * Pipeline step 3 — route. Turns each flow into an expression tree (see expr.ts):
 * - explicit path: the steps in order; behaviors may transform the rest of the path
 *   (cache hit ends it, queue makes it async);
 * - empty path: walk the graph from client nodes (or, if there are none, from root nodes) along
 *   edges; behaviors decide how a node's downstream calls combine (LB picks one, cache-aside etc.).
 */
import type { Finding, Flow } from '@/core';
import { behaviorsOf, type Call } from '../behaviors';
import { hasBehavior, isDataStore } from './compile';
import { asyncExpr, choice, EMPTY, type Expr, seq, visit } from './expr';
import { engineFinding } from './findings';
import type { FlowLoad } from './load';
import type { CompiledNode, EngineOptions, Model, Op } from './types';

export interface RoutedFlow {
  flowId: string;
  name: string;
  rps: number;
  expr: Expr;
  /** True when the route was inferred from the graph (empty path). */
  inferred: boolean;
  explain: string;
}

export interface RoutePlan {
  flows: RoutedFlow[];
  issues: Finding[];
}

export function route(loads: readonly FlowLoad[], model: Model, options: EngineOptions): RoutePlan {
  const issues: Finding[] = [];
  const flows = loads.map(({ flow, rps, explain }) => {
    const inferred = flow.path.length === 0;
    const expr = inferred
      ? graphRoute(model, 'read', options, issues)
      : pathRoute(flow, model, options);
    return { flowId: flow.id, name: flow.name, rps, expr, inferred, explain };
  });
  return { flows, issues };
}

function cacheAsideRate(node: CompiledNode, options: EngineOptions): number | undefined {
  for (const b of behaviorsOf(node.behaviors)) {
    const h = b.cacheAsideHitRate?.(node, options);
    if (h !== undefined) return h;
  }
  return undefined;
}

/**
 * Default combination of a node's calls: one after another (latencies add). Async edges run off
 * the critical path (except into a queue, whose enqueue is waited for). For reads, if one sync
 * call goes to a cache, calls to databases/storage happen only on a cache miss (cache-aside).
 */
export function combineCalls(calls: readonly Call[], op: Op, options: EngineOptions): Expr {
  let hit: number | undefined;
  if (op === 'read') {
    for (const c of calls) {
      if (!c.edge.sync) continue;
      hit = cacheAsideRate(c.target, options);
      if (hit !== undefined) break;
    }
  }
  const items: Expr[] = [];
  const guarded: Expr[] = [];
  for (const c of calls) {
    const expr = !c.edge.sync && !hasBehavior(c.target, 'queue') ? asyncExpr(c.expr) : c.expr;
    if (
      hit !== undefined &&
      c.edge.sync &&
      isDataStore(c.target) &&
      cacheAsideRate(c.target, options) === undefined
    ) {
      guarded.push(expr);
    } else {
      items.push(expr);
    }
  }
  if (hit !== undefined && guarded.length > 0) {
    items.push(
      choice([
        { p: hit, expr: EMPTY },
        { p: 1 - hit, expr: seq(guarded) },
      ]),
    );
  }
  return seq(items);
}

function graphRoute(model: Model, op: Op, options: EngineOptions, issues: Finding[]): Expr {
  const all = [...model.nodes.values()];
  let entries = all.filter((n) => n.kind === 'source');
  if (entries.length === 0) {
    entries = all.filter(
      (n) => (model.inbound.get(n.id)?.length ?? 0) === 0 && (model.out.get(n.id)?.length ?? 0) > 0,
    );
    if (entries.length > 0) {
      issues.push(
        engineFinding(
          'engine.route',
          'info',
          'No client nodes',
          'No client component found; traffic starts at nodes with no incoming connections.',
          entries.map((n) => n.id),
        ),
      );
    }
  }
  if (entries.length === 0) {
    if (all.length > 0) {
      issues.push(
        engineFinding(
          'engine.route',
          'warning',
          'No traffic entry point',
          'Add a client and connect it to your system to simulate traffic.',
          [],
        ),
      );
    }
    return EMPTY;
  }

  let visits = 0;
  let budgetHit = false;
  const cycleEdges = new Set<string>();
  const stack = new Set<string>();

  const walk = (node: CompiledNode, edgeId: string | undefined): Expr => {
    visits++;
    const calls: Call[] = [];
    if (visits <= options.maxVisits) {
      stack.add(node.id);
      for (const e of model.out.get(node.id) ?? []) {
        const target = model.nodes.get(e.target);
        if (!target) continue;
        if (stack.has(target.id)) {
          cycleEdges.add(e.id);
          continue;
        }
        calls.push({ edge: e, target, expr: walk(target, e.id) });
      }
      stack.delete(node.id);
    } else {
      budgetHit = true;
    }
    const combine = (cs: readonly Call[]) => combineCalls(cs, op, options);
    let then: Expr | undefined;
    for (const b of behaviorsOf(node.behaviors)) {
      then = b.routeOut?.({ node, op, calls, model, options, combine });
      if (then !== undefined) break;
    }
    return visit(node.id, op, then ?? combine(calls), edgeId);
  };

  const expr = choice(entries.map((n) => ({ p: 1 / entries.length, expr: walk(n, undefined) })));
  if (cycleEdges.size > 0) {
    issues.push(
      engineFinding(
        'engine.route',
        'warning',
        'Cycle in request path',
        'A request would loop back to a component it already passed through; those connections are ignored for traffic.',
        [...cycleEdges],
      ),
    );
  }
  if (budgetHit) {
    issues.push(
      engineFinding(
        'engine.route',
        'warning',
        'Graph too large to route fully',
        `The inferred flow visits more than ${options.maxVisits} component calls; deeper calls were cut. Define explicit flows.`,
        [],
      ),
    );
  }
  return expr;
}

function pathRoute(flow: Flow, model: Model, options: EngineOptions): Expr {
  const steps = flow.path.filter((s) => model.nodes.has(s.nodeId));
  let rest: Expr = EMPTY;
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (!step) continue;
    const node = model.nodes.get(step.nodeId) as CompiledNode;
    const prev = steps[i - 1];
    const edge = prev
      ? (model.out.get(prev.nodeId) ?? []).find((e) => e.target === step.nodeId)
      : undefined;
    let then: Expr | undefined;
    for (const b of behaviorsOf(node.behaviors)) {
      then = b.routeRest?.({ node, op: step.op, step, rest, options });
      if (then !== undefined) break;
    }
    rest = visit(node.id, step.op, then ?? rest, edge?.id);
    if (edge && !edge.sync && !hasBehavior(node, 'queue')) rest = asyncExpr(rest);
  }
  return rest;
}
