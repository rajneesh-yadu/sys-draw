import { describe, expect, it } from 'vitest';
import { registry } from '@/registry';
import { createBoardStore } from './board-store';

describe('batch: create a group and change it in the same step (S16)', () => {
  it('updateGroup works on a group added earlier in the batch, and undoes as one step', () => {
    const store = createBoardStore({ registry });
    const r = store.getState().dispatch({
      type: 'batch',
      label: 'Make a data subnet',
      commands: [
        { type: 'group', kind: 'subnet', memberIds: [], id: 'grp_d', label: 'Data' },
        {
          type: 'updateGroup',
          groupId: 'grp_d',
          security: { public: false, zone: 'data', firewallRules: [] },
        },
      ],
    });
    expect(r.ok).toBe(true);
    expect(store.getState().doc.graph.groups[0]?.security?.zone).toBe('data');
    store.getState().undo();
    expect(store.getState().doc.graph.groups).toEqual([]);
  });
});
