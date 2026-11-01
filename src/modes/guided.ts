/**
 * Guided mode content and checks (pure). A problem is walked through seven step cards —
 * requirements → estimates → API → data model → high-level design → scaling → bottlenecks — and
 * each card has checks that read the board, the latest result and the user's answers.
 */
import { checkProblemSlos, maxUtilization, runRules, scenarioPeakRps } from './evaluate';
import type { ModeContext } from './types';

export const GUIDED_STEP_IDS = [
  'requirements',
  'estimates',
  'api',
  'data-model',
  'hld',
  'scaling',
  'bottlenecks',
] as const;
export type GuidedStepId = (typeof GUIDED_STEP_IDS)[number];

export interface GuidedStepInfo {
  id: GuidedStepId;
  title: string;
  /** What to do on this card. */
  prompt: string;
  /** Why interviewers care. */
  why: string;
}

export const GUIDED_STEPS: readonly GuidedStepInfo[] = [
  {
    id: 'requirements',
    title: 'Requirements',
    prompt:
      'Confirm what the system must do (functional) and how well (non-functional: latency, availability, scale). Tick each requirement once you have restated it in your own words.',
    why: 'Designing before agreeing on scope is the most common way to fail an interview.',
  },
  {
    id: 'estimates',
    title: 'Back-of-envelope estimates',
    prompt:
      'Estimate the peak request rate and the data you will store. Within 2× of our numbers counts: the point is the order of magnitude.',
    why: 'Numbers decide the design: 100 rps fits one server, 1 M rps needs caching, sharding and many regions.',
  },
  {
    id: 'api',
    title: 'API',
    prompt:
      'Write one endpoint per line, e.g. "POST /urls" or "GET /urls/{alias}" (gRPC: "rpc Send(…)"). Cover every user flow.',
    why: 'The API pins down the flows you have to serve and what each request carries.',
  },
  {
    id: 'data-model',
    title: 'Data model',
    prompt:
      'Write one entity per line with its main fields, e.g. "Url: alias, longUrl, createdAt, expiresAt". Then pick a store for each.',
    why: 'Access patterns (by key? range? joins?) choose the database, the partition key and the indexes.',
  },
  {
    id: 'hld',
    title: 'High-level design',
    prompt:
      'Draw it on the canvas: clients, an entry point, services and data stores, connected. The simulation must serve every flow.',
    why: 'A working end-to-end path first; optimise later.',
  },
  {
    id: 'scaling',
    title: 'Scale it',
    prompt:
      'Meet the targets at peak load: add replicas, caches, read replicas, partitions or regions until every SLO holds and no node runs hotter than 85 %.',
    why: 'Above ~85 % utilisation queues explode and p99 latency with them.',
  },
  {
    id: 'bottlenecks',
    title: 'Bottlenecks and trade-offs',
    prompt:
      'Remove remaining bottlenecks and review findings, then note what would break first at 10× traffic and how you would fix it.',
    why: 'Strong candidates name their own design’s weak spots before the interviewer does.',
  },
];

export interface GuidedState {
  /** Card shown. */
  step: number;
  /** Requirement texts ticked (problem boards). */
  checked: string[];
  /** Free-text answers by step (requirements on a free board, API, data model, 10× note). */
  notes: Partial<Record<GuidedStepId, string>>;
  estimates: { peakRps?: number; storageBytes?: number };
  hintsShown: number;
  completedAtMs?: number;
}

export interface CheckItem {
  label: string;
  ok: boolean;
  detail?: string;
}

export interface GuidedStepResult extends GuidedStepInfo {
  passed: boolean;
  items: CheckItem[];
}

/** Estimates within this factor of ours (either way) pass. */
export const ESTIMATE_TOLERANCE = 2;
export const MAX_UTILIZATION = 0.85;
/** Free boards (no problem): every flow p99 under this. */
export const DEFAULT_P99_MS = 500;
const MIN_BOTTLENECK_NOTE = 20;

