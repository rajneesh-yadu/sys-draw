/** S14: the edge inspector's suggested stack and "Network" tab. */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
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

function setup(protocol?: string) {
  let i = 0;
  const store = createBoardStore({ registry, newId: (k) => `${k}_${++i}` });
  const d = store.getState().dispatch;
  d({ type: 'addNode', defId: 'client.app', position: { x: 0, y: 0 } });
  d({ type: 'addNode', defId: 'network.cdn', position: { x: 200, y: 0 } });
  d({ type: 'connect', source: 'node_1', target: 'node_2', ...(protocol ? { protocol } : {}) });
  const sim = createSimulationStore();
  render(
    <BoardStoreProvider store={store}>
      <SimulationStoreProvider store={sim}>
        <Inspector />
      </SimulationStoreProvider>
    </BoardStoreProvider>,
  );
  act(() => store.getState().setSelection(['edge_3']));
  const stack = () => store.getState().doc.graph.edges[0]!.protocolStack;
  return { store, sim, stack };
}

const openNetwork = () => fireEvent.click(screen.getByRole('tab', { name: 'Network' }));

describe('Inspector — edge network (S14)', () => {
  it('suggests HTTP/3 for browser → CDN and applies it in one step', () => {
    const { store, stack } = setup('http2');
    expect(stack()).toEqual(['tcp', 'tls13', 'http2']);
    expect(screen.getByText(/Suggested:/).parentElement).toHaveTextContent(
      'UDP › QUIC › HTTP/3 — Browsers and apps reach CDN edges over HTTP/3',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Use UDP › QUIC › HTTP/3' }));
    expect(stack()).toEqual(['udp', 'quic', 'http3']);
    expect(screen.queryByText(/Suggested:/)).toBeNull();
    expect(screen.getByText(/1 handshake RTT on a new connection/)).toBeInTheDocument();
    expect(store.getState().past.at(-1)?.label).toBe('Change protocol');
  });

  it('shows ports, encryption, OSI layers and the handshake sequence', () => {
    setup('http2');
    openNetwork();
    expect(screen.getByTestId('edge-encryption')).toHaveTextContent(
      'Encrypted in transit by TLS 1.3',
    );
    expect(screen.getByText('TCP 443 (HTTP/2 over TLS)')).toBeInTheDocument();
    const osi = within(screen.getByRole('list', { name: 'OSI layers' }))
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(osi).toEqual([
      '7 ApplicationHTTP/2',
      '6 PresentationTLS 1.3',
      '5 SessionSessions are handled by the protocols above and below',
      '4 TransportTCP',
      '3 NetworkIPv4 (implicit)',
      '2 Data linkEthernet (implicit)',
      '1 PhysicalOptical fibre (implicit)',
    ]);
    const seq = screen.getByRole('list', { name: 'Handshake sequence' });
    expect(seq).toHaveTextContent('TCP — 1 RTT');
    expect(seq).toHaveTextContent('client → server SYN');
    expect(seq).toHaveTextContent('TLS 1.3 — 1 RTT (after 1 RTT)');
    fireEvent.click(screen.getByRole('radio', { name: 'Resumed session' }));
    expect(screen.getByRole('list', { name: 'Handshake sequence' })).not.toHaveTextContent('TLS');
    fireEvent.click(screen.getByRole('radio', { name: 'Warm (reused)' }));
    expect(screen.getByText(/No handshake: the request goes out at once/)).toBeInTheDocument();
    // HTTP/2 over TCP: head-of-line note
    expect(screen.getByRole('list', { name: 'Protocol warnings' })).toHaveTextContent(
      'one lost packet stalls all of them',
    );
  });

  it('turns round trips into ms from the last run: HTTP/2 3 RTT cold vs HTTP/3 2 RTT', () => {
    const { sim, store } = setup('http2');
    openNetwork();
    const table = () => screen.getByRole('table', { name: 'Request latency by connection state' });
    expect(within(table()).getAllByText('—')).toHaveLength(3);
    act(() =>
      sim.setState({
        result: { perEdge: { edge_3: { rttMs: 40 } }, findings: [] } as unknown as SimResult,
      }),
    );
    const row = (name: string) => within(table()).getByText(name).closest('tr')!;
    expect(row('New connection')).toHaveTextContent('3 RTTs120 ms');
    expect(row('Resumed session')).toHaveTextContent('2 RTTs80 ms');
    expect(row('Warm (reused)')).toHaveTextContent('1 RTT40 ms');
    act(
      () =>
        void store.getState().dispatch({
          type: 'updateEdge',
          edgeId: 'edge_3',
          protocolStack: ['udp', 'quic', 'http3'],
        }),
    );
    expect(row('New connection')).toHaveTextContent('2 RTTs80 ms');
    expect(row('Resumed session')).toHaveTextContent('1 RTT40 ms');
    expect(screen.getByText('UDP 443 (HTTP/3 over TLS)')).toBeInTheDocument();
  });

  it('warns about plaintext from a client over the internet', () => {
    const { store } = setup('http2');
    act(
      () =>
        void store
          .getState()
          .dispatch({ type: 'updateEdge', edgeId: 'edge_3', protocolStack: ['tcp', 'http2'] }),
    );
    openNetwork();
    expect(screen.getByTestId('edge-encryption')).toHaveTextContent('Plaintext');
    expect(screen.getByRole('list', { name: 'Protocol warnings' })).toHaveTextContent(
      'Warning: Plaintext over the public internet',
    );
  });
});
