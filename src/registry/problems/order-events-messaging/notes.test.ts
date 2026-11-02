/**
 * S24: the companion notes stay in sync with the sample workflow — they cover every featured
 * technology, every flow, every protocol on the board and the TCP-only broker → consumer gap.
 */
import { describe, expect, it } from 'vitest';
import { registry } from '../../index';
import notes from './NOTES.md?raw';

describe('S24 sample workflow notes', () => {
  const p = registry.require('problem.sample-order-events', 'problem');
  const graph = p.referenceSolutions[0]!;

  it('has one section per featured technology and teaches that they are not interchangeable', () => {
    for (const h of [
      '## Redis',
      '## Kafka',
      '## RabbitMQ',
      '## Kubernetes',
      '## Not interchangeable',
      '## Known limits',
    ])
      expect(notes, h).toContain(h);
    expect(notes).toMatch(/consumer group/);
    expect(notes).toMatch(/compet/i);
    expect(notes).toMatch(/not a hop/i);
  });

  it('names every flow and every application protocol used on the board', () => {
    for (const f of p.scenario.flows) expect(notes, f.id).toContain(`\`${f.id}\``);
    const tops = new Set(graph.edges.map((e) => e.protocolStack[e.protocolStack.length - 1]!));
    for (const t of tops) expect(notes, t).toContain(t);
  });

  it('documents the TCP-only broker → consumer edges as a follow-up', () => {
    const tcpOnly = graph.edges.filter((e) => e.protocolStack.join() === 'tcp');
    expect(tcpOnly.length).toBeGreaterThan(0);
    expect(notes).toMatch(/Broker → consumer edges are plain `tcp`/);
  });
});
