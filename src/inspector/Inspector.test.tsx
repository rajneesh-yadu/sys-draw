import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { registry } from '@/registry';
import { BoardStoreProvider, createBoardStore, type BoardStore } from '@/store';
import { Inspector } from './Inspector';

function counterIds() {
  let i = 0;
  return (kind: string) => `${{ node: 'node', edge: 'edge', group: 'grp' }[kind] ?? kind}_${++i}`;
}

function setup() {
  const store = createBoardStore({ registry, newId: counterIds() as never });
  const d = store.getState().dispatch;
  d({ type: 'addNode', defId: 'client.app', position: { x: 0, y: 0 } });
  d({ type: 'addNode', defId: 'compute.app-server', position: { x: 200, y: 0 } });
  d({ type: 'connect', source: 'node_1', target: 'node_2' });
  d({ type: 'group', kind: 'vpc', memberIds: ['node_2'] });
  store.setState({ past: [], future: [] });
  render(
    <BoardStoreProvider store={store}>
      <Inspector />
    </BoardStoreProvider>,
  );
  return store;
}

const select = (store: BoardStore, ids: string[]) => act(() => store.getState().setSelection(ids));
/** Type into a draft input and commit with Enter (one edit = one command). */
function typeCommit(el: HTMLElement, value: string) {
  fireEvent.change(el, { target: { value } });
  fireEvent.keyDown(el, { key: 'Enter' });
}
const history = (store: BoardStore) => store.getState().past.map((h) => h.label);

describe('Inspector — board scenario', () => {
  it('edits a scenario field as one undoable command and blocks invalid values with a reason', () => {
    const store = setup();
    const peak = screen.getByLabelText(/Peak multiplier/);
    typeCommit(peak, '4');
    expect(store.getState().doc.scenario.peakMultiplier).toBe(4);
    expect(history(store)).toEqual(['Change scenario']);

    typeCommit(screen.getByLabelText(/Peak multiplier/), '0');
    expect(screen.getByRole('alert')).toHaveTextContent('Must be > 0');
    expect(screen.getByLabelText(/Peak multiplier/)).toHaveAttribute('aria-invalid', 'true');
    expect(store.getState().doc.scenario.peakMultiplier).toBe(4);
    expect(history(store)).toHaveLength(1);

    act(() => void store.getState().undo());
    expect(screen.getByLabelText(/Peak multiplier/)).toHaveValue(2);
  });

  it('edits users by region (record) and nested payload sizes', () => {
    const store = setup();
    fireEvent.click(screen.getByRole('button', { name: '+ Add entry' }));
    expect(Object.keys(store.getState().doc.scenario.usersByRegion)).toEqual([
      'north-america',
      'key-2',
    ]);
    typeCommit(screen.getByDisplayValue('key-2'), 'europe');
    expect(store.getState().doc.scenario.usersByRegion).toEqual({
      'north-america': 1000,
      europe: 1000,
    });
    typeCommit(screen.getByDisplayValue('europe'), 'Not A Region');
    expect(screen.getByRole('alert').textContent).toMatch(/region id/);
    typeCommit(screen.getByLabelText(/^Request/), '2048');
    expect(store.getState().doc.scenario.payloadBytes.req).toBe(2048);
  });

  it('shows the provider docs on the Docs tab', () => {
    setup();
    fireEvent.click(screen.getByRole('tab', { name: 'Docs' }));
    expect(screen.getByRole('article', { name: 'Generic cloud docs' })).toBeInTheDocument();
  });
});

