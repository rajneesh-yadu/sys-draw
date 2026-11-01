/** S16: security store, review panel (findings, fix button) and the toolbar toggle badge. */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BoardStoreProvider, createBoardStore } from '@/store';
import { registry } from '@/registry';
import { CanvasProvider } from '../CanvasProvider';
import { SecurityPanel } from './SecurityPanel';
import { createSecurityStore, severityCounts, type SecurityView } from './security-store';

const VIEW: SecurityView = {
  nodes: { node_db: { exposure: 'exposed', label: 'Internet-facing', reason: 'In a public zone' } },
  edges: {},
  groups: { grp_pub: 'Public' },
  findings: [
    {
      key: 'k1',
      ruleId: 'rule.db-internet-reachable',
      severity: 'critical',
      title: '"db" is in a public zone',
      message: 'Data stores belong in a private data subnet.',
      fix: 'Move it into a private data subnet.',
      fixLabel: 'Make "pub" a private data zone',
      targetIds: ['node_db'],
    },
    {
      key: 'k2',
      ruleId: 'rule.single-region-data',
      severity: 'warning',
      title: 'All databases are in us-east',
      message: 'Replicate.',
      targetIds: [],
    },
  ],
};

function renderPanel() {
  const security = createSecurityStore();
  const board = createBoardStore({ registry });
  render(
    <BoardStoreProvider store={board}>
      <CanvasProvider securityStore={security}>
        <SecurityPanel />
      </CanvasProvider>
    </BoardStoreProvider>,
  );
  return { security, board };
}

describe('security store', () => {
  it('fix() calls the registered handler and records the result', () => {
    const s = createSecurityStore();
    s.getState().fix('k');
    expect(s.getState().lastFix?.ok).toBe(false);
    const h = vi.fn(() => ({ ok: true as const, label: 'Do it' }));
    s.getState().setFixHandler(h);
    s.getState().fix('k1');
    expect(h).toHaveBeenCalledWith('k1');
    expect(s.getState().lastFix).toEqual({
      ok: true,
      message: 'Applied: Do it (undo with Ctrl/⌘+Z)',
    });
    s.getState().setOpen(false);
    expect(s.getState().lastFix).toBeNull();
  });

  it('counts findings by severity', () => {
    expect(severityCounts(VIEW.findings)).toEqual({ critical: 1, error: 0, warning: 1, info: 0 });
  });
});

describe('<SecurityPanel>', () => {
  it('is hidden until opened; lists findings worst first with a one-click fix', () => {
    const { security, board } = renderPanel();
    expect(screen.queryByRole('complementary', { name: 'Security review' })).toBeNull();
    const handler = vi.fn(() => ({ ok: true as const, label: 'Make "pub" a private data zone' }));
    act(() => {
      security.getState().setFixHandler(handler);
      security.getState().setView(VIEW);
      security.getState().setOpen(true);
    });
    expect(screen.getByTestId('security-counts').textContent).toBe('1 critical · 1 warning');
    const items = screen.getAllByTestId('security-finding');
    expect(items.map((i) => i.dataset.severity)).toEqual(['critical', 'warning']);
    expect(screen.getAllByRole('button', { name: /^Fix:/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Fix: Make "pub" a private data zone' }));
    expect(handler).toHaveBeenCalledWith('k1');
    expect(screen.getByRole('status').textContent).toContain('Applied');
    fireEvent.click(screen.getByRole('button', { name: '"db" is in a public zone' }));
    expect(board.getState().selection).toEqual(['node_db']);
    fireEvent.click(screen.getByRole('button', { name: 'Close security review' }));
    expect(security.getState().open).toBe(false);
  });
});
