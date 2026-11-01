import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { registry } from '@/registry';
import { BoardStoreProvider, createBoardStore, type NodeInstance } from '@/store';
import { Inspector } from './Inspector';
import { familySizes, instanceFamily, scaleActions } from './panels/scale-actions';

const def = (id: string) => registry.require(id, 'component');
function nodeOf(defId: string, scaling: Partial<NodeInstance['scaling']> = {}, config = {}) {
  const d = def(defId);
  return {
    id: 'node_1',
    defId,
    label: 'n',
    position: { x: 0, y: 0 },
    config: { ...d.defaults, ...config },
    scaling: { replicas: 1, instanceType: d.instanceTypes[0]!.id, ...scaling },
  } as NodeInstance;
}
const byId = (actions: ReturnType<typeof scaleActions>) =>
  Object.fromEntries(actions.map((a) => [a.id, a]));

describe('instance families', () => {
  it('groups sizes by id prefix, smallest first', () => {
    expect(instanceFamily('mem-large')).toBe('mem');
    expect(instanceFamily('small')).toBe('');
    expect(familySizes(def('database.sql'), 'medium').map((t) => t.id)).toEqual([
      'small',
      'medium',
      'large',
      'xlarge',
    ]);
    expect(familySizes(def('database.sql'), 'mem-large').map((t) => t.id)).toEqual([
      'mem-medium',
      'mem-large',
      'mem-xlarge',
    ]);
  });
});

describe('scaleActions', () => {
  it('app server: replica and size actions; no read replicas or shards (with reasons)', () => {
    const a = byId(scaleActions(def('compute.app-server'), nodeOf('compute.app-server')));
    expect(a.replica?.command).toEqual({
      type: 'updateNode',
      nodeId: 'node_1',
      scaling: { replicas: 2 },
    });
    expect(a['size-up']?.command).toEqual({
      type: 'updateNode',
      nodeId: 'node_1',
      scaling: { instanceType: 'medium' },
    });
    expect(a['size-down']?.disabledReason).toMatch(/smallest/);
    expect(a['read-replica']?.disabledReason).toMatch(/no read replicas/);
    expect(a.shard?.disabledReason).toMatch(/not sharded/);
  });

  it('SQL: read replica and shard ×2 edit the role-tagged config fields', () => {
    const a = byId(
      scaleActions(def('database.sql'), nodeOf('database.sql', {}, { readReplicas: 2 })),
    );
    expect(a['read-replica']?.command).toEqual({
      type: 'updateConfig',
      nodeId: 'node_1',
      config: { readReplicas: 3 },
    });
    expect(a.shard?.command).toEqual({
      type: 'updateConfig',
      nodeId: 'node_1',
      config: { shards: 2 },
    });
    const full = byId(
      scaleActions(def('database.sql'), nodeOf('database.sql', {}, { readReplicas: 15 })),
    );
    expect(full['read-replica']?.command).toBeUndefined();
    expect(full['read-replica']?.disabledReason).toMatch(/≤ 15|15/);
  });

  it('NoSQL partitions and cache shards double; largest size cannot size up', () => {
    const n = byId(
      scaleActions(def('database.nosql'), nodeOf('database.nosql', { instanceType: 'xlarge' })),
    );
    expect(n.shard?.command).toMatchObject({ config: { partitions: 16 } });
    expect(n['size-up']?.disabledReason).toMatch(/largest/);
    expect(n['size-down']?.command).toMatchObject({ scaling: { instanceType: 'large' } });
    const c = byId(scaleActions(def('cache.in-memory'), nodeOf('cache.in-memory')));
    expect(c.shard?.command).toMatchObject({ config: { shards: 2 } });
    expect(c['size-up']?.command).toMatchObject({ scaling: { instanceType: 'mem-large' } });
  });

  it('autoscaling owns the replica count; clients have no actions; one-size components', () => {
    const auto = byId(
      scaleActions(
        def('compute.app-server'),
        nodeOf('compute.app-server', {
          autoscale: { min: 2, max: 8, targetUtil: 0.6, warmupSec: 60 },
        }),
      ),
    );
    expect(auto.replica?.disabledReason).toMatch(/Autoscaling/);
    expect(scaleActions(def('client.app'), nodeOf('client.app'))).toEqual([]);
    const lb = byId(scaleActions(def('network.load-balancer'), nodeOf('network.load-balancer')));
    expect(lb['size-up']?.disabledReason).toMatch(/one size/);
  });
});

describe('Inspector — Scale quick actions', () => {
  it('each click is one undoable command; disabled actions say why', () => {
    let i = 0;
    const store = createBoardStore({ registry, newId: (() => `node_${++i}`) as never });
    store.getState().dispatch({ type: 'addNode', defId: 'database.sql', position: { x: 0, y: 0 } });
    store.setState({ past: [], future: [] });
    render(
      <BoardStoreProvider store={store}>
        <Inspector />
      </BoardStoreProvider>,
    );
    act(() => store.getState().setSelection(['node_1']));
    const node = () => store.getState().doc.graph.nodes[0]!;

    fireEvent.click(screen.getByRole('button', { name: '+1 replica' }));
    expect(node().scaling.replicas).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'Size up' }));
    expect(node().scaling.instanceType).toBe('medium');
    fireEvent.click(screen.getByRole('button', { name: 'Add read replica' }));
    expect(node().config.readReplicas).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Shard ×2' }));
    expect(node().config.shards).toBe(2);
    expect(store.getState().past.map((h) => h.label)).toEqual([
      'Change scaling',
      'Change scaling',
      'Change config',
      'Change config',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Size down' }));
    fireEvent.click(screen.getByRole('button', { name: 'Size down' }));
    expect(node().scaling.instanceType).toBe('small');
    const down = screen.getByRole('button', { name: 'Size down' });
    expect(down).toBeDisabled();
    expect(down).toHaveAccessibleDescription(/smallest/);
    act(() => void store.getState().undo());
    expect(node().scaling.instanceType).toBe('medium');
  });
});
