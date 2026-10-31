import { defineProtocol } from '../define';

export default defineProtocol({
  id: 'http2',
  name: 'HTTP/2',
  osiLayer: 7,
  handshakeRtts: 0,
  perMessageOverheadBytes: 60, // 9 B frame header + HPACK-compressed headers on a warm connection
  multiplexing: true,
  reliable: true,
  ordered: true,
  encrypted: false,
  runsOn: ['tls13', 'tcp'],
  docs: {
    summary:
      'Binary HTTP with many concurrent streams on one connection and compressed headers. Same semantics as HTTP/1.1, far fewer connections.',
    handshakeSteps: [
      'Negotiated inside the TLS handshake via ALPN ("h2"), so it adds no round trip',
      'Client sends the connection preface and a SETTINGS frame; server replies with SETTINGS',
      'Requests then flow as interleaved HEADERS and DATA frames on numbered streams',
    ],
    headerFields: [
      'Frame header: length, type (HEADERS, DATA, SETTINGS, …), flags, stream id',
      'Pseudo-headers :method, :path, :scheme, :authority, :status',
      'HPACK dynamic table (repeated headers sent as small indexes)',
    ],
    securityNotes: [
      'Browsers only speak HTTP/2 over TLS; cleartext h2c is for trusted internal hops.',
      'Rapid-reset and stream-flood attacks abuse cheap stream creation — cap concurrent streams.',
      'Still TCP underneath: one lost packet stalls every stream (HTTP/3 over QUIC fixes this).',
    ],
  },
});
