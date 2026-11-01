import { defineProtocol } from '../define';

export default defineProtocol({
  id: 'mtls',
  name: 'mTLS (TLS 1.3, mutual)',
  osiLayer: 6,
  handshakeRtts: 1,
  resumedHandshakeRtts: 0,
  perMessageOverheadBytes: 22,
  unitBytes: 16384,
  multiplexing: false,
  reliable: true,
  ordered: true,
  encrypted: true,
  runsOn: ['tcp'],
  pattern: 'security',
  handshakeSequence: [
    { from: 'client', message: 'ClientHello' },
    {
      from: 'server',
      message: 'ServerHello … CertificateRequest, Finished',
      detail: 'asks the client for a certificate',
    },
    {
      from: 'client',
      message: 'Certificate, CertificateVerify, Finished',
      detail: '+ first request',
    },
  ],
  docs: {
    summary:
      'TLS where both sides present certificates, so the server knows which service is calling. The standard for zero-trust service-to-service traffic, usually automated by a service mesh.',
    handshakeSteps: [
      'Same 1-RTT flow as TLS 1.3, but the server sends CertificateRequest',
      'The client answers with its own certificate and a signature proving it holds the key',
      'Both identities (e.g. SPIFFE ids) are then available for authorisation decisions',
    ],
    headerFields: [
      'Client and server certificate chains',
      'SAN / SPIFFE identity in the certificate',
    ],
    securityNotes: [
      'Short-lived certificates with automatic rotation (mesh CA) avoid outages from expiry.',
      'mTLS proves identity; you still need authorisation rules saying which service may call which.',
      'Terminating mTLS at a proxy and forwarding plaintext reopens the gap it closed.',
    ],
  },
});