const API_LINE = /^\s*(?:(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\/\S*|rpc\s+\w+\s*\()/i;
const ENTITY_LINE = /^\s*([A-Za-z_][\w -]*?)\s*[:(]\s*(.+?)\)?\s*$/;

const lines = (text: string | undefined) =>
  (text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

export function apiEndpoints(text: string | undefined): string[] {
  return lines(text).filter((l) => API_LINE.test(l));
}

export function entities(text: string | undefined): { name: string; fields: string[] }[] {
  return lines(text).flatMap((l) => {
    const m = ENTITY_LINE.exec(l);
    if (!m) return [];
    const fields = (m[2] ?? '')
      .split(/[,;]/)
      .map((f) => f.trim())
      .filter(Boolean);
    return fields.length >= 2 ? [{ name: (m[1] ?? '').trim(), fields }] : [];
  });
}

export function withinFactor(value: number | undefined, expected: number, factor: number) {
  return (
    value !== undefined &&
    value > 0 &&
    expected > 0 &&
    value / expected <= factor &&
    expected / value <= factor
  );
}

export function initialGuidedState(): GuidedState {
  return { step: 0, checked: [], notes: {}, estimates: {}, hintsShown: 0 };
}

function categoryOf(ctx: ModeContext, defId: string): string | undefined {
  return ctx.registry.get(defId, 'component')?.category;
}

/** Every card with its checks evaluated now. */
export function guidedSteps(state: GuidedState, ctx: ModeContext): GuidedStepResult[] {
  const { problem, result, graph } = ctx;
  const scenario = problem?.scenario ?? ctx.scenario;
  const flows = ctx.scenario.flows;
  const check = (id: GuidedStepId): CheckItem[] => {
    switch (id) {
      case 'requirements': {
        if (problem) {
          const all = [...problem.requirements.functional, ...problem.requirements.nonFunctional];
          const done = all.filter((r) => state.checked.includes(r)).length;
          return [
            {
              label: `All requirements confirmed (${done}/${all.length})`,
              ok: done === all.length,
            },
          ];
        }
        const n = lines(state.notes.requirements).length;
        return [{ label: `At least 3 requirements written (${n})`, ok: n >= 3 }];
      }
      case 'estimates': {
        const peak = scenarioPeakRps(scenario);
        const items: CheckItem[] = [];
        if (peak <= 0) {
          items.push({ label: 'The scenario has users and flows to estimate', ok: false });
        } else {
          const ok = withinFactor(state.estimates.peakRps, peak, ESTIMATE_TOLERANCE);
          items.push({
            label: 'Peak requests/s within 2× of ours',
            ok,
            ...(state.estimates.peakRps !== undefined ? { detail: `ours ≈ ${fmt(peak)} rps` } : {}),
          });
        }
        if (problem) {
          const ok = withinFactor(
            state.estimates.storageBytes,
            problem.scale.dataSizeBytes,
            ESTIMATE_TOLERANCE,
          );
          items.push({
            label: 'Stored data within 2× of ours',
            ok,
            ...(state.estimates.storageBytes !== undefined
              ? { detail: `ours ≈ ${fmtBytes(problem.scale.dataSizeBytes)}` }
              : {}),
          });
        }
        return items;
      }
      case 'api': {
        const need = Math.max(2, flows.length);
        const n = apiEndpoints(state.notes.api).length;
        return [{ label: `At least ${need} endpoints, one per line (${n})`, ok: n >= need }];
      }
      case 'data-model': {
        const n = entities(state.notes['data-model']).length;
        return [{ label: `At least 2 entities with 2+ fields each (${n})`, ok: n >= 2 }];
      }
      case 'hld': {
        const cats = graph.nodes.map((n) => categoryOf(ctx, n.defId));
        const has = (...c: string[]) => cats.some((x) => x !== undefined && c.includes(x));
        const served =
          result !== null &&
          Object.keys(result.perFlow).length > 0 &&
          Object.values(result.perFlow).every((f) => f.rps > 0 && f.errorRate < 0.01);
        return [
          { label: 'A client', ok: has('clients') },
          { label: 'A service', ok: has('compute') },
          { label: 'A data store', ok: has('database', 'storage', 'cache') },
          { label: 'Every flow is served (errors < 1 %)', ok: served },
        ];
      }
      case 'scaling': {
        const items: CheckItem[] = problem
          ? checkProblemSlos(problem, result, ctx.scenario).map((c) => ({
              label: c.label,
              ok: c.passed,
              detail: c.actual,
            }))
          : Object.entries(result?.perFlow ?? {}).map(([fid, f]) => ({
              label: `p99 < ${DEFAULT_P99_MS} ms (${flows.find((x) => x.id === fid)?.name ?? fid})`,
              ok: f.p99 < DEFAULT_P99_MS,
              detail: `${Math.round(f.p99)} ms`,
            }));
        if (!problem && items.length === 0) items.push({ label: 'Run the simulation', ok: false });
        const hot = result ? maxUtilization(result) : undefined;
        items.push({
          label: 'No node above 85 % utilisation',
          ok: result !== null && (hot === undefined || hot.utilization <= MAX_UTILIZATION),
          ...(hot
            ? {
                detail: `hottest: ${graph.nodes.find((n) => n.id === hot.nodeId)?.label ?? hot.nodeId} ${Math.round(hot.utilization * 100)} %`,
              }
            : {}),
        });
        return items;
      }
      case 'bottlenecks': {
        const items: CheckItem[] = [
          {
            label: 'No bottleneck in the results',
            ok: result !== null && result.system.bottlenecks.length === 0,
            ...(result && result.system.bottlenecks.length
              ? {
                  detail: result.system.bottlenecks
                    .map((id) => graph.nodes.find((n) => n.id === id)?.label ?? id)
                    .join(', '),
                }
              : {}),
          },
        ];
        const ruleIds = problem?.rubric.flatMap((r) => (r.ruleId ? [r.ruleId] : [])) ?? [];
        if (ruleIds.length) {
          const findings = runRules(ctx.registry, ruleIds, graph, ctx.scenario, result);
          items.push({
            label: 'The rubric’s review rules pass',
            ok: findings.length === 0,
            ...(findings[0] ? { detail: findings[0].title } : {}),
          });
        }
        const note = (state.notes.bottlenecks ?? '').trim().length;
        items.push({ label: 'Noted what breaks first at 10×', ok: note >= MIN_BOTTLENECK_NOTE });
        return items;
      }
    }
  };
  return GUIDED_STEPS.map((info) => {
    const items = check(info.id);
    return { ...info, items, passed: items.every((i) => i.ok) };
  });
}

/** Points lost per hint shown. */
export const GUIDED_HINT_COST = 8;
export function guidedScore(state: GuidedState): number {
  return Math.max(40, 100 - GUIDED_HINT_COST * state.hintsShown);
}

function fmt(n: number): string {
  if (n >= 1e6) return `${+(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${+(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`;
  return `${Math.round(n)}`;
}

export function fmtBytes(b: number): string {
  const units = ['B', 'kB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  let v = b;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${+v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}
export { fmt as formatCompact };
