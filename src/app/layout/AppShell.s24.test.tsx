import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createUiStore } from '../ui/ui-store';
import { AppShell } from './AppShell';

const ui = () => createUiStore({ storage: null });

describe('AppShell — S24 workspace space', () => {
  it('collapses the Inspector to a right rail and back, keeping keyboard focus', () => {
    const store = ui();
    render(<AppShell simulate={false} uiStore={store} />);
    expect(screen.queryByTestId('right-rail')).toBeNull();
    const hide = screen.getByRole('button', { name: 'Hide Inspector' });
    hide.focus();
    fireEvent.click(hide);
    expect(screen.getByTestId('region-inspector')).not.toBeVisible();
    expect(store.getState().prefs.inspectorCollapsed).toBe(true);
    const rail = screen.getByTestId('right-rail');
    const show = within(rail).getByRole('button', { name: 'Show Inspector' });
    expect(show).toHaveAttribute('aria-controls', 'region-inspector');
    expect(show).toHaveAttribute('aria-expanded', 'false');
    // The clicked button is hidden with its panel; focus moves to the button that restores it.
    expect(show).toHaveFocus();
    fireEvent.click(show);
    expect(screen.getByTestId('region-inspector')).toBeVisible();
    expect(screen.queryByTestId('right-rail')).toBeNull();
    expect(screen.getByRole('button', { name: 'Hide Inspector' })).toHaveFocus();
  });

  it('a collapsed Inspector stays collapsed on the next load', () => {
    const store = createUiStore({ storage: null, initial: { inspectorCollapsed: true } });
    render(<AppShell simulate={false} uiStore={store} />);
    expect(screen.getByTestId('region-inspector')).not.toBeVisible();
    expect(screen.getByRole('button', { name: 'Show Inspector' })).toBeInTheDocument();
    // The left-panel shortcut doesn't touch it.
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(screen.getByTestId('region-inspector')).not.toBeVisible();
  });

  it('the minimap choice is kept in the UI preferences', () => {
    const store = ui();
    render(<AppShell simulate={false} uiStore={store} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide minimap' }));
    expect(store.getState().prefs.minimapVisible).toBe(false);
    expect(screen.getByTestId('minimap-show')).toBeInTheDocument();
    act(() => store.getState().setMinimapVisible(true));
    expect(screen.queryByTestId('minimap-show')).toBeNull();
  });

  it('the request trace width is kept in the UI preferences', () => {
    const store = ui();
    render(<AppShell simulate={false} uiStore={store} />);
    fireEvent.click(screen.getByRole('button', { name: 'Trace request' }));
    const sep = screen.getByRole('separator', { name: 'Resize request trace' });
    fireEvent.keyDown(sep, { key: 'PageUp' });
    expect(store.getState().prefs.traceWidthPx).toBe(504);
    fireEvent.click(screen.getByRole('button', { name: 'Expand request trace' }));
    expect(store.getState().prefs.traceExpanded).toBe(true);
    expect(screen.getByTestId('trace-panel').style.width).toBe('70%');
  });
});
