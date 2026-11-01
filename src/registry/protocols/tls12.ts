import { defineProtocol } from '../define';

export default defineProtocol({
  id: 'tls12',
  name: 'TLS 1.2',
  osiLayer: 6,
  handshakeRtts: 2,
  resumedHandshakeRtts: 1, // session id / ticket resumption (abbreviated handshake)
  perMessageOverheadBytes: 29, // 5 B record header + 8 B explicit nonce + 16 B GCM tag
  unitBytes: 16384,
  multiplexing: false,
  reliable: true,
  ordered: true,
  encrypted: true,
  runsOn: ['tcp'],
  pattern: 'security',
  handshakeSequence: [
    { from: 'client', message: 'ClientHello', detail: 'cipher suites, SNI, ALPN' },
    { from: 'server', message: 'ServerHello, Certificate, ServerKeyExchange, ServerHelloDone' },
    { from: 'client', message: 'ClientKeyExchange, ChangeCipherSpec, Finished' },
    { from: 'server', message: 'ChangeCipherSpec, Finished', detail: 'request can follow: 2 RTT' },
  ],
  docs: {
    summary:
      'The previous TLS version, still common. Its full handshake needs two round trips before the first request (TLS 1.3 needs one) and it allows older, weaker cipher suites.',
    handshakeSteps: [
      'Client → server: ClientHello',
      'Server → client: ServerHello, Certificate, key exchange, ServerHelloDone',
      'Client → server: ClientKeyExchange, ChangeCipherSpec, Finished',
      'Server → client: ChangeCipherSpec, Finished — the request goes out after 2 RTTs',
      'Resumption (session ticket): an abbreviated 1-RTT handshake',
    ],
    headerFields: [
      'Record type, version 0x0303, length',
      'SNI and ALPN in the ClientHello',
      'Certificate chain (sent in clear)',
    ],
    securityNotes: [
      'Disable CBC, RC4, 3DES and static-RSA key exchange; keep only ECDHE + AEAD suites for forward secrecy.',
      'The certificate travels unencrypted, so observers learn which site you reach.',
      'Prefer TLS 1.3: faster handshake and no legacy cipher negotiation (downgrade attacks).',
    ],
  },
});
