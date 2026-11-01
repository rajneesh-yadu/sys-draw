import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import {
  BoardStoreProvider,
  createAppStores,
  createSimulationStore,
  SimulationStoreProvider,
} from '@/store';
import {
  clampDrawerHeight,
  drawerBodyHeight,
  DRAWER_DEFAULT_HEIGHT,
  DRAWER_KEY_STEP,
  DRAWER_MIN_HEIGHT,
  DRAWER_PAGE_STEP,
  resizeByKey,
  type DrawerSize,
} from './drawer-size';
import { MetricsDrawer } from './MetricsDrawer';

describe('drawer size helpers (S21)', () => {
  it('clamps and caps the height to the window', () => {
    expect(clampDrawerHeight(50)).toBe(DRAWER_MIN_HEIGHT);
    expect(clampDrawerHeight(Number.POSITIVE_INFINITY)).toBe(DRAWER_DEFAULT_HEIGHT);
    expect(drawerBodyHeight({ heightPx: 300, maximized: false })).toBe(
      'min(300px, calc(100dvh - 17rem))',
    );
    expect(drawerBodyHeight({ heightPx: 300, maximized: true })).toBe('calc(100dvh - 17rem)');
  });

  it('resizes from the keyboard like a window splitter', () => {
    const s: DrawerSize = { heightPx: 240, maximized: false };
    expect(resizeByKey('ArrowUp', s)).toEqual({
      heightPx: 240 + DRAWER_KEY_STEP,
      maximized: false,
    });
    expect(resizeByKey('ArrowDown', s)).toEqual({
      heightPx: 240 - DRAWER_KEY_STEP,
      maximized: false,
    });
    expect(resizeByKey('PageUp', s)).toEqual({
      heightPx: 240 + DRAWER_PAGE_STEP,
      maximized: false,
    });
    expect(resizeByKey('PageDown', s)?.heightPx).toBe(DRAWER_MIN_HEIGHT);
    expect(resizeByKey('Home', s)).toEqual({ heightPx: DRAWER_MIN_HEIGHT, maximized: false });
    expect(resizeByKey('End', s)).toEqual({ heightPx: 240, maximized: true });
    expect(resizeByKey('Enter', { heightPx: 240, maximized: true })?.maximized).toBe(false);
    expect(resizeByKey('a', s)).toBeNull();
    // Arrow keys leave the maximised state.
    expect(resizeByKey('ArrowUp', { heightPx: 240, maximized: true })?.maximized).toBe(false);
  });
});

function mount(controlled: boolean) {
  const { boardStore } = createAppStores();
  const sim = createSimulationStore();
  const seen: DrawerSize[] = [];
  function Host() {
    const [size, setSize] = useState<DrawerSize>({ heightPx: 300, maximized: false });
    return (
      <MetricsDrawer
        {...(controlled ? { size } : {})}
        onSizeChange={(s) => {
          seen.push(s);
          setSize(s);
        }}
      />
    );
  }
  render(
    <BoardStoreProvider store={boardStore}>
      <SimulationStoreProvider store={sim}>
        <Host />
      </SimulationStoreProvider>
    </BoardStoreProvider>,
  );
  return { seen };
}

describe('MetricsDrawer resize and maximise (S21)', () => {
  it('resizes with the keyboard on the separator and reports the size', () => {
    const { seen } = mount(true);
    const handle = screen.getByRole('separator', { name: 'Resize metrics panel' });
    expect(handle).toHaveAttribute('aria-valuenow', '300');
    expect(screen.getByTestId('metrics-body').style.height).toContain('300px');
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    // jsdom has no layout: the drawer falls back to the stored height (300) + one step.
    expect(seen.at(-1)).toEqual({ heightPx: 324, maximized: false });
    expect(handle).toHaveAttribute('aria-valuenow', '324');
  });

  it('maximises and restores from the header button', () => {
    mount(true);
    const max = screen.getByRole('button', { name: 'Maximise metrics' });
    fireEvent.click(max);
    expect(screen.getByTestId('metrics-body')).toHaveAttribute('data-maximized', 'true');
    expect(screen.getByRole('button', { name: 'Restore metrics size' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Restore metrics size' }));
    expect(screen.getByTestId('metrics-body')).not.toHaveAttribute('data-maximized');
  });

  it('maximising a hidden drawer opens it; uncontrolled it keeps its own size', () => {
    mount(false);
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.queryByTestId('metrics-body')).toBeNull();
    expect(screen.queryByRole('separator')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Maximise metrics' }));
    expect(screen.getByTestId('metrics-body')).toHaveAttribute('data-maximized', 'true');
  });

  it('dragging the top edge up grows the drawer', () => {
    const { seen } = mount(true);
    const handle = screen.getByRole('separator', { name: 'Resize metrics panel' });
    fireEvent.pointerDown(handle, { button: 0, clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 400, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 400, pointerId: 1 });
    expect(seen.at(-1)).toEqual({ heightPx: 400, maximized: false });
  });
});
