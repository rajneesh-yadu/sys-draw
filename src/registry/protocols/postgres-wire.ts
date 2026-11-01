import { defineProtocol } from '../define';

export default defineProtocol({
  id: 'postgres-wire',
  name: 'PostgreSQL wire protocol',
  osiLayer: 7,
  handshakeRtts: 3, // StartupMessage, then SCRAM-SHA-256 (two exchanges)
  resumedHandshakeRtts: 3,
  perMessageOverheadBytes: 60, // Query/Bind/Execute + RowDescription, CommandComplete, ReadyForQuery
  multiplexing: false, // one query at a time per connection
  reliable: true,
  ordered: true,
  encrypted: false,
  runsOn: ['tcp', 'tls13', 'tls12'],
  pattern: 'request-response',
  ports: { plain: [5432], secure: [5432] },
  handshakeSequence: [
    { from: 'client', message: 'StartupMessage', detail: 'user, database' },
    { from: 'server', message: 'AuthenticationSASL', detail: 'SCRAM-SHA-256' },
    { from: 'client', message: 'SASLInitialResponse' },
    { from: 'server', message: 'SASLContinue' },
    { from: 'client', message: 'SASLResponse' },
    { from: 'server', message: 'SASLFinal, AuthenticationOk, ReadyForQuery' },
  ],
  docs: {
    summary:
      'How clients talk to PostgreSQL: one query at a time per connection, and each connection is a server process. Setting one up costs several round trips plus server memory, which is why apps use connection pools (or PgBouncer).',
    handshakeSteps: [
      'Classic TLS: SSLRequest → "S" (1 extra RTT) before the TLS handshake; PostgreSQL 17 can start TLS directly',
      'StartupMessage → AuthenticationSASL',
      'Two SCRAM-SHA-256 exchanges → AuthenticationOk, ReadyForQuery',
    ],
    headerFields: [
      'Message type byte + length',
      'Simple Query (Q) or extended Parse/Bind/Execute/Sync',
      'RowDescription, DataRow, CommandComplete, ReadyForQuery (transaction status)',
    ],
    securityNotes: [
      'Set sslmode=verify-full in clients; "require" encrypts but does not check the server identity.',
      'Use SCRAM, never md5/trust auth; restrict pg_hba.conf to the app subnets.',
      'Parameterised queries (Bind) prevent SQL injection; string-built Simple Queries do not.',
    ],
  },
});
