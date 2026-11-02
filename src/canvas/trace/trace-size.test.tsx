import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { registry } from '@/registry';
import { BoardStoreProvider, createBoardStore } from '@/store';
import { CanvasProvider } from '../CanvasProvider';
import { TracePanel } from './TracePanel';
import { createTraceStore } from './trace-store';
import {
  clampTraceWidth,
  DEFAULT_TRACE_SIZE,
  resizeTraceByKey,
  traceMinWidthCss,
  traceWidthCss,
  TRACE_DEFAULT_WIDTH,
  TRACE_KEY_STEP,
  TRACE_MAX_WIDTH,
  TRACE_MIN_WIDTH,
  TRACE_PAGE_STEP,
  type TraceSize,
} from './trace-size';

describe('trace size helpers (S24)', () => {
  it('clamps the width and treats junk as the default', () => {
    expect(clampTraceWidth(10)).toBe(TRACE_MIN_WIDTH);
    expect(clampTraceWidth(99_999)).toBe(TRACE_MAX_WIDTH);
    expect(clampTraceWidth(500.6)).toBe(501);
    expect(clampTraceWidth(Number.NaN)).toBe(TRACE_DEFAULT_WIDTH);
    expect(clampTraceWidth(Number.POSITIVE_INFINITY)).toBe(TRACE_DEFAULT_WIDTH);
  });

  it('never lets the panel take more than 70 % of the row', () => {
    expect(traceWidthCss({ widthPx: 600, expanded: false })).toBe('min(600px, 70%)');
    expect(traceWidthCss({ widthPx: 5, expanded: false })).toBe(`min(${TRACE_MIN_WIDTH}px, 70%)`);
    expect(traceWidthCss({ widthPx: 600, expanded: true })).toBe('70%');
    expect(traceMinWidthCss()).toBe(`min(${TRACE_MIN_WIDTH}px, 70%)`);
  });

  it('resizes with the keyboard like a window splitter (← widens a right-hand panel)', () => {
    const s: TraceSize = { widthPx: 500, expanded: false };
    expect(resizeTraceByKey('ArrowLeft', s)).toEqual({
      widthPx: 500 + TRACE_KEY_STEP,
      expanded: false,
    });
    expect(resizeTraceByKey('ArrowRight', s)).toEqual({
      widthPx: 500 - TRACE_KEY_STEP,
      expanded: false,
    });
    expect(resizeTraceByKey('PageUp', s)?.widthPx).toBe(500 + TRACE_PAGE_STEP);
    expect(resizeTraceByKey('PageDown', s)?.widthPx).toBe(500 - TRACE_PAGE_STEP);
    expect(resizeTraceByKey('Home', s)).toEqual({ widthPx: TRACE_MIN_WIDTH, expanded: false });
    expect(resizeTraceByKey('End', s)).toEqual({ widthPx: 500, expanded: true });
    expect(resizeTraceByKey('Enter', { widthPx: 500, expanded: true })).toEqual({
      widthPx: 500,
      expanded: false,
    });
    expect(
      resizeTraceByKey('ArrowRight', { widthPx: TRACE_MIN_WIDTH, expanded: false })?.widthPx,
    ).toBe(TRACE_MIN_WIDTH);
    // Resizing from expanded drops back to a pixel width.
    expect(resizeTraceByKey('ArrowLeft', { widthPx: 500, expanded: true })?.expanded).toBe(false);
    expect(resizeTraceByKey('a', s)).toBeNull();
  });
});

function renderPanel(controlled: boolean) {
  const board = createBoardStore({ registry });
  const trace = createTraceStore();
  trace.getState().setOpen(true);
  const changes: TraceSize[] = [];
  function Host() {
    const [size, setSize] = useState<TraceSize>(DEFAULT_TRACE_SIZE);
    return (
      <TracePanel
        size={size}
        onSizeChange={(s) => {
          changes.push(s);
          setSize(s);
        }}
      />
    );
  }
  render(
    <BoardStoreProvider store={board}>
      <CanvasProvider traceStore={trace}>
        <div style={{ display: 'flex', width: 1200, height: 600 }}>
          {controlled ? <Host /> : <TracePanel />}
        </div>
      </CanvasProvider>
    </BoardStoreProvider>,
  );
  return { changes, trace };
}

