/** S19: review store helpers, findings panel (filters, jump-to-node, apply fix) and the toggle. */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { registry } from '@/registry';
import { BoardStoreProvider, createBoardStore, simulationStore } from '@/store';
import { CanvasProvider } from '../CanvasProvider';
import { FindingsPanel } from './FindingsPanel';
import { categoryCounts, createReviewStore, jumpTarget, type ReviewView } from './review-store';

const VIEW: ReviewView = {
  findings: [
    {
      key: 'k1',
      ruleId: 'rule.spof',
      ruleTitle: 'Single point of failure',
      category: 'reliability',
      severity: 'error',
      title: '"API" is a single point of failure',
      message: 'One instance.',
      fix: 'Run 2 replicas.',
      fixLabel: 'Run 2 replicas of API',
      targetIds: ['node_api'],
      source: 'rule',
    },
    {
      key: 'k2',
      ruleId: 'rule.unbounded-retries',
      ruleTitle: 'Unbounded or un-backed-off retries',
      category: 'reliability',
      severity: 'warning',
      title: '5 retries on API → DB',
      message: 'Retry storm.',
      targetIds: ['edge_api_db'],
      source: 'rule',
    },
    {
      key: 'k3',
      ruleId: 'rule.no-autoscaling',
      ruleTitle: 'Fixed fleet for variable traffic',
      category: 'cost',
      severity: 'info',
      title: 'Fixed fleet',
      message: 'Idle at night.',
      targetIds: [],
      source: 'rule',
    },
  ],
  checked: 12,
  skipped: [
    {
      ruleId: 'rule.hot-partition',
      title: 'Hot partition',
      reason: 'no database component on the board',
    },
  ],
  hasResult: false,
};

function renderPanel() {
  const review = createReviewStore();
  const board = createBoardStore({ registry });
  render(
    <BoardStoreProvider store={board}>
      <CanvasProvider reviewStore={review}>
        <FindingsPanel />
      </CanvasProvider>
    </BoardStoreProvider>,
  );
  return { review, board };
}

describe('review store helpers', () => {
  it('counts per category and finds where to jump', () => {
    expect(categoryCounts(VIEW.findings)).toEqual({
      reliability: 2,
      performance: 0,
      scalability: 0,
      security: 0,
      cost: 1,
    });
    expect(jumpTarget(['node_a', 'edge_x', 'whatever'], [])).toEqual({
      select: ['node_a', 'edge_x'],
      focusNodeId: 'node_a',
    });
    expect(jumpTarget(['edge_x'], [{ id: 'edge_x', source: 'node_s' }])).toEqual({
      select: ['edge_x'],
      focusNodeId: 'node_s',
    });
    expect(jumpTarget([], []).focusNodeId).toBeUndefined();
  });

  it('fix() goes through the registered handler', () => {
    const s = createReviewStore();
    s.getState().fix('k');
    expect(s.getState().lastFix?.ok).toBe(false);
    const h = vi.fn(() => ({ ok: true as const, label: 'Do it' }));
    s.getState().setFixHandler(h);
    s.getState().fix('k1');
    expect(h).toHaveBeenCalledWith('k1');
    expect(s.getState().lastFix?.message).toBe('Applied: Do it (undo with Ctrl/⌘+Z)');
  });
});

describe('FindingsPanel', () => {
  it('is hidden until opened, then lists findings with counts and coverage', () => {
    const { review } = renderPanel();
    expect(screen.queryByRole('complementary', { name: 'Design review' })).toBeNull();
    act(() => {
      review.getState().setView(VIEW);
      review.getState().setOpen(true);
    });
    expect(screen.getByTestId('review-counts').textContent).toBe('1 error · 1 warning · 1 info');
    expect(screen.getAllByTestId('review-finding')).toHaveLength(3);
    expect(screen.getByTestId('review-coverage').textContent).toBe(
      '12 rules checked · 1 not applicable',
    );
    expect(screen.getByTestId('review-no-result')).toBeTruthy();
  });

  it('filters by category', () => {
    const { review } = renderPanel();
    act(() => {
      review.getState().setView(VIEW);
      review.getState().setOpen(true);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cost 1' }));
    const items = screen.getAllByTestId('review-finding');
    expect(items).toHaveLength(1);
    expect(items[0]!.getAttribute('data-category')).toBe('cost');
    fireEvent.click(screen.getByRole('button', { name: 'Performance 0' }));
    expect(screen.getByText('No findings in this category.')).toBeTruthy();
  });

  it('"Show on canvas" selects the targets and focuses the node (an edge focuses its source)', () => {
    const { review, board } = renderPanel();
    act(() => {
      board.getState().dispatch({
        type: 'addNode',
        defId: 'compute.app-server',
        position: { x: 0, y: 0 },
        id: 'node_api',
      });
      review.getState().setView(VIEW);
      review.getState().setOpen(true);
    });
    const spy = vi.spyOn(simulationStore.getState(), 'requestFocus');
    fireEvent.click(
      screen.getByRole('button', { name: 'Show on canvas: "API" is a single point of failure' }),
    );
    expect(board.getState().selection).toEqual(['node_api']);
    expect(spy).toHaveBeenCalledWith('node_api');
    // the info finding has no targets: no jump button
    const info = screen.getAllByTestId('review-finding')[2]!;
    expect(within(info).queryByRole('button', { name: /Show on canvas/ })).toBeNull();
    spy.mockRestore();
  });

  it('"Apply fix" only on findings with a safe fix, and reports the outcome', () => {
    const { review } = renderPanel();
    const h = vi.fn(() => ({ ok: true as const, label: 'Run 2 replicas of API' }));
    act(() => {
      review.getState().setView(VIEW);
      review.getState().setFixHandler(h);
      review.getState().setOpen(true);
    });
    expect(screen.getAllByRole('button', { name: /^Apply fix/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Apply fix: Run 2 replicas of API' }));
    expect(h).toHaveBeenCalledWith('k1');
    expect(screen.getByRole('status').textContent).toContain('Applied: Run 2 replicas of API');
  });
});
