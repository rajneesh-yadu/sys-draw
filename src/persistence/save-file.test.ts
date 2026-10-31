import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION } from '@/core';
import {
  boardFile,
  parseSaveFile,
  projectFile,
  saveFileName,
  serializeSaveFile,
  workspaceFile,
} from './save-file';
import { addNode, makeStores } from './test-utils';

const T = '2026-10-31T12:00:00.000Z';

function sampleData() {
  const { board, ws } = makeStores();
  addNode(board);
  const nodeId = addNode(board, 200);
  board.getState().dispatch({ type: 'group', memberIds: [nodeId], kind: 'vpc' });
  const g = board.getState().doc.graph.groups[0]!.id;
  board.getState().dispatch({
    type: 'setGroupFrame',
    groupId: g,
    frame: { x: 10, y: 10, width: 300, height: 200 },
  });
  ws.getState().saveSnapshot('two nodes');
  ws.getState().createBoard(undefined, 'Second');
  addNode(board);
  ws.getState().createProject('Chat');
  return ws.getState().data;
}

const ok = <T>(r: { ok: true; value: T } | { ok: false; errors: string[] }): T => {
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.value;
};

describe('export → parse round trip', () => {
  it('workspace file round-trips exactly (boards, snapshots, layouts, order)', () => {
    const data = sampleData();
    const file = workspaceFile(data, T);
    expect(file.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    const parsed = ok(parseSaveFile(serializeSaveFile(file)));
    expect(parsed.warnings).toEqual([]);
    expect(parsed.applied).toEqual([]);
    expect(parsed.file).toEqual(JSON.parse(JSON.stringify(file)));
    expect(parsed.file.boards.map((b) => b.name)).toEqual(['Board 1', 'Second', 'Board 1']);
  });

  it('project and board files hold just that', () => {
    const data = sampleData();
    const pid = data.projects[0]!.id;
    const pf = projectFile(data, pid, T);
    expect(pf.projects).toHaveLength(1);
    expect(pf.boards).toHaveLength(2);
    const bid = data.projects[0]!.boardIds[0]!;
    const bf = boardFile(data, bid, T);
    expect(bf.projects).toEqual([]);
    expect(Object.keys(bf.layouts)).toEqual([bid]);
    expect(ok(parseSaveFile(serializeSaveFile(bf))).file.kind).toBe('board');
    expect(ok(parseSaveFile(serializeSaveFile(pf))).file.boards).toHaveLength(2);
    expect(saveFileName(bf)).toBe('sysdraw-board-board-1.json');
    expect(saveFileName(pf)).toBe('sysdraw-project-my-project.json');
  });
});

describe('migration on import', () => {
  it('upgrades a v0 file (no schemaVersion, no settings, no format)', () => {
    const data = sampleData();
    const file = JSON.parse(serializeSaveFile(projectFile(data, data.projects[0]!.id, T)));
    delete file.schemaVersion;
    delete file.settings;
    delete file.format;
    file.kind = 'project';
    const parsed = ok(parseSaveFile(file));
    expect(parsed.fromVersion).toBe(0);
    expect(parsed.applied).toEqual(['v0→v1: Add schemaVersion and default user settings']);
    expect(parsed.file.settings.autosave).toBe(true);
    expect(parsed.file.boards).toHaveLength(2);
  });

  it('rejects files from a newer SysDraw', () => {
    const file = { ...workspaceFile(sampleData(), T), schemaVersion: CURRENT_SCHEMA_VERSION + 1 };
    const r = parseSaveFile(file);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/newer SysDraw/);
  });
});

describe('validation', () => {
  it('rejects non-JSON, non-objects and foreign formats', () => {
    expect(parseSaveFile('{oops')).toMatchObject({ ok: false });
    expect(parseSaveFile('[1,2]')).toMatchObject({ ok: false });
    expect(parseSaveFile({ format: 'excalidraw' })).toMatchObject({ ok: false });
  });

  it('strict: an invalid board rejects the file with a readable reason', () => {
    const file = JSON.parse(serializeSaveFile(workspaceFile(sampleData(), T)));
    file.boards[0].graph.edges.push({
      id: 'edge_x',
      source: 'node_nope',
      target: 'node_nope',
      protocolStack: [],
      sync: true,
      config: {},
    });
    const r = parseSaveFile(file);
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.errors[0]).toMatch(/Board 1 "Board 1" is invalid \(graph\.edges\.\d+\.source/);
  });

  it('lenient: skips the invalid board, keeps the rest, and says so', () => {
    const file = JSON.parse(serializeSaveFile(workspaceFile(sampleData(), T)));
    file.boards[1].graph = 'garbage';
    const v = ok(parseSaveFile(file, { lenient: true }));
    expect(v.file.boards).toHaveLength(2);
    expect(v.warnings.join('\n')).toMatch(/Second.*skipped/);
    expect(v.warnings.join('\n')).toMatch(/lists missing board/);
  });

  it('lenient: repairs flow steps that point at deleted nodes', () => {
    const file = JSON.parse(serializeSaveFile(workspaceFile(sampleData(), T)));
    file.boards[0].scenario.flows = [
      {
        id: 'flow_1',
        name: 'Read',
        share: 1,
        rpsPerUser: 1,
        path: [{ nodeId: 'node_gone', op: 'read' }],
      },
    ];
    expect(parseSaveFile(file).ok).toBe(false);
    const v = ok(parseSaveFile(file, { lenient: true }));
    expect(v.file.boards[0]!.scenario.flows[0]!.path).toEqual([]);
    expect(v.warnings[0]).toMatch(/removed flow steps/);
  });

  it('drops an invalid layout with a warning (view state only)', () => {
    const data = sampleData();
    const bid = data.projects[0]!.boardIds[0]!;
    const file = JSON.parse(serializeSaveFile(boardFile(data, bid, T)));
    file.layouts[bid] = { groupFrames: { grp_1: { x: 0, y: 0, width: -5, height: 1 } } };
    const v = ok(parseSaveFile(file));
    expect(v.file.layouts).toEqual({});
    expect(v.warnings[0]).toMatch(/group sizes reset/);
  });

  it('a board file must hold exactly one board', () => {
    const data = sampleData();
    const file = JSON.parse(serializeSaveFile(projectFile(data, data.projects[0]!.id, T)));
    file.kind = 'board';
    expect(parseSaveFile(file)).toMatchObject({ ok: false });
  });
});
