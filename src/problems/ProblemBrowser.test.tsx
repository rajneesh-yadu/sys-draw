/** S17: problem browser (filter → start) and the in-board brief (hints, reference, interview). */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BoardStoreProvider,
  WorkspaceStoreProvider,
  createAppStores,
  type BoardStore,
  type WorkspaceStore,
} from '@/store';
import { ProblemBriefButton, ProblemsButton } from './index';

let board: BoardStore;
let ws: WorkspaceStore;
const onNotice = vi.fn();

beforeEach(() => {
  let i = 0;
  const s = createAppStores({ newId: (k) => `${k === 'group' ? 'grp' : k}_${++i}` });
  board = s.boardStore;
  ws = s.workspaceStore;
  onNotice.mockReset();
  render(
    <WorkspaceStoreProvider store={ws}>
      <BoardStoreProvider store={board}>
        <ProblemsButton onNotice={onNotice} />
        <ProblemBriefButton onNotice={onNotice} />
      </BoardStoreProvider>
    </WorkspaceStoreProvider>,
  );
});

const openBrowser = () => {
  fireEvent.click(screen.getByTestId('open-problems'));
  return screen.getByTestId('problem-browser');
};
const listed = (dlg: HTMLElement) =>
  within(within(dlg).getByRole('list', { name: 'Problems' }))
    .getAllByRole('button')
    .map((b) => b.getAttribute('data-testid')?.replace('problem-item-problem.', ''));

describe('problem browser', () => {
  it('lists all problems (ten + the S22/S23/S24 sample boards) and filters by level, tag and company style', () => {
    const dlg = openBrowser();
    expect(dlg).toHaveAttribute('role', 'dialog');
    expect(listed(dlg)).toHaveLength(13);
    expect(within(dlg).getByTestId('problem-count')).toHaveTextContent('13 of 13 problems');

    fireEvent.change(within(dlg).getByLabelText('Level'), { target: { value: '1' } });
    expect(listed(dlg)).toEqual(['rate-limiter', 'url-shortener']);

    fireEvent.change(within(dlg).getByLabelText('Level'), { target: { value: '' } });
    fireEvent.change(within(dlg).getByLabelText('Company style'), { target: { value: 'meta' } });
    expect(listed(dlg)).toEqual(['chat', 'news-feed', 'instagram']);

    fireEvent.change(within(dlg).getByLabelText('Tag'), { target: { value: 'cdn' } });
    expect(listed(dlg)).toEqual(['instagram']);
    expect(within(dlg).getByTestId('problem-count')).toHaveTextContent('1 of 13 problems');

    fireEvent.change(within(dlg).getByLabelText('Tag'), { target: { value: 'video' } });
    expect(within(dlg).getByText('No problem matches these filters.')).toBeInTheDocument();
  });

  it('shows requirements, scale and rubric for the selected problem', () => {
    const dlg = openBrowser();
    fireEvent.click(within(dlg).getByTestId('problem-item-problem.url-shortener'));
    const pane = within(dlg).getByTestId('problem-pane');
    expect(within(pane).getByRole('heading', { name: 'URL shortener' })).toBeInTheDocument();
    expect(within(pane).getByTestId('problem-scale')).toHaveTextContent('50M');
    expect(within(pane).getByTestId('problem-scale')).toHaveTextContent('100 : 1 reads : writes');
    expect(within(pane).getByTestId('problem-scale')).toHaveTextContent('≈ 30.6k requests/s');
    expect(within(pane).getByTestId('problem-rubric')).toHaveTextContent('p99 < 200 ms (Redirect)');
    // S18: the URL shortener ships a broken variant, so Debug can be chosen.
    expect(within(pane).getByRole('radio', { name: /Debug/ })).toBeEnabled();
  });

  it('starts a problem on a new board in the chosen mode and closes', () => {
    const dlg = openBrowser();
    fireEvent.click(within(dlg).getByTestId('problem-item-problem.chat'));
    const pane = within(dlg).getByTestId('problem-pane');
    fireEvent.click(within(pane).getByRole('radio', { name: /Interview/ }));
    expect(within(pane).getByRole('combobox', { name: /Start from/ })).toBeDisabled();
    fireEvent.click(within(pane).getByRole('button', { name: /Start problem/ }));

    expect(screen.queryByTestId('problem-browser')).not.toBeInTheDocument();
    const st = ws.getState();
    const b = st.data.boards[st.activeBoardId]!;
    expect(b).toMatchObject({ mode: 'interview', problemId: 'problem.chat' });
    expect(b.graph.nodes).toEqual([]);
    expect(onNotice).toHaveBeenCalledWith({
      kind: 'info',
      text: 'Started "Chat (WhatsApp / Discord)" in Interview mode on a new board.',
    });
  });

  it('can start from the reference solution', () => {
    const dlg = openBrowser();
    fireEvent.click(within(dlg).getByTestId('problem-item-problem.youtube'));
    const pane = within(dlg).getByTestId('problem-pane');
    fireEvent.click(within(pane).getByRole('radio', { name: /Chaos/ }));
    expect(within(pane).getByRole('combobox', { name: /Start from/ })).toHaveValue('reference');
    fireEvent.click(within(pane).getByRole('button', { name: /Start problem/ }));
    expect(board.getState().doc.graph.nodes.length).toBeGreaterThan(5);
    const st = ws.getState();
    expect(st.data.boards[st.activeBoardId]!.mode).toBe('chaos');
  });

  it('closes with Escape', () => {
    const dlg = openBrowser();
    fireEvent.keyDown(dlg, { key: 'Escape' });
    expect(screen.queryByTestId('problem-browser')).not.toBeInTheDocument();
  });
});

