import { defineProtocol } from '../define';

export default defineProtocol({
  id: 'memcache',
  name: 'Memcached protocol',
  osiLayer: 7,
  handshakeRtts: 0,
  perMessageOverheadBytes: 24, // binary/meta header
  multiplexing: false,
  reliable: true,
  ordered: true,
  encrypted: false,
  runsOn: ['tcp', 'udp'],
  pattern: 'request-response',
  ports: { plain: [11211] },
  docs: {
    summary:
      'Tiny get/set protocol (text, binary or the newer meta commands). No handshake and no auth by default — the client hashes each key to pick a server.',
    handshakeSteps: [
      'None: commands are sent as soon as TCP is up',
      'Optional SASL auth in binary mode',
    ],
    headerFields: [
      'Command (get, set, delete, mg/ms meta)',
      'Key, flags, TTL, byte count',
      'CAS token for compare-and-set',
    ],
    securityNotes: [
      'No authentication by default: keep it on private networks only.',
      'UDP port 11211 enabled the largest amplification DDoS on record — disable UDP.',
    ],
  },
});
