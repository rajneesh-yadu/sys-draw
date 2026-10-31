/**
 * The SysDraw save format, used for both IndexedDB and exported JSON files:
 * a Workspace document (schemaVersion, settings, projects) plus `boards` and their `layouts`.
 * Everything in a file shares one `schemaVersion`, so core's migration chain upgrades the whole
 * file; migrations that change boards must migrate `boards[]` too.
 */
import { z } from 'zod';
import {
  BoardSchema,
  CURRENT_SCHEMA_VERSION,
  MigrationError,
  WorkspaceSchema,
  migrate,
  type Board,
  type Project,
  type UserSettings,
} from '@/core';
import { boardsOfProject, type BoardLayout, type WorkspaceData } from '@/store';

export const SAVE_FORMAT = 'sysdraw';
export const SAVE_KINDS = ['workspace', 'project', 'board'] as const;
export type SaveKind = (typeof SAVE_KINDS)[number];

export interface SaveFile {
  format: typeof SAVE_FORMAT;
  kind: SaveKind;
  schemaVersion: number;
  exportedAt: string;
  settings: UserSettings;
  /** Empty for a board file. */
  projects: Project[];
  boards: Board[];
  /** Board id → view layout (group frames). */
  layouts: Record<string, BoardLayout>;
}

const RectSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});
export const BoardLayoutSchema = z.object({ groupFrames: z.record(z.string(), RectSchema) });

// ---------- export ----------

function baseFile(data: WorkspaceData, kind: SaveKind, now: string) {
  return {
    format: SAVE_FORMAT,
    kind,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: now,
    settings: data.settings,
  } as const;
}

function layoutsFor(data: WorkspaceData, boards: readonly Board[]): Record<string, BoardLayout> {
  const out: Record<string, BoardLayout> = {};
  for (const b of boards) {
    const l = data.layouts[b.id];
    if (l) out[b.id] = l;
  }
  return out;
}

/** The whole workspace (what IndexedDB holds), boards in sidebar/tab order. */
export function workspaceFile(data: WorkspaceData, now = new Date().toISOString()): SaveFile {
  const boards = data.projects.flatMap((p) => boardsOfProject(data, p.id));
  return {
    ...baseFile(data, 'workspace', now),
    projects: data.projects,
    boards,
    layouts: layoutsFor(data, boards),
  };
}

export function projectFile(
  data: WorkspaceData,
  projectId: string,
  now = new Date().toISOString(),
): SaveFile {
  const project = data.projects.find((p) => p.id === projectId);
  if (!project) throw new Error(`Unknown project "${projectId}"`);
  const boards = boardsOfProject(data, projectId);
  return {
    ...baseFile(data, 'project', now),
    projects: [project],
    boards,
    layouts: layoutsFor(data, boards),
  };
}

export function boardFile(
  data: WorkspaceData,
  boardId: string,
  now = new Date().toISOString(),
): SaveFile {
  const board = data.boards[boardId];
  if (!board) throw new Error(`Unknown board "${boardId}"`);
  return {
    ...baseFile(data, 'board', now),
    projects: [],
    boards: [board],
    layouts: layoutsFor(data, [board]),
  };
}

export function serializeSaveFile(file: SaveFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'untitled'
  );
}

/** `sysdraw-board-cache-layer.json`, `sysdraw-project-chat-app.json`, `sysdraw-workspace.json`. */
export function saveFileName(file: SaveFile): string {
  if (file.kind === 'workspace') return 'sysdraw-workspace.json';
  const name = file.kind === 'board' ? file.boards[0]?.name : file.projects[0]?.name;
  return `sysdraw-${file.kind}-${slug(name ?? '')}.json`;
}

// ---------- parse (migrate + validate) ----------

export interface ParseOptions {
  /**
   * Storage load: skip what is broken (invalid boards/layouts, dangling ids) with a warning
   * instead of rejecting the whole file. Import is strict (default).
   */
  lenient?: boolean;
}

export interface ParsedSaveFile {
  file: SaveFile;
  fromVersion: number;
  /** Migrations that ran ("v0→v1: …"). */
  applied: string[];
  /** Things skipped or repaired (lenient mode) — show them; nothing was silently dropped. */
  warnings: string[];
}

export type ParseSaveResult = { ok: true; value: ParsedSaveFile } | { ok: false; errors: string[] };

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * Drop flow steps and chaos events whose targets are not on the board (lenient load only):
 * the board then passes BoardSchema instead of being skipped entirely.
 */
function repairBoardRefs(raw: unknown): unknown {
  if (!isRecord(raw) || !isRecord(raw.graph) || !isRecord(raw.scenario)) return raw;
  const ids = (k: string) =>
    new Set(
      (Array.isArray((raw.graph as Record<string, unknown>)[k])
        ? ((raw.graph as Record<string, unknown>)[k] as unknown[])
        : []
      )
        .filter(isRecord)
        .map((x) => x.id),
    );
  const nodes = ids('nodes');
  const edges = ids('edges');
  const groups = ids('groups');
  const sc = raw.scenario;
  const flows = Array.isArray(sc.flows)
    ? sc.flows.map((f) =>
        isRecord(f) && Array.isArray(f.path)
          ? { ...f, path: f.path.filter((s) => isRecord(s) && nodes.has(s.nodeId)) }
          : f,
      )
    : sc.flows;
  const events = Array.isArray(sc.events)
    ? sc.events.filter(
        (e) =>
          !isRecord(e) ||
          !(
            (e.nodeId !== undefined && !nodes.has(e.nodeId)) ||
            (e.edgeId !== undefined && !edges.has(e.edgeId)) ||
            (e.groupId !== undefined && !groups.has(e.groupId))
          ),
      )
    : sc.events;
  return { ...raw, scenario: { ...sc, flows, events } };
}

