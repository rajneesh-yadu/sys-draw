/** Canvas actions shared by the palette, toolbar, drop handler and keyboard shortcuts. */
import { useReactFlow } from '@xyflow/react';
import { useCallback, useMemo, useRef } from 'react';
import { registry } from '@/registry';
import {
  descendantsOf,
  useBoardStore,
  useBoardStoreApi,
  type GroupKind,
  type Position,
} from '@/store';
import { useCanvasUi } from './context';
import {
  computeGroupRects,
  DEFAULT_GROUP_SIZE,
  findDropGroup,
  NODE_HEIGHT,
  NODE_WIDTH,
  snap as snapTo,
} from './geometry';
import { computeAutoLayout } from './layout';

export function useGroupRects() {
  const graph = useBoardStore((s) => s.doc.graph);
  const frames = useBoardStore((s) => s.doc.layout.groupFrames);
  return useMemo(() => computeGroupRects(graph, frames), [graph, frames]);
}

export function useCanvasActions() {
  const store = useBoardStoreApi();
  const rf = useReactFlow();
  const ui = useCanvasUi();
  const spawn = useRef(0);

  const rects = () => {
    const { doc } = store.getState();
    return computeGroupRects(doc.graph, doc.layout.groupFrames);
  };
  const s = (v: number) => (ui.snap ? snapTo(v) : Math.round(v));

  /** Flow coordinates of the visible canvas centre, nudged so repeated adds don't stack. */
  const viewportCenter = useCallback((): Position => {
    const el = ui.wrapper;
    const box = el?.getBoundingClientRect();
    const base = box
      ? rf.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 })
      : { x: 0, y: 0 };
    const k = spawn.current++ % 6;
    return { x: base.x + k * 24, y: base.y + k * 24 };
  }, [rf, ui.wrapper]);

  const addComponentAt = useCallback(
    (defId: string, at: Position) => {
      const groupId = findDropGroup(store.getState().doc.graph, rects(), at);
      return store.getState().dispatch({
        type: 'addNode',
        defId,
        position: { x: s(at.x - NODE_WIDTH / 2), y: s(at.y - NODE_HEIGHT / 2) },
        ...(groupId !== undefined ? { groupId } : {}),
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, ui.snap],
  );

  const addGroupAt = useCallback(
    (kind: GroupKind, at: Position) => {
      const parentId = findDropGroup(store.getState().doc.graph, rects(), at);
      return store.getState().dispatch({
        type: 'group',
        kind,
        memberIds: [],
        frame: {
          x: s(at.x - DEFAULT_GROUP_SIZE.width / 2),
          y: s(at.y - DEFAULT_GROUP_SIZE.height / 2),
          ...DEFAULT_GROUP_SIZE,
        },
        ...(parentId !== undefined ? { parentId } : {}),
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, ui.snap],
  );

  /** Wrap the selected nodes/groups in a new group; with nothing selected, add an empty one. */
  const groupSelection = useCallback(
    (kind: GroupKind) => {
      const { doc, selection } = store.getState();
      const members = selection.filter(
        (id) =>
          doc.graph.nodes.some((n) => n.id === id) || doc.graph.groups.some((g) => g.id === id),
      );
      if (members.length === 0) return addGroupAt(kind, viewportCenter());
      return store.getState().dispatch({ type: 'group', kind, memberIds: members });
    },
    [store, addGroupAt, viewportCenter],
  );

  const ungroupSelection = useCallback(() => {
    const { doc, selection } = store.getState();
    const groups = doc.graph.groups.filter((g) => selection.includes(g.id));
    if (groups.length === 0) return { ok: false as const, reason: 'Select a group to ungroup' };
    // Ungroup innermost first so each command still finds its group.
    const order = groups.sort(
      (a, b) =>
        descendantsOf(doc.graph, a.id).groupIds.size - descendantsOf(doc.graph, b.id).groupIds.size,
    );
    return store.getState().dispatch({
      type: 'batch',
      label: 'Ungroup',
      commands: order.map((g) => ({ type: 'ungroup', groupId: g.id })),
    });
  }, [store]);

  const selectAll = useCallback(() => {
    const { graph } = store.getState().doc;
    store
      .getState()
      .setSelection([
        ...graph.groups.map((g) => g.id),
        ...graph.nodes.map((n) => n.id),
        ...graph.edges.map((e) => e.id),
      ]);
  }, [store]);

  const autoLayout = useCallback(async () => {
    const { graph } = store.getState().doc;
    if (graph.nodes.length === 0 && graph.groups.length === 0) return;
    const cmd = await computeAutoLayout(graph, rects());
    const res = store.getState().dispatch(cmd);
    if (res.ok)
      window.requestAnimationFrame(() => void rf.fitView({ padding: 0.15, duration: 300 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, rf]);

  return {
    viewportCenter,
    addComponentAt,
    addGroupAt,
    groupSelection,
    ungroupSelection,
    selectAll,
    autoLayout,
    registry,
  };
}
