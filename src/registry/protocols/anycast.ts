import { defineProtocol } from '../define';

export default defineProtocol({
  id: 'anycast',
  name: 'BGP / Anycast',
  osiLayer: 3,
  handshakeRtts: 0,
  perMessageOverheadBytes: 0,
  multiplexing: false,
  reliable: false,
  ordered: false,
  encrypted: false,
  runsOn: [],
  pattern: 'routing',
  conceptual: true,
  docs: {
    summary:
      'BGP is how networks announce which IP ranges they can reach. With anycast, many sites announce the same address, so each user is routed to the nearest one — how CDNs and public DNS resolvers stay close to everyone.',
    handshakeSteps: ['Routers exchange route announcements over long-lived BGP sessions (TCP 179)'],
    headerFields: ['Prefix (e.g. 1.1.1.0/24)', 'AS path', 'Next hop'],
    securityNotes: [
      'BGP hijacks and route leaks can send traffic to the wrong network; RPKI route validation helps.',
      'Anycast spreads a DDoS over every site, which is why CDNs absorb attacks well.',
    ],
  },
});