/**
 * Read a save file (object or JSON text): run core migrations, then validate the workspace part,
 * every board and every layout, and check that projects and boards point at each other.
 */
export function parseSaveFile(input: unknown, options: ParseOptions = {}): ParseSaveResult {
  const lenient = options.lenient ?? false;
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch (e) {
      return { ok: false, errors: [`Not a valid JSON file: ${(e as Error).message}`] };
    }
  }
  if (!isRecord(raw)) return { ok: false, errors: ['A SysDraw file must be a JSON object'] };
  if (raw.format !== undefined && raw.format !== SAVE_FORMAT) {
    return { ok: false, errors: [`Not a SysDraw file (format "${String(raw.format)}")`] };
  }
  const kind: SaveKind = (SAVE_KINDS as readonly unknown[]).includes(raw.kind)
    ? (raw.kind as SaveKind)
    : 'workspace';

  let migrated: Record<string, unknown>;
  let fromVersion: number;
  let applied: string[];
  try {
    const res = migrate(raw);
    migrated = res.doc;
    fromVersion = res.fromVersion;
    applied = res.applied;
  } catch (e) {
    if (e instanceof MigrationError) return { ok: false, errors: [e.message] };
    throw e;
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  const problem = (msg: string) => (lenient ? warnings : errors).push(msg);

  const ws = WorkspaceSchema.safeParse({
    schemaVersion: migrated.schemaVersion,
    projects: migrated.projects,
    settings: migrated.settings,
  });
  if (!ws.success) {
    return {
      ok: false,
      errors: ws.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    };
  }

  // Boards
  const rawBoards = migrated.boards === undefined ? [] : migrated.boards;
  if (!Array.isArray(rawBoards)) return { ok: false, errors: ['boards: Expected an array'] };
  const boards: Board[] = [];
  const seen = new Set<string>();
  rawBoards.forEach((rb, i) => {
    let res = BoardSchema.safeParse(rb);
    if (!res.success && lenient) {
      const repaired = BoardSchema.safeParse(repairBoardRefs(rb));
      if (repaired.success) {
        warnings.push(
          `Board "${repaired.data.name}": removed flow steps/chaos events pointing at deleted items`,
        );
        res = repaired;
      }
    }
    if (!res.success) {
      const name = isRecord(rb) && typeof rb.name === 'string' ? ` "${rb.name}"` : '';
      const first = res.error.issues[0];
      const where = first ? `${first.path.join('.') || '(root)'}: ${first.message}` : 'invalid';
      problem(`Board ${i + 1}${name} is invalid (${where})${lenient ? ' — skipped' : ''}`);
      return;
    }
    if (seen.has(res.data.id)) {
      problem(`Duplicate board id "${res.data.id}"${lenient ? ' — skipped' : ''}`);
      return;
    }
    seen.add(res.data.id);
    boards.push(res.data);
  });

  // Layouts (view state: an invalid one is dropped with a warning even in strict mode)
  const layouts: Record<string, BoardLayout> = {};
  if (isRecord(migrated.layouts)) {
    for (const [id, l] of Object.entries(migrated.layouts)) {
      if (!seen.has(id)) continue;
      const res = BoardLayoutSchema.safeParse(l);
      if (res.success) layouts[id] = res.data;
      else warnings.push(`Layout of board "${id}" is invalid — group sizes reset`);
    }
  }

  // Cross references
  const byId = new Map(boards.map((b) => [b.id, b]));
  const projects: Project[] = ws.data.projects.map((p) => {
    const boardIds = p.boardIds.filter((id) => {
      const b = byId.get(id);
      if (!b) {
        problem(`Project "${p.name}" lists missing board "${id}"`);
        return false;
      }
      if (b.projectId !== p.id) {
        problem(`Board "${b.name}" belongs to "${b.projectId}" but is listed in "${p.id}"`);
        return false;
      }
      return true;
    });
    return boardIds.length === p.boardIds.length ? p : { ...p, boardIds };
  });
  if (kind === 'board') {
    if (boards.length !== 1)
      errors.push(`A board file must hold exactly 1 board, found ${boards.length}`);
  } else {
    const listed = new Set(projects.flatMap((p) => p.boardIds));
    const kept: Board[] = [];
    for (const b of boards) {
      if (listed.has(b.id)) {
        kept.push(b);
        continue;
      }
      const owner = projects.find((p) => p.id === b.projectId);
      if (lenient && owner) {
        owner.boardIds.push(b.id); // projects are fresh objects from Zod, safe to extend
        kept.push(b);
        warnings.push(`Board "${b.name}" was not listed in its project — re-attached`);
      } else {
        problem(`Board "${b.name}" is not listed in any project${lenient ? ' — skipped' : ''}`);
      }
    }
    boards.splice(0, boards.length, ...kept);
    if (kind === 'project' && projects.length === 0)
      errors.push('A project file must hold a project');
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      file: {
        format: SAVE_FORMAT,
        kind,
        schemaVersion: ws.data.schemaVersion,
        exportedAt: typeof migrated.exportedAt === 'string' ? migrated.exportedAt : '',
        settings: ws.data.settings,
        projects,
        boards,
        layouts,
      },
      fromVersion,
      applied,
      warnings,
    },
  };
}

/** Turn a parsed workspace file into store data. */
export function toWorkspaceData(file: SaveFile): WorkspaceData {
  return {
    settings: file.settings,
    projects: file.projects,
    boards: Object.fromEntries(file.boards.map((b) => [b.id, b])),
    layouts: { ...file.layouts },
  };
}
