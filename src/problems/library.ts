/**
 * S17 — problem library logic (pure; the UI in this folder only presents it).
 * Problems are registry entries (`registry/problems/<id>/index.ts`); this file lists, filters and
 * describes them, and turns a problem + the user's choices into a new board.
 */
import type { Registry, RegistryProblemDefinition } from '@/registry';
import type {
  Board,
  BoardCommand,
  BoardLayout,
  BoardStore,
  Graph,
  ImportedBoards,
  ProviderId,
  Scenario,
  WorkspaceResult,
  WorkspaceStore,
} from '@/store';

export type Problem = RegistryProblemDefinition;
export type ModeId = Board['mode'];

/** Problems are tagged `company:<name>` for the "company style" filter; other tags are topics. */
export const COMPANY_TAG_PREFIX = 'company:';

export const LEVEL_LABELS: Readonly<Record<number, string>> = {
  1: 'Basic',
  2: 'Easy',
  3: 'Medium',
  4: 'Hard',
  5: 'Expert',
};

const COMPANY_NAMES: Readonly<Record<string, string>> = {
  x: 'X (Twitter)',
  meta: 'Meta',
  google: 'Google',
  amazon: 'Amazon',
  uber: 'Uber',
  lyft: 'Lyft',
  stripe: 'Stripe',
  paypal: 'PayPal',
  discord: 'Discord',
  netflix: 'Netflix',
  github: 'GitHub',
  bitly: 'Bitly',
  cloudflare: 'Cloudflare',
  pastebin: 'Pastebin',
};

