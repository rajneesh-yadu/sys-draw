import { defineProtocol } from '../define';

export default defineProtocol({
  id: 'websocket',
  name: 'WebSocket',
  osiLayer: 7,
  handshakeRtts: 1,
  perMessageOverheadBytes: 6, // 2 B frame header + 4 B client mask for small messages
  multiplexing: false,
  reliable: true,
  ordered: true,
  encrypted: false,
  runsOn: ['tcp', 'tls13', 'tls12'],
  pattern: 'bidirectional',
  ports: { plain: [80], secure: [443] },
  handshakeSequence: [
    { from: 'client', message: 'GET Upgrade: websocket', detail: 'Sec-WebSocket-Key' },
    { from: 'server', message: '101 Switching Protocols', detail: 'Sec-WebSocket-Accept' },
  ],
  docs: {
    summary:
      'Long-lived, two-way message channel opened by an HTTP upgrade. The server can push messages at any time — used for chat, live feeds and multiplayer.',
    handshakeSteps: [
      'Client → server: HTTP/1.1 GET with Upgrade: websocket and Sec-WebSocket-Key',
      'Server → client: 101 Switching Protocols with Sec-WebSocket-Accept (1 RTT)',
      'Both sides then exchange small frames on the same connection until one sends a Close frame',
    ],
    headerFields: [
      'Upgrade handshake: Upgrade, Connection, Sec-WebSocket-Key / Accept, Sec-WebSocket-Protocol, Origin',
      'Frame: FIN bit, opcode (text, binary, ping, pong, close), mask bit, payload length',
    ],
    securityNotes: [
      'Use wss:// (WebSocket over TLS); ws:// exposes every message.',
      'Check the Origin header on upgrade to prevent cross-site WebSocket hijacking.',
      'Each open socket holds server memory and a load-balancer connection — plan capacity per connection, not per request.',
      'Authenticate on connect and re-check on long sessions; tokens can expire while the socket stays open.',
    ],
  },
});
