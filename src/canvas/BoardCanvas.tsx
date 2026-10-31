import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type IsValidConnection,
  type NodeChange,
  type OnNodeDrag,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
import { registry } from '@/registry';
import {
  checkConnection,
  descendantsOf,
  GROUP_KINDS,
  groupKindLabel,
  useBoardStore,
  useBoardStoreApi,
  type BoardCommand,
  type GroupKind,
  type NodeMove,
} from '@/store';
import { useCanvasActions, useGroupRects } from './actions';
import { useCanvasUi } from './context';
import { decodePaletteItem, DND_MIME } from './dnd';
import {
  findDropGroup,
  GRID,
  GROUP_HEADER,
  GROUP_PADDING,
  NODE_HEIGHT,
  NODE_WIDTH,
} from './geometry';
import { ComponentNode } from './nodes/ComponentNode';
import { GroupNode } from './nodes/GroupNode';
import { isEditableTarget, SHORTCUT_HELP, shortcutFor } from './shortcuts';
import { toFlowEdges, toFlowNodes, type FlowNode } from './to-flow';

const nodeTypes = { component: ComponentNode, sdGroup: GroupNode };

/** Keep React Flow's measurements when the store sends fresh node objects. */
function mergeMeasured(next: FlowNode[], prev: FlowNode[]): FlowNode[] {
  const byId = new Map(prev.map((n) => [n.id, n]));
  return next.map((n) => {
    const m = byId.get(n.id)?.measured;
    return m ? ({ ...n, measured: m } as FlowNode) : n;
  });
}

function applySelection(current: readonly string[], changes: readonly (NodeChange | EdgeChange)[]) {
  const sel = new Set(current);
  let touched = false;
  for (const c of changes) {
    if (c.type !== 'select') continue;
    touched = true;
    if (c.selected) sel.add(c.id);
    else sel.delete(c.id);
  }
  return touched ? [...sel] : null;
}

