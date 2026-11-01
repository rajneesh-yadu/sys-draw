import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { boardStore } from '@/store';
import { createUiStore } from '../ui/ui-store';
import { AppShell } from './AppShell';

const ui = () => createUiStore({ storage: null });

afterEach(() => {
  document.documentElement.classList.remove('dark');
});

describe('AppShell — S21 polish', () => {
  it('Ctrl+K opens the command palette; typing + Enter adds the component', () => {
    const store = ui();
    render(<AppShell simulate={false} uiStore={store} />);
    const before = boardStore.getState().doc.graph.nodes.length;
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const dialog = screen.getByRole('dialog', { name: 'Command palette' });
    const input = within(dialog).getByRole('combobox');
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: 'add redis' } });
    expect(within(dialog).getAllByRole('option')[0]).toHaveTextContent('Add Redis');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
    const nodes = boardStore.getState().doc.graph.nodes;
    expect(nodes).toHaveLength(before + 1);
    expect(nodes.at(-1)?.defId).toBe('cache.redis');
  });

  it('arrow keys move the active option; Escape closes', () => {
    render(<AppShell simulate={false} uiStore={ui()} />);
    fireEvent.click(screen.getByTestId('open-command-palette'));
    const dialog = within(screen.getByRole('dialog', { name: 'Command palette' }));
    const input = dialog.getByRole('combobox');
    const options = dialog.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(dialog.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    expect(input.getAttribute('aria-activedescendant')).toBe(dialog.getAllByRole('option')[1]?.id);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
  });

  it('"?" opens the keyboard shortcut sheet (not while typing)', () => {
    render(<AppShell simulate={false} uiStore={ui()} />);
    const search = screen.getByRole('searchbox', { name: 'Search components' });
    fireEvent.keyDown(search, { key: '?', shiftKey: true });
    expect(screen.queryByTestId('shortcut-sheet')).toBeNull();
    fireEvent.keyDown(window, { key: '?', shiftKey: true });
    const sheet = screen.getByTestId('shortcut-sheet');
    expect(within(sheet).getByText('Undo')).toBeInTheDocument();
    expect(within(sheet).getByText('Ctrl/⌘+K')).toBeInTheDocument();
    fireEvent.keyDown(sheet, { key: 'Escape' });
    expect(screen.queryByTestId('shortcut-sheet')).toBeNull();
  });

  it('collapses Projects and Palette to a left rail and back', () => {
    const store = ui();
    render(<AppShell simulate={false} uiStore={store} />);
    expect(screen.queryByTestId('left-rail')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hide Palette' }));
    expect(screen.getByTestId('region-palette')).not.toBeVisible();
    const rail = screen.getByTestId('left-rail');
    expect(within(rail).getByRole('button', { name: 'Show Palette' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide Projects' }));
    expect(screen.getByTestId('region-projects')).not.toBeVisible();
    // Ctrl+B with both collapsed expands both.
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(screen.getByTestId('region-projects')).toBeVisible();
    expect(screen.getByTestId('region-palette')).toBeVisible();
    expect(screen.queryByTestId('left-rail')).toBeNull();
    expect(store.getState().prefs).toMatchObject({
      projectsCollapsed: false,
      paletteCollapsed: false,
    });
  });

  it('the theme button cycles the theme and sets the dark class on <html>', () => {
    const store = createUiStore({ storage: null, initial: { theme: 'light' } });
    render(<AppShell simulate={false} uiStore={store} />);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    fireEvent.click(screen.getByTestId('theme-toggle'));
    expect(store.getState().prefs.theme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(screen.getByTestId('theme-toggle')).toHaveAccessibleName(/Theme: Dark/);
  });

  it('the metrics drawer size is kept in the UI preferences', () => {
    const store = ui();
    render(<AppShell simulate={false} uiStore={store} />);
    fireEvent.click(screen.getByRole('button', { name: 'Maximise metrics' }));
    expect(store.getState().prefs.metricsMaximized).toBe(true);
    act(() => store.getState().setMetricsMaximized(false));
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize metrics panel' }), {
      key: 'PageUp',
    });
    expect(store.getState().prefs.metricsHeightPx).toBe(360);
  });

  it('an empty board explains how to start', () => {
    act(() => {
      const ids = boardStore.getState().doc.graph.nodes.map((n) => n.id);
      if (ids.length) boardStore.getState().dispatch({ type: 'delete', ids });
    });
    render(<AppShell simulate={false} uiStore={ui()} />);
    expect(screen.getByTestId('canvas-empty')).toHaveTextContent('This board is empty');
    expect(screen.getByTestId('metrics-empty')).toHaveTextContent('Add a client and a service');
  });
});
