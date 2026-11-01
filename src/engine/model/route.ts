/**
 * Pipeline step 3 — route. Turns each flow into an expression tree (see expr.ts):
 * - explicit path: the steps in order; behaviors may transform the rest of the path
 *   (cache hit ends it, queue makes it async);
 * - empty path: walk the graph from client nodes (or, if there are none, from root nodes) along
 *   edges; behaviors decide how a node's downstream calls combine (LB picks one, cache-aside etc.).
 */
import type { Finding, Flow } from '@/core';
import { behaviorsOf, type Call } from '../behaviors';
import { netBetween, type Place } from '../geo/distance';
import { userPlace, type GeoModel } from '../geo/places';
import { placeOf, selectCalls, type GeoWalk } from '../geo/routing';
import { hasBehavior, isDataStore } from './compile';
import { asyncExpr, choice, EMPTY, type Expr, seq, visit } from './expr';
import { engineFinding } from './findings';
import { withProtocol } from './protocol';
import type { FlowLoad } from './load';
import type { CompiledNode, EngineOptions, Model, Op } from './types';

export interface RoutedFlow {
  flowId: string;
  name: string;
  /**
   * S10: with geo active, one routed flow per (flow, user region); otherwise one per flow for all
   * regions (`regionId` undefined).
   */
  regionId?: string | undefined;
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

export function route(
  loads: readonly FlowLoad[],
  model: Model,
  options: EngineOptions,
  geo?: GeoModel,
): RoutePlan {
  const issues: Finding[] = [];
  const geoIssues: Finding[] = [];
  const routeOne = (flow: Flow, ctx: GeoWalk | undefined, sink: Finding[]) =>
    flow.path.length === 0
      ? graphRoute(model, 'read', options, sink, ctx)
      : pathRoute(flow, model, options, ctx);
  const flows: RoutedFlow[] = [];
  for (const { flow, rps, explain, byRegion } of loads) {
    const inferred = flow.path.length === 0;
    const base = { flowId: flow.id, name: flow.name, inferred };
    if (!geo?.active || byRegion.length === 0) {
      flows.push({ ...base, rps, expr: routeOne(flow, undefined, issues), explain });
      continue;
    }
    byRegion.forEach((r, i) => {
      const ctx: GeoWalk = { geo, user: userPlace(r.regionId), issues: geoIssues };
      // Graph-shape findings are the same for every region: keep the first region's only.
      const sink = i === 0 ? issues : [];
      flows.push({
        ...base,
        regionId: r.regionId,
        rps: r.rps,
        expr: routeOne(flow, ctx, sink),
        explain: r.explain,
      });
    });
  }
  const seen = new Set<string>();
  for (const f of geoIssues) {
    const key = `${f.title}|${f.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(f);
  }
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

/** Data store → data store edges carry replication (writes), not reads. */
function isReplication(from: CompiledNode, to: CompiledNode): boolean {
  return isDataStore(from) && isDataStore(to);
}

function graphRoute(
  model: Model,
  op: Op,
  options: EngineOptions,
  issues: Finding[],
  geo?: GeoWalk,
): Expr {
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

  const walk = (
    node: CompiledNode,
    edgeId: string | undefined,
    caller: Place | undefined,
  ): Expr => {
    visits++;
    const here = geo ? placeOf(node, caller, geo) : undefined;
    const net =
      geo && edgeId !== undefined
        ? withProtocol(netBetween(caller, here), model.edges.get(edgeId))
        : undefined;
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
        if (op === 'read' && isReplication(node, target)) continue;
        calls.push({ edge: e, target, expr: walk(target, e.id, here) });
      }
      stack.delete(node.id);
    } else {
      budgetHit = true;
    }
    const combine = (cs: readonly Call[]) => combineCalls(cs, op, options);
    const finish = (cs: readonly Call[]): Expr => {
      for (const b of behaviorsOf(node.behaviors)) {
        const then = b.routeOut?.({ node, op, calls: cs, model, options, combine });
        if (then !== undefined) return then;
      }
      return combine(cs);
    };
    const picks = geo ? selectCalls(node, here, op, calls, geo) : undefined;
    const then = picks
      ? choice(picks.map((o) => ({ p: o.p, expr: finish(o.calls) })))
      : finish(calls);
    return visit(node.id, op, then, edgeId, net);
  };

  const expr = choice(
    entries.map((n) => ({ p: 1 / entries.length, expr: walk(n, undefined, undefined) })),
  );
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

function pathRoute(flow: Flow, model: Model, options: EngineOptions, geo?: GeoWalk): Expr {
  const steps = flow.path.filter((s) => model.nodes.has(s.nodeId));
  // Places along the path, forward (an unplaced step is where the previous step is).
  const places: (Place | undefined)[] = [];
  if (geo) {
    let prev: Place | undefined;
    for (const st of steps) {
      prev = placeOf(model.nodes.get(st.nodeId) as CompiledNode, prev, geo);
      places.push(prev);
    }
  }
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
    const net = geo && i > 0 ? withProtocol(netBetween(places[i - 1], places[i]), edge) : undefined;
    rest = visit(node.id, step.op, then ?? rest, edge?.id, net);
    if (edge && !edge.sync && !hasBehavior(node, 'queue')) rest = asyncExpr(rest);
  }
  return rest;
}
