import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { boardStore, simulationStore } from '@/store';
import { AppShell } from './AppShell';

describe('AppShell', () => {
  it('renders all five shell regions', () => {
    render(<AppShell />);
    for (const id of ['topbar', 'palette', 'canvas', 'inspector', 'metrics']) {
      expect(screen.getByTestId(`region-${id}`)).toBeInTheDocument();
    }
    expect(screen.getByRole('heading', { name: 'SysDraw' })).toBeInTheDocument();
  });

  it('collapses and expands the metrics drawer', () => {
    render(<AppShell />);
    const toggle = screen.getByRole('button', { name: 'Hide' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Show' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('simulates the open board and shows per-flow p99 and node overlays (F7)', async () => {
    render(<AppShell />);
    const add = (defId: string, x: number) =>
      boardStore.getState().dispatch({ type: 'addNode', defId, position: { x, y: 0 } });
    act(() => {
      add('client.app', 0);
      add('compute.app-server', 300);
    });
    const [client, server] = boardStore.getState().doc.graph.nodes.map((n) => n.id) as [
      string,
      string,
    ];
    act(
      () =>
        void boardStore.getState().dispatch({ type: 'connect', source: client, target: server }),
    );
    // Overload the server: 400k users × 0.1 rps × peak 2 = 80k rps > 10k rps capacity.
    act(
      () =>
        void boardStore.getState().dispatch({
          type: 'updateScenario',
          patch: { usersByRegion: { 'north-america': 400_000 } },
        }),
    );
    await vi.waitFor(
      () => expect(simulationStore.getState().result?.perNode[server]).toBeDefined(),
      {
        timeout: 3000,
      },
    );
    expect(simulationStore.getState().result?.system.bottlenecks).toEqual([server]);
    const table = await screen.findByTestId('flow-table');
    expect(within(table).getByRole('button', { name: /^p99 of All traffic/ })).toBeInTheDocument();
    const nodes = await screen.findAllByTestId('component-node');
    expect(nodes.map((n) => n.getAttribute('data-level'))).toContain('hot');
  });
});
