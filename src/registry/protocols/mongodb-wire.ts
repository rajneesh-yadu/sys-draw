import { defineProtocol } from '../define';

export default defineProtocol({
  id: 'mongodb-wire',
  name: 'MongoDB wire protocol',
  osiLayer: 7,
  handshakeRtts: 2, // hello (with speculative auth) + saslContinue
  resumedHandshakeRtts: 2,
  perMessageOverheadBytes: 45, // 16 B message header + OP_MSG flags + command document fields
  multiplexing: false,
  reliable: true,
  ordered: true,
  encrypted: false,
  runsOn: ['tcp', 'tls13', 'tls12'],
  pattern: 'request-response',
  ports: { plain: [27017], secure: [27017] },
  handshakeSequence: [
    { from: 'client', message: 'hello', detail: 'driver info + speculative SCRAM start' },
    { from: 'server', message: 'hello reply', detail: 'topology, server-first SCRAM message' },
    { from: 'client', message: 'saslContinue' },
    { from: 'server', message: 'auth done' },
  ],
  docs: {
    summary:
      'BSON documents in OP_MSG frames. Drivers discover the replica set or sharded cluster with hello, keep a pool per server, and route reads by read preference.',
    handshakeSteps: [
      'hello: topology discovery (primary, secondaries, mongos)',
      'SCRAM authentication (speculative in the first hello)',
      'Monitoring connections re-check topology every few seconds',
    ],
    headerFields: [
      'Message header: length, request id, response to, opCode (OP_MSG)',
      'Command document: find/insert, $db, lsid (session), readConcern, writeConcern',
    ],
    securityNotes: [
      'Enable authentication and bind to private interfaces — open MongoDB instances are routinely wiped and ransomed.',
      'Use TLS and SCRAM-SHA-256 or x.509 client certificates.',
      'Operators like $where run JavaScript: block untrusted query objects.',
    ],
  },
});