describe('problem brief', () => {
  const start = (problem: string, mode: RegExp) => {
    const dlg = openBrowser();
    fireEvent.click(within(dlg).getByTestId(`problem-item-problem.${problem}`));
    const pane = within(dlg).getByTestId('problem-pane');
    fireEvent.click(within(pane).getByRole('radio', { name: mode }));
    fireEvent.click(within(pane).getByRole('button', { name: /Start problem/ }));
  };

  it('is absent on a free board', () => {
    expect(screen.queryByTestId('open-problem-brief')).not.toBeInTheDocument();
  });

  it('reveals hints one at a time and loads the reference after confirming', () => {
    start('url-shortener', /Guided/);
    fireEvent.click(screen.getByTestId('open-problem-brief'));
    const brief = screen.getByTestId('problem-brief');
    expect(within(brief).getByText(/Guided mode/)).toBeInTheDocument();
    fireEvent.click(within(brief).getByRole('button', { name: 'Show first hint' }));
    expect(within(brief).getByTestId('hints').children).toHaveLength(1);
    fireEvent.click(within(brief).getByRole('button', { name: 'Show hint 2' }));
    expect(within(brief).getByTestId('hints').children).toHaveLength(2);

    // Empty board: loads at once.
    fireEvent.click(within(brief).getByRole('button', { name: /Load reference solution/ }));
    expect(screen.queryByTestId('problem-brief')).not.toBeInTheDocument();
    expect(board.getState().doc.graph.nodes.map((n) => n.id)).toContain('node_cache');
    expect(onNotice).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'info', text: expect.stringMatching(/Undo with Ctrl\+Z/) }),
    );

    // Non-empty board: asks first.
    fireEvent.click(screen.getByTestId('open-problem-brief'));
    const again = screen.getByTestId('problem-brief');
    fireEvent.click(within(again).getByRole('button', { name: /Load reference solution/ }));
    expect(within(again).getByRole('alert')).toHaveTextContent(/replaces everything/);
    fireEvent.click(within(again).getByRole('button', { name: 'Cancel' }));
    expect(within(again).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('hides hints and the reference in Interview mode', () => {
    start('payment-system', /Interview/);
    fireEvent.click(screen.getByTestId('open-problem-brief'));
    const brief = screen.getByTestId('problem-brief');
    expect(within(brief).getByTestId('hints-hidden')).toBeInTheDocument();
    expect(within(brief).queryByRole('button', { name: /hint/i })).not.toBeInTheDocument();
    expect(within(brief).queryByRole('button', { name: /reference/i })).not.toBeInTheDocument();
    expect(within(brief).getByTestId('problem-details')).toHaveTextContent('Never charge twice');
  });
});
