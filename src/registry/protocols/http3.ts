import { defineProtocol } from '../define';

export default defineProtocol({
  id: 'http3',
  name: 'HTTP/3',
  osiLayer: 7,
  handshakeRtts: 0, // negotiated inside the QUIC handshake
  perMessageOverheadBytes: 50, // HEADERS/DATA frame headers + QPACK-compressed headers
  multiplexing: true,
  reliable: true,
  ordered: true,
  encrypted: false, // QUIC below it encrypts
  runsOn: ['quic'],
  pattern: 'multiplexed',
  ports: { secure: [443] },
  suggestedStacks: [
    {
      from: ['category:clients'],
      to: ['network.cdn'],
      stack: ['udp', 'quic', 'http3'],
      why: 'Browsers and apps reach CDN edges over HTTP/3: one round trip less to connect, and lossy mobile links stall only the affected stream.',
    },
  ],
  docs: {
    summary:
      'HTTP over QUIC. Same semantics as HTTP/2, but the connection setup takes one round trip (zero on resumption) and a lost packet only delays its own stream — a big win on mobile and lossy networks.',
    handshakeSteps: [
      'First visit: the server advertises HTTP/3 with an Alt-Svc header (or DNS HTTPS record); later connections use QUIC',
      'QUIC + TLS 1.3 handshake in 1 RTT, ALPN "h3"',
      'Control stream SETTINGS, then each request is a QUIC stream with HEADERS and DATA frames',
    ],
    headerFields: [
      'Frame type and length (HEADERS, DATA, SETTINGS, GOAWAY)',
      'Pseudo-headers :method, :path, :scheme, :authority, :status',
      'QPACK-encoded headers (dynamic table on separate streams to avoid blocking)',
    ],
    securityNotes: [
      'Always encrypted (QUIC); there is no cleartext HTTP/3.',
      '0-RTT requests can be replayed — servers should accept only idempotent requests early.',
      'Keep HTTP/2 available as a fallback where UDP is blocked.',
    ],
  },
});