/** The interactive board: renders the store's graph and turns gestures into store commands. */
export function BoardCanvas() {
  const store = useBoardStoreApi();
  const doc = useBoardStore((s) => s.doc);
  const selection = useBoardStore((s) => s.selection);
  const lastError = useBoardStore((s) => s.lastError);
  const canUndo = useBoardStore((s) => s.past.length > 0);
  const canRedo = useBoardStore((s) => s.future.length > 0);
  const { setWrapper, snap, groupKind } = useCanvasUi();
  const rf = useReactFlow();
  const actions = useCanvasActions();
  const rects = useGroupRects();

  // Fit on open only when there is something to fit; on an empty board React Flow would
  // otherwise re-fit when the first node is dropped and the view would jump.
  const [fitOnOpen] = useState(() => doc.graph.nodes.length + doc.graph.groups.length > 0);
  const selSet = useMemo(() => new Set(selection), [selection]);
  const derivedNodes = useMemo(
    () => toFlowNodes(doc, rects, selSet, registry),
    [doc, rects, selSet],
  );
  const edges = useMemo(() => toFlowEdges(doc, selSet, registry), [doc, selSet]);

  // Local copy so drags and resizes render live; the store gets one command when they end.
  const [nodes, setNodes] = useState<FlowNode[]>(derivedNodes);
  const [synced, setSynced] = useState(derivedNodes);
  if (synced !== derivedNodes) {
    setSynced(derivedNodes);
    setNodes((prev) => mergeMeasured(derivedNodes, prev));
  }
  const resync = useCallback(
    () => setNodes((prev) => mergeMeasured(derivedNodes, prev)),
    [derivedNodes],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      setNodes((nds) =>
        applyNodeChanges(
          changes.filter((c) => c.type !== 'remove'),
          nds,
        ),
      );
      const sel = applySelection(store.getState().selection, changes);
      if (sel) store.getState().setSelection(sel);
    },
    [store],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const sel = applySelection(store.getState().selection, changes);
      if (sel) store.getState().setSelection(sel);
    },
    [store],
  );

  const onNodeDragStop: OnNodeDrag<FlowNode> = useCallback(
    (_e, _node, dragged) => {
      const { doc: d } = store.getState();
      const commands: BoardCommand[] = [];
      const moves: NodeMove[] = [];
      for (const n of dragged) {
        const abs = rf.getInternalNode(n.id)?.internals.positionAbsolute;
        if (!abs) continue;
        if (n.type === 'component') {
          const cur = d.graph.nodes.find((x) => x.id === n.id);
          if (!cur) continue;
          const target = findDropGroup(d.graph, rects, {
            x: abs.x + NODE_WIDTH / 2,
            y: abs.y + NODE_HEIGHT / 2,
          });
          const position = { x: Math.round(abs.x), y: Math.round(abs.y) };
          if (
            position.x === cur.position.x &&
            position.y === cur.position.y &&
            target === cur.groupId
          )
            continue;
          moves.push({ id: n.id, position, groupId: target ?? null });
        } else {
          const old = rects.get(n.id);
          const g = d.graph.groups.find((x) => x.id === n.id);
          if (!old || !g) continue;
          const desc = descendantsOf(d.graph, n.id).groupIds;
          const parent = findDropGroup(
            d.graph,
            rects,
            { x: abs.x + GROUP_PADDING, y: abs.y + GROUP_HEADER / 2 },
            new Set([n.id, ...desc]),
          );
          const dx = Math.round(abs.x - old.x);
          const dy = Math.round(abs.y - old.y);
          if (dx === 0 && dy === 0 && parent === g.parentId) continue;
          commands.push({ type: 'moveGroup', groupId: n.id, dx, dy, parentId: parent ?? null });
        }
      }
      if (moves.length > 0) commands.unshift({ type: 'moveNodes', moves });
      if (commands.length === 0) return resync();
      const res = store
        .getState()
        .dispatch(
          commands.length === 1
            ? (commands[0] as BoardCommand)
            : { type: 'batch', label: 'Move', commands },
        );
      if (!res.ok) resync();
    },
    [store, rf, rects, resync],
  );

  const isValidConnection: IsValidConnection = useCallback(
    (c) =>
      checkConnection(registry, store.getState().doc.graph, {
        source: c.source,
        target: c.target,
        sourcePortId: c.sourceHandle ?? undefined,
        targetPortId: c.targetHandle ?? undefined,
      }).ok,
    [store],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      store.getState().dispatch({
        type: 'connect',
        source: c.source,
        target: c.target,
        ...(c.sourceHandle ? { sourcePortId: c.sourceHandle } : {}),
        ...(c.targetHandle ? { targetPortId: c.targetHandle } : {}),
      });
    },
    [store],
  );

  const onDragOver = useCallback((e: DragEvent) => {
    if (!e.dataTransfer.types.includes(DND_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      const item = decodePaletteItem(e.dataTransfer.getData(DND_MIME));
      if (!item) return;
      e.preventDefault();
      const at = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      if (item.kind === 'component') actions.addComponentAt(item.defId, at);
      else actions.addGroupAt(item.groupKind, at);
    },
    [rf, actions],
  );

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const action = shortcutFor(e);
      if (!action) return;
      const s = store.getState();
      e.preventDefault();
      switch (action) {
        case 'undo':
          s.undo();
          break;
        case 'redo':
          s.redo();
          break;
        case 'copy':
          s.copy();
          break;
        case 'cut':
          s.cut();
          break;
        case 'paste':
          s.paste();
          break;
        case 'delete':
          s.deleteSelection();
          break;
        case 'selectAll':
          actions.selectAll();
          break;
        case 'group':
          actions.groupSelection(groupKind);
          break;
        case 'ungroup':
          actions.ungroupSelection();
          break;
        case 'clearSelection':
          s.setSelection([]);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, actions, groupKind]);

  return (
    <div ref={setWrapper} className="absolute inset-0" data-testid="board-canvas">
      <ReactFlow<FlowNode>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onDragOver={onDragOver}
        onDrop={onDrop}
        deleteKeyCode={null}
        selectionKeyCode="Shift"
        multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
        snapToGrid={snap}
        snapGrid={[GRID, GRID]}
        connectionLineType={ConnectionLineType.Bezier}
        defaultEdgeOptions={{ style: { strokeWidth: 1.5 } }}
        minZoom={0.1}
        fitView={fitOnOpen}
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
      >
        <Background variant={BackgroundVariant.Dots} gap={GRID * 2} size={1} />
        <Controls position="bottom-left" />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          nodeColor={(n) => (n.type === 'sdGroup' ? 'rgba(148,163,184,0.25)' : '#0ea5e9')}
          nodeStrokeColor={(n) => (n.type === 'sdGroup' ? '#94a3b8' : '#0369a1')}
        />
        <Panel position="top-left">
          <Toolbar
            canUndo={canUndo}
            canRedo={canRedo}
            hasSelection={selection.length > 0}
            onAutoLayout={() => void actions.autoLayout()}
            onGroup={() => actions.groupSelection(groupKind)}
            onUngroup={() => actions.ungroupSelection()}
          />
        </Panel>
        {lastError && (
          <Panel position="top-center">
            <div
              role="alert"
              className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-sm text-red-800 shadow-sm dark:border-red-900 dark:bg-red-950 dark:text-red-200"
            >
              <span>{lastError}</span>
              <button
                type="button"
                onClick={() => store.getState().clearError()}
                className="rounded px-1 text-red-600 hover:bg-red-100 dark:hover:bg-red-900"
                aria-label="Dismiss error"
              >
                ×
              </button>
            </div>
          </Panel>
        )}
        {doc.graph.nodes.length === 0 && doc.graph.groups.length === 0 && (
          <Panel position="top-center" className="!pointer-events-none !mt-24">
            <p className="rounded-md bg-white/80 px-3 py-1.5 text-sm text-slate-500 shadow-sm dark:bg-slate-900/80 dark:text-slate-400">
              Drag components here from the palette
            </p>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}

const btn =
  'rounded px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none dark:text-slate-200 dark:hover:bg-slate-800';

function Toolbar(props: {
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  onAutoLayout: () => void;
  onGroup: () => void;
  onUngroup: () => void;
}) {
  const store = useBoardStoreApi();
  const ui = useCanvasUi();
  return (
    <div
      role="toolbar"
      aria-label="Canvas tools"
      className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white/95 p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900/95"
    >
      <button
        type="button"
        className={btn}
        disabled={!props.canUndo}
        onClick={() => store.getState().undo()}
        title={`Undo (${SHORTCUT_HELP.undo})`}
      >
        Undo
      </button>
      <button
        type="button"
        className={btn}
        disabled={!props.canRedo}
        onClick={() => store.getState().redo()}
        title={`Redo (${SHORTCUT_HELP.redo})`}
      >
        Redo
      </button>
      <span className="mx-1 h-4 w-px bg-slate-200 dark:bg-slate-700" />
      <button
        type="button"
        className={btn}
        onClick={props.onGroup}
        title={`Group selection (${SHORTCUT_HELP.group})`}
      >
        Group as
      </button>
      <label className="sr-only" htmlFor="sd-group-kind">
        Group kind
      </label>
      <select
        id="sd-group-kind"
        value={ui.groupKind}
        onChange={(e) => ui.setGroupKind(e.target.value as GroupKind)}
        className="rounded border border-slate-200 bg-transparent px-1 py-0.5 text-xs dark:border-slate-700"
      >
        {GROUP_KINDS.map((k) => (
          <option key={k} value={k}>
            {groupKindLabel(k)}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={btn}
        onClick={props.onUngroup}
        title={`Ungroup (${SHORTCUT_HELP.ungroup})`}
      >
        Ungroup
      </button>
      <button
        type="button"
        className={btn}
        disabled={!props.hasSelection}
        onClick={() => store.getState().deleteSelection()}
        title={`Delete (${SHORTCUT_HELP.delete})`}
      >
        Delete
      </button>
      <span className="mx-1 h-4 w-px bg-slate-200 dark:bg-slate-700" />
      <button
        type="button"
        className={btn}
        onClick={props.onAutoLayout}
        title="Arrange left → right (ELK)"
      >
        Auto-layout
      </button>
      <label className="flex items-center gap-1 px-2 text-xs text-slate-600 dark:text-slate-300">
        <input type="checkbox" checked={ui.snap} onChange={(e) => ui.setSnap(e.target.checked)} />
        Snap
      </label>
    </div>
  );
}
