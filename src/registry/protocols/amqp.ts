import { defineProtocol } from '../define';

export default defineProtocol({
  id: 'amqp',
  name: 'AMQP 0-9-1',
  osiLayer: 7,
  handshakeRtts: 4, // header/Start, Start-Ok/Tune, Tune-Ok+Open/Open-Ok, Channel.Open
  resumedHandshakeRtts: 4,
  perMessageOverheadBytes: 50, // method frame (basic.publish) + content header frame + frame ends
  multiplexing: true, // channels share one TCP connection
  reliable: true,
  ordered: true,
  encrypted: false,
  runsOn: ['tcp', 'tls13', 'tls12'],
  pattern: 'pub-sub',
  ports: { plain: [5672], secure: [5671] },
  handshakeSequence: [
    { from: 'client', message: 'Protocol header "AMQP 0091"' },
    { from: 'server', message: 'Connection.Start' },
    { from: 'client', message: 'Connection.Start-Ok', detail: 'credentials' },
    { from: 'server', message: 'Connection.Tune' },
    { from: 'client', message: 'Tune-Ok + Connection.Open', detail: 'virtual host' },
    { from: 'server', message: 'Connection.Open-Ok' },
    { from: 'client', message: 'Channel.Open' },
    { from: 'server', message: 'Channel.Open-Ok' },
  ],
  docs: {
    summary:
      "RabbitMQ's protocol: producers publish to exchanges, which route to queues by binding rules; consumers acknowledge each message. Connection setup is chatty, so clients keep long-lived connections and open cheap channels on them.",
    handshakeSteps: [
      'Protocol header → Connection.Start',
      'Start-Ok (auth) → Tune',
      'Tune-Ok + Open → Open-Ok',
      'Channel.Open → Open-Ok — about 4 RTTs, so never connect per message',
    ],
    headerFields: [
      'Frame type, channel, size',
      'basic.publish: exchange, routing key, mandatory flag',
      'Properties: delivery-mode (persistent), correlation-id, reply-to',
    ],
    securityNotes: [
      'The default guest/guest user must never be reachable remotely.',
      'Use TLS (5671) and per-service users limited to their virtual host and queues.',
      'Publisher confirms and consumer acks are what make delivery reliable — not the protocol alone.',
    ],
  },
});
