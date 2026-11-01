import { defineProtocol } from '../define';

export default defineProtocol({
  id: 'udp',
  name: 'UDP',
  osiLayer: 4,
  handshakeRtts: 0,
  perMessageOverheadBytes: 28, // 8 B UDP header + 20 B IPv4 header
  unitBytes: 1472, // 1500 B MTU − 20 B IPv4 − 8 B UDP
  multiplexing: false,
  reliable: false,
  ordered: false,
  encrypted: false,
  runsOn: [],
  pattern: 'datagram',
  // No retransmission in UDP itself: the application's own timer resends (a DNS stub resolver
  // waits about a second). Protocols built on UDP (QUIC) bring their own recovery.
  loss: { recoveryRtts: 0, minRecoveryMs: 1000, holBlocking: 'none' },
  docs: {
    summary:
      'Connectionless datagrams: no handshake, no retransmission, no ordering. Fast and simple — used for DNS, media, games and as the base of QUIC.',
    handshakeSteps: ['None: the first datagram carries data'],
    headerFields: ['Source / destination port', 'Length', 'Checksum'],
    securityNotes: [
      'Source addresses are easy to spoof, which enables reflection and amplification DDoS (DNS, NTP, memcached).',
      'No built-in encryption: use DTLS or QUIC for anything sensitive.',
      'Lost datagrams are simply gone; the application must detect and resend them.',
    ],
  },
});
