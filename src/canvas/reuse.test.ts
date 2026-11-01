import { describe, expect, it } from 'vitest';
import { registry } from '@/registry';
import { createBoardStore, emptyBoardDoc, type BoardCommand } from '@/store';
import { computeGroupRects } from './geometry';
import { isLowDetail, LOD_MIN_NODES, LOD_ZOOM } from './lod';
import { reuseUnchanged, sameFlowElement } from './reuse';
import { toFlowEdges, toFlowNodes } from './to-flow';

/** A 300-node board (client → 299 servers) through ordinary commands. */
function bigBoard() {
  const store = createBoardStore({ registry, initial: emptyBoardDoc() });
  const commands: BoardCommand[] = [
    { type: 'addNode', id: 'node_c', defId: 'client.app', position: { x: 0, y: 0 } },
  ];
  for (let i = 0; i < 299; i++) {
    const id = `node_s${i}`;
    commands.push({
      type: 'addNode',
      id,
      defId: 'compute.app-server',
      position: { x: (i % 20) * 240, y: 200 + Math.floor(i / 20) * 140 },
    });
    commands.push({ type: 'connect', id: `edge_${i}`, source: 'node_c', target: id });
  }
  expect(store.getState().dispatch({ type: 'batch', label: 'Big', commands }).ok).toBe(true);
  return store;
}

describe('structural sharing for flow elements (S21)', () => {
  it('compares nested data one level down, not by identity', () => {
    const a = {
      id: 'n',
      position: { x: 1, y: 2 },
      data: { region: { id: 'r', name: 'R' }, ports: [1] },
    };
    const b = {
      id: 'n',
      position: { x: 1, y: 2 },
      data: { region: { id: 'r', name: 'R' }, ports: a.data.ports },
    };
    expect(sameFlowElement(a, b)).toBe(true);
    expect(sameFlowElement(a, { ...b, position: { x: 1, y: 3 } })).toBe(false);
    expect(sameFlowElement(a, { ...b, data: { ...b.data, region: { id: 'r', name: 'S' } } })).toBe(
      false,
    );
    expect(sameFlowElement(a, { ...b, selected: true })).toBe(false);
  });

  it('returns the previous array when nothing changed, else reuses unchanged objects', () => {
    const prev = [
      { id: 'a', v: 1 },
      { id: 'b', v: 2 },
    ];
    expect(
      reuseUnchanged(prev, [
        { id: 'a', v: 1 },
        { id: 'b', v: 2 },
      ]),
    ).toBe(prev);
    const next = reuseUnchanged(prev, [
      { id: 'a', v: 1 },
      { id: 'b', v: 3 },
      { id: 'c', v: 0 },
    ]);
    expect(next[0]).toBe(prev[0]);
    expect(next[1]).not.toBe(prev[1]);
    expect(next).toHaveLength(3);
    // Reordering keeps the objects but returns a new array.
    const swapped = reuseUnchanged(prev, [
      { id: 'b', v: 2 },
      { id: 'a', v: 1 },
    ]);
    expect(swapped).not.toBe(prev);
    expect(swapped[0]).toBe(prev[1]);
  });

  it('on a 300-node board, selecting one node changes exactly one node object and no edge', () => {
    const store = bigBoard();
    const { doc } = store.getState();
    const rects = computeGroupRects(doc.graph, doc.layout.groupFrames);
    const nodes0 = toFlowNodes(doc, rects, new Set(), registry);
    const edges0 = toFlowEdges(doc, new Set(), registry);
    expect(nodes0).toHaveLength(300);

    const t0 = performance.now();
    const nodes1 = reuseUnchanged(nodes0, toFlowNodes(doc, rects, new Set(['node_s7']), registry));
    const edges1 = reuseUnchanged(edges0, toFlowEdges(doc, new Set(['node_s7']), registry));
    const ms = performance.now() - t0;

    expect(nodes1.filter((n, i) => n !== nodes0[i]).map((n) => n.id)).toEqual(['node_s7']);
    expect(edges1).toBe(edges0);
    // Re-deriving 300 nodes + 299 edges is cheap (budget for a 16 ms frame, with room).
    expect(ms).toBeLessThan(50);
  });

  it('moving one node changes only that node', () => {
    const store = bigBoard();
    const derive = () => {
      const { doc } = store.getState();
      return toFlowNodes(
        doc,
        computeGroupRects(doc.graph, doc.layout.groupFrames),
        new Set(),
        registry,
      );
    };
    const before = derive();
    store
      .getState()
      .dispatch({ type: 'moveNodes', moves: [{ id: 'node_s3', position: { x: 5, y: 5 } }] });
    const after = reuseUnchanged(before, derive());
    expect(after.filter((n, i) => n !== before[i]).map((n) => n.id)).toEqual(['node_s3']);
  });
});

describe('level of detail (S21)', () => {
  it('is low only when zoomed out on a large board', () => {
    expect(isLowDetail(LOD_ZOOM - 0.01, LOD_MIN_NODES)).toBe(true);
    expect(isLowDetail(LOD_ZOOM, LOD_MIN_NODES)).toBe(false);
    expect(isLowDetail(0.1, LOD_MIN_NODES - 1)).toBe(false);
  });
});
