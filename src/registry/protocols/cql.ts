import { defineProtocol } from '../define';

export default defineProtocol({
  id: 'cql',
  name: 'CQL native protocol',
  osiLayer: 7,
  handshakeRtts: 2, // STARTUP → AUTHENTICATE, AUTH_RESPONSE → AUTH_SUCCESS
  resumedHandshakeRtts: 2,
  perMessageOverheadBytes: 30, // 9 B frame header + query/prepared id + consistency + result metadata
  multiplexing: true, // up to 32k concurrent stream ids per connection
  reliable: true,
  ordered: true,
  encrypted: false,
  runsOn: ['tcp', 'tls13', 'tls12'],
  pattern: 'multiplexed',
  ports: { plain: [9042], secure: [9142] },
  handshakeSequence: [
    { from: 'client', message: 'STARTUP', detail: 'CQL version, compression' },
    { from: 'server', message: 'AUTHENTICATE' },
    { from: 'client', message: 'AUTH_RESPONSE' },
    { from: 'server', message: 'AUTH_SUCCESS' },
  ],
  docs: {
    summary:
      "Cassandra's binary protocol. Each connection multiplexes many requests by stream id; token-aware drivers send each query straight to a replica that owns the partition key.",
    handshakeSteps: [
      'OPTIONS / SUPPORTED (optional)',
      'STARTUP → READY or AUTHENTICATE',
      'SASL AUTH_RESPONSE → AUTH_SUCCESS',
      'Drivers then PREPARE statements and REGISTER for topology events',
    ],
    headerFields: [
      'Version, flags, stream id, opcode, length',
      'Consistency level per query (ONE, QUORUM, LOCAL_QUORUM)',
      'Paging state',
    ],
    securityNotes: [
      'Change the default cassandra/cassandra superuser and enable authentication.',
      'Enable client-to-node and node-to-node encryption across AZs and regions.',
    ],
  },
});
