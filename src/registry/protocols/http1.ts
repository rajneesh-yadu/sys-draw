import { defineProtocol } from '../define';

export default defineProtocol({
  id: 'http1',
  name: 'HTTP/1.1',
  osiLayer: 7,
  handshakeRtts: 0,
  perMessageOverheadBytes: 400, // typical uncompressed request + response header lines
  multiplexing: false,
  reliable: true,
  ordered: true,
  encrypted: false,
  runsOn: ['tcp', 'tls13', 'tls12', 'mtls'],
  pattern: 'request-response',
  ports: { plain: [80], secure: [443] },
  docs: {
    summary:
      'Text-based request/response protocol. One request at a time per connection, so browsers open about six connections per host to get parallelism.',
    handshakeSteps: [
      'No handshake of its own: the request is sent as soon as TCP (and TLS) are ready',
      'Keep-alive reuses the connection for the next request, saving the TCP/TLS handshakes',
    ],
    headerFields: [
      'Request line: method, path, version (GET /feed HTTP/1.1)',
      'Host',
      'Authorization / Cookie',
      'Content-Type, Content-Length',
      'Cache-Control, ETag',
      'Connection: keep-alive',
    ],
    securityNotes: [
      'Over plain TCP, cookies and tokens travel in clear text — always use HTTPS (http1 over tls13).',
      'Request smuggling: front and back servers disagreeing on Content-Length vs Transfer-Encoding.',
      'Head-of-line blocking: a slow response delays every request queued behind it on that connection.',
    ],
  },
});
