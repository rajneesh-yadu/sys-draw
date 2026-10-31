import { defineProtocol } from '../define';

export default defineProtocol({
  id: 'tcp',
  name: 'TCP',
  osiLayer: 4,
  handshakeRtts: 1,
  perMessageOverheadBytes: 40, // 20 B TCP header + 20 B IPv4 header, no options
  multiplexing: false,
  reliable: true,
  ordered: true,
  encrypted: false,
  runsOn: [], // the IP layer is implicit until the network session adds 'ip'
  docs: {
    summary:
      'Reliable, ordered byte stream between two hosts. Almost every request in a web system rides on a TCP connection.',
    handshakeSteps: [
      'Client → server: SYN (picks an initial sequence number)',
      'Server → client: SYN-ACK (acknowledges and picks its own sequence number)',
      'Client → server: ACK — the client may send data with this packet, so the handshake costs 1 RTT before the first request',
    ],
    headerFields: [
      'Source / destination port',
      'Sequence and acknowledgement numbers',
      'Flags (SYN, ACK, FIN, RST, PSH)',
      'Window size (flow control)',
      'Checksum',
    ],
    securityNotes: [
      'Plaintext: anyone on the path can read and modify payloads — add TLS for anything sensitive.',
      'SYN floods exhaust half-open connection tables; SYN cookies and DDoS protection mitigate them.',
      'Lost packets block everything behind them (head-of-line blocking) until retransmitted.',
    ],
  },
});
