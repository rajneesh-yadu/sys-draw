import { defineProtocol } from '../define';

export default defineProtocol({
  id: 'ipv4',
  name: 'IPv4',
  osiLayer: 3,
  handshakeRtts: 0,
  perMessageOverheadBytes: 20, // already counted in the TCP/UDP entries' per-segment overhead
  multiplexing: false,
  reliable: false,
  ordered: false,
  encrypted: false,
  runsOn: [],
  pattern: 'routing',
  implicit: true,
  docs: {
    summary:
      'Addresses and routes packets between hosts. Every edge implicitly runs on IP; inside a cloud VPC that means private ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16) behind NAT.',
    handshakeSteps: ['None: each packet is routed on its own'],
    headerFields: [
      'Source / destination address',
      'TTL (hop limit)',
      'Protocol (6 = TCP, 17 = UDP)',
      'Fragmentation fields',
      'Header checksum',
    ],
    securityNotes: [
      'Source addresses can be spoofed; never use them alone for authentication.',
      'Keep databases and internal services on private addresses with no public route.',
      'MTU mismatches cause fragmentation or black holes; MSS clamping and path-MTU discovery help.',
    ],
  },
});
