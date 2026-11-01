import { defineProtocol } from '../define';

export default defineProtocol({
  id: 'fibre',
  name: 'Optical fibre',
  osiLayer: 1,
  handshakeRtts: 0,
  perMessageOverheadBytes: 0,
  multiplexing: false,
  reliable: false,
  ordered: false,
  encrypted: false,
  runsOn: [],
  pattern: 'routing',
  implicit: true,
  docs: {
    summary:
      'Light in glass travels at about 200 km per millisecond (two thirds of c), along routes about 1.5× the great-circle distance. That sets a hard floor on latency that no protocol can beat — only moving closer (CDN, more regions) helps.',
    handshakeSteps: ['None'],
    headerFields: ['Bandwidth (how many bits per second) vs latency (how long one bit takes)'],
    securityNotes: [
      'Undersea cables can be tapped or cut; encryption in transit covers the first.',
    ],
  },
});
