import { defineProtocol } from '../define';

export default defineProtocol({
  id: 'ethernet',
  name: 'Ethernet',
  osiLayer: 2,
  handshakeRtts: 0,
  perMessageOverheadBytes: 18, // 14 B header + 4 B frame check sequence
  unitBytes: 1500, // MTU
  multiplexing: false,
  reliable: false,
  ordered: false,
  encrypted: false,
  runsOn: [],
  pattern: 'routing',
  implicit: true,
  docs: {
    summary:
      'Frames on a local link, with a 1500 B MTU by default. Inside clouds the "Ethernet" is virtual (VPC networking), but the MTU still sets how many bytes fit in one packet.',
    handshakeSteps: ['None'],
    headerFields: [
      'Destination / source MAC',
      'EtherType (IPv4, IPv6)',
      'VLAN tag (optional)',
      'Frame check sequence',
    ],
    securityNotes: [
      'ARP spoofing on a shared LAN lets an attacker sit in the middle — another reason to encrypt.',
      'Jumbo frames (9001 B) inside a VPC cut per-packet overhead, but only if every hop supports them.',
    ],
  },
});