export function companyLabel(id: string): string {
  return COMPANY_NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

export function companyStyles(p: Pick<Problem, 'tags'>): string[] {
  return p.tags
    .filter((t) => t.startsWith(COMPANY_TAG_PREFIX))
    .map((t) => t.slice(COMPANY_TAG_PREFIX.length));
}

export function topicTags(p: Pick<Problem, 'tags'>): string[] {
  return p.tags.filter((t) => !t.startsWith(COMPANY_TAG_PREFIX));
}

/** Every problem in the registry, easiest first. */
export function listProblems(registry: Registry): Problem[] {
  return sortProblems(registry.list({ kind: 'problem' }));
}

export function findProblem(registry: Registry, id: string | undefined): Problem | undefined {
  return id ? registry.get(id, 'problem') : undefined;
}

/** Registry problems, easiest first, then by title. */
export function sortProblems(problems: readonly Problem[]): Problem[] {
  return [...problems].sort((a, b) => a.level - b.level || a.title.localeCompare(b.title));
}

export interface ProblemFilter {
  /** Exact level 1–5; undefined = any. */
  level?: number | undefined;
  /** Topic tag; undefined/'' = any. */
  tag?: string | undefined;
  /** Company id (without the `company:` prefix); undefined/'' = any. */
  company?: string | undefined;
  /** Case-insensitive text in title, summary, tags or requirements. */
  query?: string | undefined;
}

export function matchesFilter(p: Problem, f: ProblemFilter): boolean {
  if (f.level !== undefined && p.level !== f.level) return false;
  if (f.tag && !topicTags(p).includes(f.tag)) return false;
  if (f.company && !companyStyles(p).includes(f.company)) return false;
  const q = f.query?.trim().toLowerCase();
  if (q) {
    const text = [
      p.title,
      p.docs.summary,
      ...p.tags,
      ...companyStyles(p).map(companyLabel),
      ...p.requirements.functional,
    ]
      .join(' ')
      .toLowerCase();
    if (!q.split(/\s+/).every((w) => text.includes(w))) return false;
  }
  return true;
}

export function filterProblems(problems: readonly Problem[], f: ProblemFilter): Problem[] {
  return sortProblems(problems).filter((p) => matchesFilter(p, f));
}

export interface ProblemFacets {
  levels: number[];
  /** Topic tags with how many problems carry each, most common first. */
  tags: { tag: string; count: number }[];
  companies: { id: string; label: string; count: number }[];
}

export function problemFacets(problems: readonly Problem[]): ProblemFacets {
  const levels = [...new Set(problems.map((p) => p.level))].sort((a, b) => a - b);
  const tagCounts = new Map<string, number>();
  const companyCounts = new Map<string, number>();
  for (const p of problems) {
    for (const t of topicTags(p)) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    for (const c of companyStyles(p)) companyCounts.set(c, (companyCounts.get(c) ?? 0) + 1);
  }
  const byCount = <T extends { count: number }>(a: T & { k: string }, b: T & { k: string }) =>
    b.count - a.count || a.k.localeCompare(b.k);
  return {
    levels,
    tags: [...tagCounts]
      .map(([tag, count]) => ({ tag, count, k: tag }))
      .sort(byCount)
      .map(({ tag, count }) => ({ tag, count })),
    companies: [...companyCounts]
      .map(([id, count]) => ({ id, label: companyLabel(id), count, k: companyLabel(id) }))
      .sort(byCount)
      .map(({ id, label, count }) => ({ id, label, count })),
  };
}

// ---------- describing scale ----------

const SI = [
  { v: 1e15, s: 'P' },
  { v: 1e12, s: 'T' },
  { v: 1e9, s: 'B' },
  { v: 1e6, s: 'M' },
  { v: 1e3, s: 'k' },
];

/** 500_000_000 → "500M"; 1_500 → "1.5k". */
export function formatCount(n: number): string {
  for (const { v, s } of SI) {
    if (Math.abs(n) >= v) return `${trim(n / v)}${s}`;
  }
  return trim(n);
}

/** Decimal bytes: 3e12 → "3 TB". */
export function formatBytes(bytes: number): string {
  const units = [
    { v: 1e15, s: 'PB' },
    { v: 1e12, s: 'TB' },
    { v: 1e9, s: 'GB' },
    { v: 1e6, s: 'MB' },
    { v: 1e3, s: 'kB' },
  ];
  for (const { v, s } of units) if (bytes >= v) return `${trim(bytes / v)} ${s}`;
  return `${trim(bytes)} B`;
}

function trim(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

export function formatReadWrite(ratio: number): string {
  return ratio >= 1 ? `${trim(ratio)} : 1 reads : writes` : `1 : ${trim(1 / ratio)} reads : writes`;
}

/** Peak requests per second of the preset (Σ users × rpsPerUser × share × peak), no daily cycle. */
export function presetPeakRps(s: Scenario): number {
  const users = Object.values(s.usersByRegion).reduce((a, b) => a + b, 0);
  return s.flows.reduce((sum, f) => sum + users * f.rpsPerUser * f.share * s.peakMultiplier, 0);
}

/** One line per rubric item, e.g. "p99 < 200 ms (Redirect)" or "Rule: rule.plaintext-edge". */
export function rubricLines(p: Problem): { text: string; weight: number }[] {
  const flowName = (id: string | undefined) =>
    id ? (p.scenario.flows.find((f) => f.id === id)?.name ?? id) : undefined;
  const OPS = { lt: '<', lte: '≤', gt: '>', gte: '≥' } as const;
  return p.rubric.map((r) => {
    const parts: string[] = [];
    if (r.slo) {
      const { metric, op, value } = r.slo;
      const v =
        metric === 'availability' || metric === 'errorRate'
          ? `${trim(value * 100)}%`
          : metric === 'costPerMonth'
            ? `$${formatCount(value)}/month`
            : metric === 'rps'
              ? `${formatCount(value)} rps`
              : `${value} ms`;
      const flow = flowName(r.slo.flowId);
      parts.push(`${metric} ${OPS[op]} ${v}${flow ? ` (${flow})` : ''}`);
      if (r.slo.atRps) parts.push(`at ${formatCount(r.slo.atRps)} rps`);
    }
    if (r.ruleId) parts.push(`passes ${r.ruleId.replace(/^rule\./, '')}`);
    return { text: parts.join(', '), weight: r.weight };
  });
}

// ---------- starting a problem ----------

export type StartFrom = 'blank' | 'reference' | 'debug';

export interface ModeOption {
  id: ModeId;
  label: string;
  description: string;
  /** Why it cannot be chosen for this problem (undefined = available). */
  disabledReason?: string | undefined;
  /** What the board starts with; the first is the default. */
  starts: StartFrom[];
}

const MODE_INFO: { id: ModeId; label: string; description: string; starts: StartFrom[] }[] = [
  {
    id: 'guided',
    label: 'Guided',
    description:
      'Step by step: requirements, estimates, design, scale, bottlenecks. Hints on request.',
    starts: ['blank', 'reference'],
  },
  {
    id: 'interview',
    label: 'Interview',
    description:
      '45-minute session as in a real interview: no hints or reference until you finish.',
    starts: ['blank'],
  },
  {
    id: 'sandbox',
    label: 'Sandbox',
    description: 'Build freely with the brief beside you; hints and the reference stay available.',
    starts: ['blank', 'reference'],
  },
  {
    id: 'debug',
    label: 'Debug',
    description: 'Start from a broken design with symptoms in the metrics, and fix it.',
    starts: ['debug'],
  },
  {
    id: 'chaos',
    label: 'Chaos',
    description: 'Start from the reference design and inject failures to see how it copes.',
    starts: ['reference', 'blank'],
  },
];

export const START_LABELS: Readonly<Record<StartFrom, string>> = {
  blank: 'Empty board (scenario only)',
  reference: 'Reference solution',
  debug: 'Broken design (debug variant)',
};

/** Modes a problem can be started in (Learn is for lessons, not problems). */
export function modeOptions(p: Problem): ModeOption[] {
  return MODE_INFO.map((m) => ({
    ...m,
    starts: [...m.starts],
    disabledReason:
      m.id === 'debug' && p.debugVariants.length === 0
        ? 'No broken variant ships for this problem yet'
        : undefined,
  }));
}

/** Hints and the reference solution are hidden while interviewing. */
export function hintsAllowed(mode: ModeId): boolean {
  return mode !== 'interview';
}

/**
 * The preset for an empty board: same users, load and payloads, but flow paths cleared (the
 * engine then follows the graph from the clients) and node/edge/group-targeted events dropped,
 * since none of the reference's nodes exist yet.
 */
export function blankScenario(s: Scenario): Scenario {
  const copy = structuredClone(s);
  return {
    ...copy,
    flows: copy.flows.map((f) => ({ ...f, path: [] })),
    events: copy.events.filter((e) => !('nodeId' in e || 'edgeId' in e || 'groupId' in e)),
  };
}

export interface StartOptions {
  mode: ModeId;
  start: StartFrom;
  /** Debug variant index (start = 'debug'), default 0. */
  variant?: number;
  providerId?: ProviderId;
  /** Board name; default "<title> · <mode>". Made unique within the project on import. */
  name?: string;
  /** Board id to propose (kept if free); default `board_<problem>-<mode>`. */
  boardId?: string;
}

export interface ProblemBoardPlan {
  board: Board;
  layout: BoardLayout;
}

/** The board a problem start creates (not yet added to a workspace). */
export function problemBoard(p: Problem, opts: StartOptions, projectId: string): ProblemBoardPlan {
  const option = modeOptions(p).find((m) => m.id === opts.mode);
  if (!option) throw new Error(`Mode "${opts.mode}" is not available for problems`);
  if (option.disabledReason) throw new Error(`${option.label}: ${option.disabledReason}`);
  if (!option.starts.includes(opts.start)) {
    throw new Error(`${option.label} mode cannot start from "${START_LABELS[opts.start]}"`);
  }
  let graph: Graph;
  let scenario: Scenario;
  if (opts.start === 'reference') {
    graph = structuredClone(p.referenceSolutions[0] as Graph);
    scenario = structuredClone(p.scenario);
  } else if (opts.start === 'debug') {
    const v = p.debugVariants[opts.variant ?? 0];
    if (!v) throw new Error(`Debug variant ${opts.variant ?? 0} does not exist`);
    graph = structuredClone(v.graph);
    scenario = structuredClone(p.scenario);
  } else {
    graph = { nodes: [], edges: [], groups: [] };
    scenario = blankScenario(p.scenario);
  }
  const slug = p.id.replace(/^problem\./, '');
  const board: Board = {
    id: opts.boardId ?? `board_${slug}-${opts.mode}`,
    projectId,
    name: opts.name ?? `${p.title} · ${option.label}`,
    providerId: opts.providerId ?? 'generic',
    mode: opts.mode,
    problemId: p.id,
    graph,
    scenario,
    snapshots: [],
  };
  return { board, layout: { groupFrames: {} } };
}

/** "Start problem": adds the board to the active project (or `projectId`) and opens it. */
export function startProblem(
  workspace: WorkspaceStore,
  p: Problem,
  opts: StartOptions,
  projectId?: string,
): WorkspaceResult<{ boardId: string }> {
  const ws = workspace.getState();
  const target =
    projectId ??
    ws.data.projects.find((pr) => pr.boardIds.includes(ws.activeBoardId))?.id ??
    ws.data.projects[0]?.id;
  if (!target) return { ok: false, reason: 'No project to add the board to' };
  let plan: ProblemBoardPlan;
  try {
    plan = problemBoard(p, opts, target);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  const incoming: ImportedBoards = {
    boards: [plan.board],
    layouts: { [plan.board.id]: plan.layout },
  };
  const res = ws.importBoards(incoming, target);
  if (!res.ok) return res;
  const boardId = res.boardIds[0];
  return boardId ? { ok: true, boardId } : { ok: false, reason: 'The board was not created' };
}

/**
 * Replace the open board's design with a reference solution and its scenario preset, as one
 * undoable step.
 */
export function referenceCommand(p: Problem, index = 0): BoardCommand {
  const graph = p.referenceSolutions[index];
  if (!graph) throw new Error(`Reference solution ${index} does not exist`);
  return {
    type: 'batch',
    label: `Load reference solution: ${p.title}`,
    commands: [
      { type: 'replaceGraph', graph: structuredClone(graph), label: 'Reference solution' },
      { type: 'updateScenario', patch: structuredClone(p.scenario) },
    ],
  };
}

export function loadReferenceSolution(
  boardStore: BoardStore,
  p: Problem,
  index = 0,
): { ok: true } | { ok: false; reason: string } {
  return boardStore.getState().dispatch(referenceCommand(p, index));
}
