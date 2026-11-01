/** S18: the seeded Learn-mode lessons are complete, valid registry data. */
import { describe, expect, it } from 'vitest';
import { GraphSchema } from '@/core';
import { registry } from '../index';

const lessons = registry.list({ kind: 'lesson' });

describe('lessons (S18)', () => {
  it('ships five lessons', () => {
    expect(lessons.map((l) => l.id).sort()).toEqual([
      'lesson.cache-aside',
      'lesson.cap-theorem',
      'lesson.consistent-hashing',
      'lesson.kafka-partitions',
      'lesson.tls-handshake',
    ]);
  });

  describe.each(lessons.map((l) => [l.id, l] as const))('%s', (_id, l) => {
    it('has steps, a quiz of three and related registry entries', () => {
      expect(l.steps.length).toBeGreaterThanOrEqual(3);
      expect(l.quiz.length).toBeGreaterThanOrEqual(3);
      for (const id of l.related) expect(registry.has(id), id).toBe(true);
      expect(l.docs.summary.length).toBeGreaterThan(20);
    });

    it('has a valid mini-board, and step focus ids point at it', () => {
      const b = l.board!;
      expect(GraphSchema.safeParse(b).success).toBe(true);
      for (const n of b.nodes) {
        const def = registry.get(n.defId, 'component');
        expect(def, n.defId).toBeDefined();
        expect(def!.instanceTypes.map((t) => t.id)).toContain(n.scaling.instanceType);
        const parsed = def!.configSchema.safeParse({ ...def!.defaults, ...n.config });
        expect(parsed.success, `${n.id}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
      }
      for (const e of b.edges)
        for (const p of e.protocolStack) expect(registry.get(p, 'protocol'), p).toBeDefined();
      const ids = new Set([...b.nodes, ...b.edges, ...b.groups].map((x) => x.id));
      for (const s of l.steps) for (const f of s.focusIds ?? []) expect(ids.has(f), f).toBe(true);
    });
  });
});