describe('TracePanel resizing (S24)', () => {
  it('has a focusable vertical separator with its current width', () => {
    renderPanel(false);
    const sep = screen.getByRole('separator', { name: 'Resize request trace' });
    expect(sep).toHaveAttribute('aria-orientation', 'vertical');
    expect(sep).toHaveAttribute('tabindex', '0');
    expect(sep).toHaveAttribute('aria-valuenow', String(TRACE_DEFAULT_WIDTH));
    expect(sep).toHaveAttribute('aria-valuemin', String(TRACE_MIN_WIDTH));
    expect(screen.getByTestId('trace-panel').style.width).toBe(
      `min(${TRACE_DEFAULT_WIDTH}px, 70%)`,
    );
  });

  it('keyboard: ← widens, Home goes to the minimum, Enter expands (uncontrolled)', () => {
    renderPanel(false);
    const sep = screen.getByTestId('trace-resize');
    // jsdom measures 0 px, so the panel resizes from its stored width.
    fireEvent.keyDown(sep, { key: 'ArrowLeft' });
    expect(sep).toHaveAttribute('aria-valuenow', String(TRACE_DEFAULT_WIDTH + TRACE_KEY_STEP));
    fireEvent.keyDown(sep, { key: 'Home' });
    expect(sep).toHaveAttribute('aria-valuenow', String(TRACE_MIN_WIDTH));
    fireEvent.keyDown(sep, { key: 'Enter' });
    expect(sep).toHaveAttribute('aria-valuetext', 'Expanded');
    expect(screen.getByTestId('trace-panel')).toHaveAttribute('data-expanded', 'true');
    expect(screen.getByTestId('trace-panel').style.width).toBe('70%');
  });

  it('pointer drag on the left edge reports a clamped width to the owner', () => {
    const { changes } = renderPanel(true);
    const sep = screen.getByTestId('trace-resize');
    fireEvent.pointerDown(sep, { button: 0, clientX: 800, pointerId: 1 });
    fireEvent.pointerMove(sep, { clientX: 600, pointerId: 1 }); // 200 px to the left = wider
    expect(changes.at(-1)).toEqual({ widthPx: TRACE_DEFAULT_WIDTH + 200, expanded: false });
    fireEvent.pointerMove(sep, { clientX: 5000, pointerId: 1 }); // far right = minimum
    expect(changes.at(-1)?.widthPx).toBe(TRACE_MIN_WIDTH);
    fireEvent.pointerUp(sep, { pointerId: 1 });
    const n = changes.length;
    fireEvent.pointerMove(sep, { clientX: 100, pointerId: 1 }); // not dragging any more
    expect(changes).toHaveLength(n);
  });

  it('the Expand button toggles and says which way it goes', () => {
    const { changes } = renderPanel(true);
    fireEvent.click(screen.getByRole('button', { name: 'Expand request trace' }));
    expect(changes.at(-1)).toEqual({ widthPx: TRACE_DEFAULT_WIDTH, expanded: true });
    const restore = screen.getByRole('button', { name: 'Restore request trace width' });
    expect(restore).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(restore);
    expect(changes.at(-1)?.expanded).toBe(false);
    // Double-click on the edge toggles too.
    fireEvent.doubleClick(screen.getByTestId('trace-resize'));
    expect(changes.at(-1)?.expanded).toBe(true);
  });

  it('closing and reopening keeps the size the owner holds', () => {
    const { trace } = renderPanel(true);
    fireEvent.keyDown(screen.getByTestId('trace-resize'), { key: 'PageUp' });
    act(() => trace.getState().setOpen(false));
    expect(screen.queryByTestId('trace-panel')).toBeNull();
    act(() => trace.getState().setOpen(true));
    expect(screen.getByTestId('trace-resize')).toHaveAttribute(
      'aria-valuenow',
      String(TRACE_DEFAULT_WIDTH + TRACE_PAGE_STEP),
    );
  });
});
