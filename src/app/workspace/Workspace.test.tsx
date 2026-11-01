import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { IdKind } from '@/core';
import {
  BoardStoreProvider,
  WorkspaceStoreProvider,
  createAppStores,
  type BoardStore,
  type WorkspaceStore,
} from '@/store';
import { BoardTabs } from './BoardTabs';
import { NoticeProvider } from './notices';
import { ProjectSidebar } from './ProjectSidebar';

let board: BoardStore;
let ws: WorkspaceStore;

function ids() {
  let i = 0;
  return (k: IdKind) =>
    `${k === 'project' ? 'proj' : k === 'snapshot' ? 'snap' : k === 'group' ? 'grp' : k}_${++i}`;
}

function setup() {
  render(
    <WorkspaceStoreProvider store={ws}>
      <BoardStoreProvider store={board}>
        <NoticeProvider>
          <ProjectSidebar />
          <BoardTabs />
        </NoticeProvider>
      </BoardStoreProvider>
    </WorkspaceStoreProvider>,
  );
}

const tabs = () => screen.getAllByRole('tab').map((t) => t.textContent);
const openMenu = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));
/** S21: a board's actions menu opens from its tab (right-click / Shift+F10), not a second button. */
const openBoardMenu = (tab: string) =>
  fireEvent.contextMenu(screen.getByRole('tab', { name: tab }));
const pick = (name: string | RegExp) => fireEvent.click(screen.getByRole('menuitem', { name }));

beforeEach(() => {
  const s = createAppStores({ newId: ids() });
  board = s.boardStore;
  ws = s.workspaceStore;
});

describe('board tabs', () => {
  it('adds, renames (double-click), duplicates, reorders and deletes tabs', () => {
    setup();
    expect(tabs()).toEqual(['Board 1']);
    fireEvent.click(screen.getByRole('button', { name: 'New board' }));
    expect(tabs()).toEqual(['Board 1', 'Board 2']);
    expect(screen.getByRole('tab', { name: 'Board 2' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.doubleClick(screen.getByRole('tab', { name: 'Board 2' }));
    const input = screen.getByRole('textbox', { name: 'Board name' });
    fireEvent.change(input, { target: { value: 'Read path' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(tabs()).toEqual(['Board 1', 'Read path']);

    openBoardMenu('Board 1');
    pick('Duplicate');
    expect(tabs()).toEqual(['Board 1', 'Board 1 copy', 'Read path']);

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Read path' }), {
      key: 'F10',
      shiftKey: true,
    });
    pick('Move left');
    expect(tabs()).toEqual(['Board 1', 'Read path', 'Board 1 copy']);

    openBoardMenu('Board 1 copy');
    pick('Delete');
    // Two-step confirm.
    expect(tabs()).toHaveLength(3);
    pick(/Confirm|Delete "Board 1 copy"/);
    expect(tabs()).toEqual(['Board 1', 'Read path']);
  });

  it('Escape cancels a rename', () => {
    setup();
    fireEvent.doubleClick(screen.getByRole('tab', { name: 'Board 1' }));
    const input = screen.getByRole('textbox', { name: 'Board name' });
    fireEvent.change(input, { target: { value: 'Nope' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(tabs()).toEqual(['Board 1']);
  });

  it('the only tab cannot be deleted', () => {
    setup();
    openBoardMenu('Board 1');
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeDisabled();
  });
});

describe('project sidebar', () => {
  it('creates a project (name field opens), switches projects and shows their tabs', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'New project' }));
    const input = screen.getByRole('textbox', { name: 'Project name' });
    fireEvent.change(input, { target: { value: 'Chat app' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const list = within(screen.getByTestId('project-list'));
    expect(list.getByRole('button', { name: 'Chat app' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('tablist', { name: 'Boards in Chat app' })).toBeInTheDocument();

    fireEvent.click(list.getByRole('button', { name: 'My project' }));
    expect(screen.getByRole('tablist', { name: 'Boards in My project' })).toBeInTheDocument();

    openMenu(/Project Chat app actions/);
    pick('Move up');
    expect(ws.getState().data.projects.map((p) => p.name)).toEqual(['Chat app', 'My project']);

    openMenu(/Project Chat app actions/);
    pick('Delete');
    pick(/Delete "Chat app" and its 1 board/);
    expect(ws.getState().data.projects.map((p) => p.name)).toEqual(['My project']);
  });

  it('imports a board file into the open project and reports it', async () => {
    setup();
    const file = new File(
      [
        JSON.stringify({
          format: 'sysdraw',
          kind: 'board',
          schemaVersion: 1,
          settings: ws.getState().data.settings,
          projects: [],
          boards: [
            { ...ws.getState().data.boards[ws.getState().activeBoardId]!, name: 'From file' },
          ],
          layouts: {},
        }),
      ],
      'board.json',
      { type: 'application/json' },
    );
    await act(async () => {
      fireEvent.change(screen.getByTestId('import-input'), { target: { files: [file] } });
    });
    expect(await screen.findByText(/Imported board/)).toBeInTheDocument();
    expect(tabs()).toEqual(['Board 1', 'From file']);
  });

  it('shows import errors and changes nothing', async () => {
    setup();
    const file = new File(['{"format":"other"}'], 'x.json');
    await act(async () => {
      fireEvent.change(screen.getByTestId('import-input'), { target: { files: [file] } });
    });
    expect(await screen.findByText(/Import failed/)).toBeInTheDocument();
    expect(tabs()).toEqual(['Board 1']);
  });
});

describe('snapshots', () => {
  it('saves a snapshot and shows how many changes since', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Snapshots/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Snapshot name' }), {
      target: { value: 'Empty' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save snapshot' }));
    expect(screen.getByText('Empty')).toBeInTheDocument();
    expect(screen.getByTestId('snapshot-diff')).toHaveTextContent('Same as now');

    act(() => {
      board
        .getState()
        .dispatch({ type: 'addNode', defId: 'compute.app-server', position: { x: 0, y: 0 } });
    });
    expect(screen.getByTestId('snapshot-diff')).toHaveTextContent('1 change since (+1 −0 ~0)');
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(board.getState().doc.graph.nodes).toHaveLength(0);
    expect(screen.getByTestId('snapshot-diff')).toHaveTextContent('Same as now');
  });
});
