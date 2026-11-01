/** S14: the protocol catalog is complete and consistent, and stack suggestions resolve. */
import { describe, expect, it } from 'vitest';
import { CATEGORIES, type ProtocolDefinition } from '@/core';
import { findUnresolvedReferences, matchScore, registry, suggestedStacks } from './index';

const protocols = registry.list({ kind: 'protocol' }) as ProtocolDefinition[];
const component = (id: string) => registry.require(id, 'component');

describe('protocol catalog (S14)', () => {
  it('every component port protocol is in the catalog now', () => {
    expect(findUnresolvedReferences(registry)).toEqual([]);
  });

  it.each(protocols.map((p) => [p.id, p] as const))('%s is complete', (_id, p) => {
    expect(p.docs.handshakeSteps.length).toBeGreaterThan(0);
    expect(p.docs.headerFields.length).toBeGreaterThan(0);
    expect(p.docs.securityNotes.length).toBeGreaterThan(0);
    if (p.handshakeRtts > 0) expect(p.handshakeSequence?.length ?? 0).toBeGreaterThan(0);
    if (p.osiLayer === 4) expect(p.loss).toBeDefined();
    // Conceptual and implicit layers are never placed on edges, so nothing may run on them.
    if (p.implicit || p.conceptual) {
      expect(protocols.filter((q) => q.runsOn.includes(p.id))).toEqual([]);
    }
  });

  it('application protocols reach a transport by following runsOn', () => {
    const reachesTransport = (id: string, seen = new Set<string>()): boolean => {
      const p = registry.get(id, 'protocol');
      if (!p || seen.has(id)) return false;
      if (p.osiLayer === 4 && p.runsOn.length === 0) return true;
      seen.add(id);
      return p.runsOn.some((r) => reachesTransport(r, seen));
    };
    for (const p of protocols.filter((q) => q.osiLayer === 7)) {
      expect(reachesTransport(p.id), p.id).toBe(true);
    }
  });

  it('every suggested stack is valid bottom-up and its matchers name real components', () => {
    const ids = new Set(registry.list({ kind: 'component' }).map((c) => c.id));
    for (const p of protocols) {
      for (const s of p.suggestedStacks ?? []) {
        expect(s.stack[s.stack.length - 1]).toBe(p.id);
        s.stack.forEach((id, i) => {
          const def = registry.get(id, 'protocol');
          expect(def, id).toBeDefined();
          const below = s.stack[i - 1];
          if (below === undefined) expect(def?.runsOn).toEqual([]);
          else expect(def?.runsOn).toContain(below);
        });
        for (const m of [...s.from, ...s.to]) {
          if (m.startsWith('category:')) expect(CATEGORIES).toContain(m.slice(9));
          else if (!m.startsWith('tag:')) expect(ids.has(m), m).toBe(true);
        }
      }
    }
  });
});

describe('suggestedStacks', () => {
  it('matchScore: id > tag > category > any', () => {
    const kafka = component('messaging.kafka');
    expect(matchScore([], kafka)).toBe(1);
    expect(matchScore(['category:messaging'], kafka)).toBe(2);
    expect(matchScore([`tag:${kafka.tags[0]}`], kafka)).toBe(3);
    expect(matchScore(['messaging.kafka', 'category:messaging'], kafka)).toBe(4);
    expect(matchScore(['category:compute'], kafka)).toBe(0);
  });

  it('browser → CDN: HTTP/3; service → Kafka: Kafka wire over TCP; anything → DNS: UDP', () => {
    expect(
      suggestedStacks(registry, component('client.app'), component('network.cdn'))[0],
    ).toMatchObject({
      protocolId: 'http3',
      stack: ['udp', 'quic', 'http3'],
    });
    expect(
      suggestedStacks(registry, component('compute.app-server'), component('messaging.kafka'))[0]
        ?.stack,
    ).toEqual(['tcp', 'kafka-wire']);
    expect(
      suggestedStacks(registry, component('client.app'), component('network.dns'))[0]?.stack,
    ).toEqual(['udp', 'dns']);
    expect(
      suggestedStacks(registry, component('client.app'), component('network.load-balancer')),
    ).toEqual([]);
  });
});
