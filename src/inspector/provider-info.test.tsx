import { act, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { registry } from '@/registry';
import {
  BoardStoreProvider,
  createBoardStore,
  createSimulationStore,
  SimulationStoreProvider,
  type SimResult,
} from '@/store';
import { Inspector } from './Inspector';

function setup(providerId: 'generic' | 'aws' | 'gcp', defId: string, config = {}) {
  const store = createBoardStore({ registry, newId: (k) => `${k === 'group' ? 'grp' : k}_1` });
  const d = store.getState().dispatch;
  d({ type: 'setProvider', providerId });
  d({ type: 'addNode', defId, position: { x: 0, y: 0 } });
  if (Object.keys(config).length > 0) d({ type: 'updateConfig', nodeId: 'node_1', config });
  const sim = createSimulationStore();
  render(
    <BoardStoreProvider store={store}>
      <SimulationStoreProvider store={sim}>
        <Inspector />
      </SimulationStoreProvider>
    </BoardStoreProvider>,
  );
  act(() => store.getState().setSelection(['node_1']));
  return { store, sim };
}

describe('Inspector — provider info (S12)', () => {
  it('lists the provider limits and marks the ones the simulation found exceeded', () => {
    const { sim } = setup('aws', 'compute.serverless-function', { concurrencyLimit: 2000 });
    const info = screen.getByTestId('provider-info');
    expect(info).toHaveTextContent('as of 2026-10-01');
    const limits = within(info).getByRole('list', { name: 'AWS limits' });
    const item = within(limits)
      .getByText(/Concurrent executions per region/)
      .closest('li')!;
    expect(item).toHaveTextContent('1,000 executions');
    expect(item).toHaveTextContent('Default quota (can be raised)');
    expect(item).not.toHaveTextContent('Exceeded');

    act(() =>
      sim.setState({
        result: {
          findings: [
            {
              ruleId: 'engine.limits',
              severity: 'warning',
              title: 'AWS limit: Concurrent executions per region (default quota)',
              message: '…',
              targetIds: ['node_1'],
            },
          ],
        } as unknown as SimResult,
      }),
    );
    expect(item).toHaveTextContent('Exceeded');
    expect(item).toHaveAttribute('data-exceeded', 'true');
  });

  it('shows the provider instance names and prices in the size picker', () => {
    setup('aws', 'database.sql');
    expect(
      screen.getByRole('option', { name: /small — db\.m6i\.large .* \$0\.171\/h/ }),
    ).toBeTruthy();
  });

  it('warns when the provider has no equivalent; nothing extra on generic', () => {
    setup('aws', 'database.spanner');
    expect(within(screen.getByTestId('provider-info')).getByRole('alert')).toHaveTextContent(
      'Global SQL (Spanner) has no AWS equivalent',
    );
  });

  it('shows nothing on the generic provider', () => {
    setup('generic', 'compute.app-server');
    expect(screen.queryByTestId('provider-info')).toBeNull();
  });
});
