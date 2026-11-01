import { defineProtocol } from '../define';

export default defineProtocol({
  id: 'quic',
  name: 'QUIC',
  osiLayer: 4,
  handshakeRtts: 1, // transport + TLS 1.3 handshake combined
  resumedHandshakeRtts: 0, // 0-RTT with a resumption ticket
  // short header: 1 B flags + 8 B connection id + 2 B packet number + 16 B AEAD tag + ~3 B STREAM frame
  perMessageOverheadBytes: 30,
  unitBytes: 1200, // QUIC's minimum supported datagram size; real paths often allow ~1350
  multiplexing: true,
  reliable: true,
  ordered: true, // within each stream
  encrypted: true, // TLS 1.3 is built in; even most header fields are protected
  runsOn: ['udp'],
  pattern: 'multiplexed',
  ports: { secure: [443] },
  handshakeSequence: [
    {
      from: 'client',
      message: 'Initial: ClientHello',
      detail: 'TLS 1.3 key share inside QUIC CRYPTO frames',
    },
    {
      from: 'server',
      message: 'Initial + Handshake: ServerHello … Finished',
      detail: 'certificate, transport parameters',
    },
    { from: 'client', message: 'Handshake: Finished + 1-RTT request', detail: '1 RTT total' },
  ],
  // Time-threshold loss detection (9/8 RTT, 1 ms granularity); a loss stalls only its own stream.
  loss: { recoveryRtts: 1.125, minRecoveryMs: 1, holBlocking: 'stream' },
  docs: {
    summary:
      'Encrypted, multiplexed transport over UDP. Merges the transport and TLS 1.3 handshakes into one round trip (zero on resumption) and recovers lost packets per stream, so one loss does not stall the others.',
    handshakeSteps: [
      'Client → server: Initial packet carrying a TLS 1.3 ClientHello',
      'Server → client: ServerHello, certificate and Finished in Initial/Handshake packets',
      'Client → server: Finished plus the first request — 1 RTT instead of TCP + TLS = 2',
      'Resumption: early data in the first flight (0-RTT), replayable like TLS 0-RTT',
      'Connection ids let a phone keep the connection when it moves from Wi-Fi to cellular',
    ],
    headerFields: [
      'Header form and packet type (Initial, Handshake, 0-RTT, 1-RTT)',
      'Destination / source connection ids',
      'Packet number (encrypted)',
      'Frames: STREAM, ACK, CRYPTO, MAX_DATA, CONNECTION_CLOSE',
    ],
    securityNotes: [
      'Encryption is mandatory; middleboxes cannot read or tamper with transport headers.',
      'Address validation (Retry tokens) and the 3× amplification limit stop reflection attacks.',
      'Some corporate firewalls block UDP 443; clients fall back to HTTP/2 over TCP.',
    ],
  },
});
