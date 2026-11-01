import { defineProtocol } from '../define';

export default defineProtocol({
  id: 'mysql-wire',
  name: 'MySQL wire protocol',
  osiLayer: 7,
  handshakeRtts: 2, // server greeting, HandshakeResponse → auth result (caching_sha2 fast path)
  resumedHandshakeRtts: 2,
  perMessageOverheadBytes: 40, // 4 B packet headers + COM_QUERY + column definitions/OK packet
  multiplexing: false,
  reliable: true,
  ordered: true,
  encrypted: false,
  runsOn: ['tcp', 'tls13', 'tls12'],
  pattern: 'request-response',
  ports: { plain: [3306], secure: [3306] },
  handshakeSequence: [
    {
      from: 'server',
      message: 'Initial handshake packet',
      detail: 'the server speaks first: version, salt',
    },
    {
      from: 'client',
      message: 'HandshakeResponse',
      detail: 'user, auth data (SSLRequest first for TLS)',
    },
    { from: 'server', message: 'OK (fast auth) or full auth exchange' },
  ],
  docs: {
    summary:
      'How clients talk to MySQL and MariaDB. The server opens with a greeting, the client authenticates, then queries run one at a time per connection — pool connections in the app or use a proxy.',
    handshakeSteps: [
      'Server greeting with auth salt',
      'Client HandshakeResponse (switches to TLS first when requested)',
      'caching_sha2_password: fast path OK, or a full RSA/TLS exchange on cache miss',
    ],
    headerFields: [
      '3 B payload length + 1 B sequence id',
      'COM_QUERY / COM_STMT_EXECUTE',
      'Result set: column count, column definitions, rows, EOF/OK',
    ],
    securityNotes: [
      'Require TLS (require_secure_transport=ON) for anything outside one host.',
      'Prepared statements prevent SQL injection.',
      'Grant each service its own user with least privilege — not root.',
    ],
  },
});
