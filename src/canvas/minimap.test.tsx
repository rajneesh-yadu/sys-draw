import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { registry } from '@/registry';
import { BoardStoreProvider, createBoardStore } from '@/store';
import { BoardCanvas } from './BoardCanvas';
import { CanvasProvider } from './CanvasProvider';

function setup(canvas: React.ReactNode = <BoardCanvas />) {
  const store = createBoardStore({ registry });
  render(
    <BoardStoreProvider store={store}>
      <CanvasProvider>
        <div style={{ width: 800, height: 600 }}>{canvas}</div>
      </CanvasProvider>
    </BoardStoreProvider>,
  );
}

describe('BoardCanvas minimap (S24)', () => {
  it('is shown by default; the controls button hides it and a "Show minimap" button brings it back', () => {
    setup();
    expect(screen.getByTestId('rf__minimap')).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Hide minimap' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(toggle);
    expect(screen.queryByTestId('rf__minimap')).toBeNull();
    // Two ways back, both named for what they do: the controls toggle and a button in its place.
    expect(screen.getAllByRole('button', { name: 'Show minimap' })).toHaveLength(2);
    expect(screen.getByTestId('minimap-toggle')).toHaveAttribute('aria-pressed', 'false');
    // The restore button where the minimap was.
    const show = screen.getByTestId('minimap-show');
    expect(show).toHaveTextContent('Show minimap');
    fireEvent.click(show);
    expect(screen.getByTestId('rf__minimap')).toBeInTheDocument();
    expect(screen.queryByTestId('minimap-show')).toBeNull();
  });

  it('moves focus to the controls toggle after "Show minimap" (that button goes away)', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame'] });
    try {
      setup();
      fireEvent.click(screen.getByTestId('minimap-toggle'));
      fireEvent.click(screen.getByTestId('minimap-show'));
      act(() => vi.advanceTimersToNextFrame());
      expect(screen.getByTestId('minimap-toggle')).toHaveFocus();
    } finally {
      vi.useRealTimers();
    }
  });

  it('can be controlled by the owner (who persists the choice)', () => {
    const seen: boolean[] = [];
    function Host() {
      const [visible, setVisible] = useState(false);
      return (
        <BoardCanvas
          minimap={visible}
          onMinimapChange={(v) => {
            seen.push(v);
            setVisible(v);
          }}
        />
      );
    }
    setup(<Host />);
    expect(screen.queryByTestId('rf__minimap')).toBeNull();
    fireEvent.click(screen.getByTestId('minimap-show'));
    expect(seen).toEqual([true]);
    expect(screen.getByTestId('rf__minimap')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('minimap-toggle'));
    expect(seen).toEqual([true, false]);
  });
});
