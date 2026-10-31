# SysDraw — Networking and security

> Source: `docs/SPEC.MD` (Oct 31, 2026), installed in session S01. This file is the source of truth from now on; change it only through an architecture-change session.

## Networking and security layer

Every edge carries a real protocol stack, so the user learns what actually travels between components and what it costs in round trips, bytes and risk.

**Protocol catalog (initial)**

| Layer                    | Protocols                                                                                                                          | What the app teaches                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 7 Application            | HTTP/1.1, HTTP/2, HTTP/3, gRPC, WebSocket, GraphQL, SSE, DNS, SMTP, MQTT, AMQP, Kafka wire, Redis RESP, PostgreSQL/MySQL wire, CQL | Request/response vs streaming, head-of-line blocking, multiplexing, long-lived connections, push vs pull |
| 6/5 Presentation/Session | TLS 1.2, TLS 1.3, mTLS, JSON, Protobuf, Avro                                                                                       | Handshake RTTs (TLS 1.3 = 1 RTT, 0-RTT resumption), certificate chains, serialisation size               |
| 4 Transport              | TCP, UDP, QUIC                                                                                                                     | 3-way handshake, congestion control, retransmits under packet loss, connection reuse                     |
| 3 Network                | IPv4, IPv6, ICMP, BGP/Anycast (conceptual)                                                                                         | Routing, NAT, anycast for CDN/DNS, private vs public IP ranges                                           |
| 2/1 Link/Physical        | Ethernet, fibre (conceptual)                                                                                                       | Bandwidth vs latency, MTU and fragmentation                                                              |

**Edge inspector.** Clicking an edge shows the stack bottom-up, handshake sequence, per-request overhead, connection reuse/pooling, encryption status, and typical ports. Invalid stacks (e.g. gRPC over UDP) are blocked by `runsOn`.

**Request trace (packet-flow view).** Pick a flow and a user region; the app animates one request hop by hop: DNS lookup → TCP SYN/SYN-ACK/ACK → TLS ClientHello/ServerHello → HTTP request → LB → service → cache miss → DB → response. A sequence-diagram panel lists each step with its time, layer and key header fields. Toggle "first request" vs "warm connection" to see handshake savings.

**Security model**

- **Zones:** groups mark public internet, DMZ, private subnet, data tier; edges crossing zones show firewall/security-group rules.
- **Controls (components or edge settings):** WAF, API gateway auth (OAuth2/JWT, API keys), mTLS between services, secrets manager, KMS encryption at rest, DDoS protection, rate limiting, bastion/VPN, IAM roles.
- **Threat checks (review rules):** database reachable from internet, plaintext edge carrying user data, no rate limit on public API, single region for critical data, secrets in config, missing auth between services, open admin ports.
- **Attack scenarios (chaos events):** DDoS flood, credential stuffing, MITM on plaintext edge, data exfiltration via over-permissive role. Each shows impact on metrics and which control would have stopped it.
- **Learn panels:** for each protocol and control: how it works, what an attacker sees, common misconfigurations, interview talking points.
