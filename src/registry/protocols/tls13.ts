import { defineProtocol } from '../define';

export default defineProtocol({
  id: 'tls13',
  name: 'TLS 1.3',
  osiLayer: 6,
  handshakeRtts: 1,
  perMessageOverheadBytes: 22, // 5 B record header + 1 B inner content type + 16 B AEAD tag
  multiplexing: false,
  reliable: true,
  ordered: true,
  encrypted: true,
  runsOn: ['tcp'],
  resumedHandshakeRtts: 0, // PSK resumption with 0-RTT early data
  unitBytes: 16384, // max TLS record payload
  pattern: 'security',
  handshakeSequence: [
    { from: 'client', message: 'ClientHello', detail: 'key share, SNI, ALPN' },
    {
      from: 'server',
      message: 'ServerHello … Finished',
      detail: 'key share, encrypted certificate',
    },
    { from: 'client', message: 'Finished', detail: 'first encrypted request in the same flight' },
  ],
  docs: {
    summary:
      'Encrypts and authenticates a TCP stream. TLS 1.3 needs one round trip to set up (zero with session resumption), versus two for TLS 1.2.',
    handshakeSteps: [
      'Client → server: ClientHello with supported ciphers and a key share (guessing the key-exchange group)',
      'Server → client: ServerHello with its key share, then encrypted certificate, CertificateVerify and Finished',
      'Client → server: Finished, followed immediately by the first encrypted request (1 RTT total)',
      'Resumption: a client holding a pre-shared key can send early data in the first flight (0-RTT)',
    ],
    headerFields: [
      'Record type (application_data on the wire for everything after the handshake)',
      'Legacy version (always 0x0303)',
      'Record length',
      'SNI (server name) and ALPN (e.g. h2) in the ClientHello',
    ],
    securityNotes: [
      'Forward secrecy is mandatory: ephemeral (EC)DHE keys mean a stolen server key cannot decrypt past traffic.',
      '0-RTT early data can be replayed by an attacker — only allow it for idempotent requests.',
      'SNI is sent in clear text, so observers can see which hostname you visit (unless ECH is used).',
      'Certificates must be validated; an expired or self-signed certificate in production is a common outage.',
    ],
  },
});