describe('Inspector — node', () => {
  it('renders config from the schema in Basic and Advanced sections', () => {
    const store = setup();
    select(store, ['node_2']);
    expect(screen.getByText('App Server')).toBeInTheDocument();
    expect(screen.getByLabelText('Runtime')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Stateless' })).toBeChecked();
    const adv = screen.getByText('Advanced (4)').closest('details')!;
    expect(within(adv).getByLabelText(/Request timeout/)).toHaveValue(10000);
    expect(within(adv).getAllByText('(ms)').length).toBeGreaterThan(0);
  });

  it('each field edit is one undoable command; invalid values are blocked with a reason', () => {
    const store = setup();
    select(store, ['node_2']);
    const node = () => store.getState().doc.graph.nodes[1]!;

    fireEvent.change(screen.getByLabelText('Runtime'), { target: { value: 'go' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Stateless' }));
    typeCommit(screen.getByLabelText(/Worker threads/), '0');
    expect(screen.getByRole('alert')).toHaveTextContent('Must be ≥ 1');
    typeCommit(screen.getByLabelText(/Worker threads/), '64');
    typeCommit(screen.getByLabelText(/^Label/), 'api');
    typeCommit(screen.getByLabelText(/^Replicas/), '3');
    fireEvent.change(screen.getByLabelText('Instance type'), { target: { value: 'large' } });

    expect(node()).toMatchObject({
      label: 'api',
      config: { runtime: 'go', stateless: false, workerThreads: 64 },
      scaling: { replicas: 3, instanceType: 'large' },
    });
    expect(history(store)).toEqual([
      'Change config',
      'Change config',
      'Change config',
      'Rename node',
      'Change scaling',
      'Change scaling',
    ]);
    act(() => void store.getState().undo());
    expect(node().scaling.instanceType).toBe('small');
    expect(screen.getByLabelText('Instance type')).toHaveValue('small');
  });

  it('turns autoscale on with defaults and validates max ≥ min', () => {
    const store = setup();
    select(store, ['node_2']);
    fireEvent.click(screen.getByRole('switch', { name: 'Autoscale' }));
    expect(store.getState().doc.graph.nodes[1]!.scaling.autoscale).toEqual({
      min: 1,
      max: 4,
      targetUtil: 0.6,
      warmupSec: 60,
    });
    typeCommit(screen.getByLabelText(/Max replicas/), '0');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    typeCommit(screen.getByLabelText(/Min replicas/), '6');
    expect(screen.getByRole('alert')).toHaveTextContent('max must be ≥ min');
    expect(store.getState().doc.graph.nodes[1]!.scaling.autoscale!.min).toBe(1);
    fireEvent.click(screen.getByRole('switch', { name: 'Autoscale' }));
    expect(store.getState().doc.graph.nodes[1]!.scaling).not.toHaveProperty('autoscale');
  });

  it('shows the component definition docs', () => {
    const store = setup();
    select(store, ['node_2']);
    fireEvent.click(screen.getByRole('tab', { name: 'Docs' }));
    const docs = screen.getByRole('article', { name: 'App Server docs' });
    expect(within(docs).getByText(/A server \(VM or container\)/)).toBeInTheDocument();
    expect(within(docs).getByText('Interview tips')).toBeInTheDocument();
  });
});

describe('Inspector — edge', () => {
  it('picks a protocol stack filtered by ports and runsOn', () => {
    const store = setup();
    select(store, ['edge_3']);
    const picker = screen.getByLabelText(/Stack/);
    const opts = within(picker)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(opts[0]).toBe('TCP › TLS 1.3 › HTTP/2');
    expect(opts).toContain('TCP › HTTP/1.1');
    expect(opts.every((o) => !o!.includes('gRPC') || o!.includes('HTTP/2 › gRPC'))).toBe(true);
    expect(screen.getByText(/2 handshake RTTs/)).toBeInTheDocument();
    fireEvent.change(picker, { target: { value: 'tcp/http1' } });
    expect(store.getState().doc.graph.edges[0]!.protocolStack).toEqual(['tcp', 'http1']);
    expect(screen.getByText(/plaintext/)).toBeInTheDocument();
    expect(history(store)).toEqual(['Change protocol']);
  });

  it('edits sync, timeout and retries; clears timeout; rejects bad retries', () => {
    const store = setup();
    select(store, ['edge_3']);
    const edge = () => store.getState().doc.graph.edges[0]!;
    fireEvent.click(screen.getByRole('switch', { name: /Synchronous/ }));
    typeCommit(screen.getByLabelText(/^Timeout/), '250');
    typeCommit(screen.getByLabelText(/^Retries/), '-1');
    expect(screen.getByRole('alert')).toHaveTextContent('Must be ≥ 0');
    typeCommit(screen.getByLabelText(/^Retries/), '2');
    expect(edge()).toMatchObject({ sync: false, config: { timeoutMs: 250, retries: 2 } });
    typeCommit(screen.getByLabelText(/^Timeout/), '');
    expect(edge().config).toEqual({ retries: 2 });
    expect(history(store)).toHaveLength(4);
  });

  it('shows docs for each protocol in the stack, top first', () => {
    const store = setup();
    select(store, ['edge_3']);
    fireEvent.click(screen.getByRole('tab', { name: 'Docs' }));
    const names = screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'));
    expect(names).toEqual(['HTTP/2 docs', 'TLS 1.3 docs', 'TCP docs']);
  });
});

describe('Inspector — group', () => {
  it('renames, sets region and adds a firewall rule with validation', () => {
    const store = setup();
    select(store, ['grp_4']);
    const group = () => store.getState().doc.graph.groups[0]!;
    typeCommit(screen.getByLabelText(/^Label/), 'Prod');
    fireEvent.change(screen.getByLabelText(/^Region/), { target: { value: 'eu-west' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Security' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add firewall rule' }));
    expect(group()).toMatchObject({
      label: 'Prod',
      regionId: 'eu-west',
      security: {
        public: false,
        firewallRules: [{ fromPort: 443, toPort: 443, peer: 'internet' }],
      },
    });
    typeCommit(screen.getByLabelText(/^To port/), '80');
    expect(screen.getByRole('alert')).toHaveTextContent('toPort must be ≥ fromPort');
    expect(group().security!.firewallRules[0]!.toPort).toBe(443);
    fireEvent.click(screen.getByRole('button', { name: 'Remove firewall rule 1' }));
    expect(group().security!.firewallRules).toEqual([]);
    fireEvent.change(screen.getByLabelText(/^Region/), { target: { value: '' } });
    expect(group()).not.toHaveProperty('regionId');
  });

  it('says how many items are selected for a multi-selection', () => {
    const store = setup();
    select(store, ['node_1', 'node_2']);
    expect(screen.getByText(/2 items selected/)).toBeInTheDocument();
  });
});
