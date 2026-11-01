import { defineProtocol } from '../define';

export default defineProtocol({
  id: 'smtp',
  name: 'SMTP',
  osiLayer: 7,
  handshakeRtts: 2, // wait for the 220 greeting, then EHLO / 250
  perMessageOverheadBytes: 300, // MAIL FROM, RCPT TO, DATA commands and mail headers
  multiplexing: false,
  reliable: true,
  ordered: true,
  encrypted: false,
  runsOn: ['tcp', 'tls13', 'tls12'],
  pattern: 'request-response',
  ports: { plain: [25, 587], secure: [465] },
  handshakeSequence: [
    { from: 'server', message: '220 greeting', detail: 'the server speaks first' },
    { from: 'client', message: 'EHLO' },
    { from: 'server', message: '250 capabilities', detail: 'STARTTLS, AUTH, SIZE' },
  ],
  docs: {
    summary:
      'Sends email between servers and from apps to a mail relay. Chatty: several command/reply round trips per message, so apps hand mail to a queue or an email API instead of sending inline.',
    handshakeSteps: [
      'Server greeting (220)',
      'EHLO → capabilities',
      'STARTTLS upgrades the connection (port 587), or TLS from the start (465)',
      'AUTH, then MAIL FROM, RCPT TO, DATA per message',
    ],
    headerFields: [
      'Envelope: MAIL FROM, RCPT TO',
      'Message headers: From, To, Subject, DKIM-Signature',
    ],
    securityNotes: [
      'STARTTLS can be stripped by an attacker in the middle; MTA-STS enforces TLS between servers.',
      'Publish SPF, DKIM and DMARC or your mail will be spoofed and marked as spam.',
      'Never run an open relay.',
    ],
  },
});
