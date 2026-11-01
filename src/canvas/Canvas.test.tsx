import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { registry } from '@/registry';
import { BoardStoreProvider, createBoardStore } from '@/store';
import { BoardCanvas } from './BoardCanvas';
import { CanvasProvider } from './CanvasProvider';
import { Palette } from './Palette';

function setup() {
  const store = createBoardStore({ registry });
  render(
    <BoardStoreProvider store={store}>
      <CanvasProvider>
        <Palette />
        <div style={{ width: 800, height: 600 }}>
          <BoardCanvas />
        </div>
      </CanvasProvider>
    </BoardStoreProvider>,
  );
  return store;
}

describe('Palette + BoardCanvas', () => {
  it('lists registry components and adds one on click, rendering it with a replica badge', async () => {
    const store = setup();
    const palette = screen.getByTestId('palette');
    const btn = within(palette).getByRole('button', { name: /Load Balancer/ });
    fireEvent.click(btn);
    expect(store.getState().doc.graph.nodes.map((n) => n.defId)).toEqual(['network.load-balancer']);
    expect(await screen.findByText('load-balancer-1')).toBeInTheDocument();
    expect(screen.getByLabelText('1 replicas')).toBeInTheDocument();
  });

  it('filters the palette by search', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Search components'), { target: { value: 'redis' } });
    const items = within(screen.getByTestId('palette')).getAllByRole('button');
    expect(items.map((b) => b.getAttribute('data-def-id'))).toEqual([
      'cache.in-memory',
      'cache.redis',
    ]);
  });

  it('undoes and redoes with keyboard shortcuts', async () => {
    const store = setup();
    fireEvent.click(
      within(screen.getByTestId('palette')).getByRole('button', { name: /App Server/ }),
    );
    expect(store.getState().doc.graph.nodes).toHaveLength(1);
    act(() => void fireEvent.keyDown(window, { key: 'z', ctrlKey: true }));
    expect(store.getState().doc.graph.nodes).toHaveLength(0);
    act(() => void fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true }));
    expect(store.getState().doc.graph.nodes).toHaveLength(1);
  });

  it('wraps the selection in a container from the palette and shows a group node', async () => {
    const store = setup();
    fireEvent.click(
      within(screen.getByTestId('palette')).getByRole('button', { name: /App Server/ }),
    );
    const id = store.getState().doc.graph.nodes[0]!.id;
    act(() => store.getState().setSelection([id]));
    fireEvent.click(within(screen.getByTestId('palette')).getByRole('button', { name: 'VPC' }));
    expect(store.getState().doc.graph.nodes[0]!.groupId).toBe(
      store.getState().doc.graph.groups[0]!.id,
    );
    expect(await screen.findByTestId('group-node')).toBeInTheDocument();
  });
});
