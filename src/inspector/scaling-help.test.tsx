/** S23: per-component help for the shared Scaling fields (replicas, instance type, autoscale). */
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { registry, type EntryByKind } from '@/registry';
import { BoardStoreProvider, createBoardStore } from '@/store';
import { Inspector } from './Inspector';
import { GENERIC_SCALING_HELP, scalingHelpFor } from './panels/scaling-help';

const def = (id: string) => registry.require(id, 'component');
const declared = (id: string) =>
  (def(id).configSchema.meta() as { scalingHelp: Record<string, string> }).scalingHelp;

describe('scalingHelpFor', () => {
  it('uses the component’s own text, generic text for what it leaves out', () => {
    const pg = scalingHelpFor(def('database.postgres'));
    expect(pg.replicas).toBe(declared('database.postgres').replicas);
    expect(pg.replicas).toMatch(/read replica/);
    const app = scalingHelpFor(def('compute.app-server'));
    expect(app.replicas).toMatch(/Interchangeable copies/);
    expect(app.instanceType).toBe(GENERIC_SCALING_HELP.instanceType);
  });

  it('falls back to the generic text without (valid) metadata', () => {
    expect(scalingHelpFor(undefined)).toEqual(GENERIC_SCALING_HELP);
    const bare = { configSchema: z.object({}) } as unknown as EntryByKind['component'];
    expect(scalingHelpFor(bare)).toEqual(GENERIC_SCALING_HELP);
    const odd = {
      configSchema: z.object({}).meta({ scalingHelp: { replicas: 42, autoscale: ' ' } }),
    } as unknown as EntryByKind['component'];
    expect(scalingHelpFor(odd)).toEqual(GENERIC_SCALING_HELP);
  });
});

describe('Inspector — scaling field help', () => {
  function renderNode(defId: string) {
    let i = 0;
    const store = createBoardStore({ registry, newId: (() => `node_${++i}`) as never });
    store.getState().dispatch({ type: 'addNode', defId, position: { x: 0, y: 0 } });
    const view = render(
      <BoardStoreProvider store={store}>
        <Inspector />
      </BoardStoreProvider>,
    );
    act(() => store.getState().setSelection(['node_1']));
    return view;
  }

  it.each([
    ['database.postgres', /streaming read replica/],
    ['compute.app-server', /Interchangeable copies of this one service/],
    ['database.cassandra', /Nodes in the cluster/],
    ['compute.serverless-function', /^Ignored/],
  ])('%s: the Replicas input is described by its component-specific help', (defId, re) => {
    const view = renderNode(defId);
    const input = screen.getByRole('spinbutton', { name: /^Replicas/ });
    const ids = (input.getAttribute('aria-describedby') ?? '').split(' ');
    const help = ids.map((id) => view.container.querySelector(`#${CSS.escape(id)}`)?.textContent);
    expect(help.join(' ')).toMatch(re);
    expect(screen.queryByText(GENERIC_SCALING_HELP.replicas)).toBeNull();
    view.unmount();
  });

  it('component-specific instance-type help replaces the generic text', () => {
    renderNode('compute.kubernetes');
    expect(screen.getByText(/Worker node size/)).toBeInTheDocument();
    expect(screen.queryByText(GENERIC_SCALING_HELP.instanceType)).toBeNull();
  });
});
