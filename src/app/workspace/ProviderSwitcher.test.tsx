import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { IdKind } from '@/core';
import {
  BoardStoreProvider,
  WorkspaceStoreProvider,
  createAppStores,
  type BoardStore,
  type WorkspaceStore,
} from '@/store';
import { NoticeLine, NoticeProvider } from './notices';
import { ProviderSwitcher } from './ProviderSwitcher';

let board: BoardStore;
let ws: WorkspaceStore;

function ids() {
  let i = 0;
  return (k: IdKind) => `${k === 'group' ? 'grp' : k}_${++i}`;
}

function setup() {
  render(
    <WorkspaceStoreProvider store={ws}>
      <BoardStoreProvider store={board}>
        <NoticeProvider>
          <ProviderSwitcher />
          <NoticeLine />
        </NoticeProvider>
      </BoardStoreProvider>
    </WorkspaceStoreProvider>,
  );
}
const select = () => screen.getByRole('combobox', { name: 'Cloud provider' });
const dispatch = (cmd: Parameters<ReturnType<BoardStore['getState']>['dispatch']>[0]) =>
  board.getState().dispatch(cmd);

beforeEach(() => {
  const s = createAppStores({ newId: ids() });
  board = s.boardStore;
  ws = s.workspaceStore;
});

describe('provider switcher (S12)', () => {
  it('switches an empty board at once and saves the provider on the board', () => {
    setup();
    expect(select()).toHaveValue('generic');
    expect(
      within(select())
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Generic', 'AWS', 'GCP', 'Azure']);
    fireEvent.change(select(), { target: { value: 'azure' } });
    expect(board.getState().doc.providerId).toBe('azure');
    const st = ws.getState();
    expect(st.data.boards[st.activeBoardId]?.providerId).toBe('azure');
    expect(screen.getByTestId('workspace-notice')).toHaveTextContent('Switched to Azure.');
  });

  it('reviews renames, regions and missing equivalents before switching; undo restores', () => {
    dispatch({ type: 'setProvider', providerId: 'gcp' });
    dispatch({ type: 'addNode', defId: 'storage.object', position: { x: 0, y: 0 } });
    dispatch({ type: 'addNode', defId: 'database.spanner', position: { x: 200, y: 0 } });
    const [obj, sp] = board.getState().doc.graph.nodes.map((n) => n.id);
    dispatch({ type: 'group', kind: 'region', memberIds: [obj!, sp!] });
    const grp = board.getState().doc.graph.groups[0]!.id;
    dispatch({ type: 'updateGroup', groupId: grp, regionId: 'us-central1' });
    setup();

    fireEvent.change(select(), { target: { value: 'aws' } });
    const dialog = screen.getByRole('dialog', { name: 'Switch to AWS' });
    expect(board.getState().doc.providerId).toBe('gcp'); // not yet
    expect(within(dialog).getByTestId('switch-renames')).toHaveTextContent('Cloud Storage → S3');
    expect(within(dialog).getByTestId('switch-regions')).toHaveTextContent(
      'us-central1 → us-east-2 (nearest',
    );
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Spanner has no AWS equivalent');
    expect(dialog).toHaveTextContent('as of 2026-10-01');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(select()).toHaveValue('gcp');

    fireEvent.change(select(), { target: { value: 'aws' } });
    fireEvent.click(screen.getByRole('button', { name: 'Switch to AWS' }));
    expect(board.getState().doc.providerId).toBe('aws');
    expect(board.getState().doc.graph.groups[0]?.regionId).toBe('us-east-2');
    expect(screen.getByTestId('workspace-notice')).toHaveTextContent(
      'Switched to AWS. 1 component has no equivalent.',
    );
    board.getState().undo();
    expect(board.getState().doc.providerId).toBe('gcp');
    expect(board.getState().doc.graph.groups[0]?.regionId).toBe('us-central1');
  });
});
