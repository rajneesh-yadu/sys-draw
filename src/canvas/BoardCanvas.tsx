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
import './canvas.css';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { registry } from '@/registry';
import {
  checkConnection,
  descendantsOf,
  GROUP_KINDS,
  groupKindLabel,
  useBoardStore,
  useBoardStoreApi,
  useSimulationStore,
  type BoardCommand,
  type GroupKind,
  type NodeMove,
} from '@/store';
import { useCanvasActions, useGroupRects } from './actions';
import { useCanvasUi } from './context';
import { useTraceStore, useTraceStoreApi } from './trace/context';
import { useSecurityStore, useSecurityStoreApi } from './security/context';
import { useReviewStore, useReviewStoreApi } from './review/context';
import { decodePaletteItem, DND_MIME } from './dnd';
import {
  findDropGroup,
  GRID,
  GROUP_HEADER,
  GROUP_PADDING,
  NODE_HEIGHT,
  NODE_WIDTH,
} from './geometry';
import { ProtocolEdge } from './edges/ProtocolEdge';
import { ComponentNode } from './nodes/ComponentNode';
import { GroupNode } from './nodes/GroupNode';
import { isEditableTarget, SHORTCUT_HELP, shortcutFor } from './shortcuts';
import { toFlowEdges, toFlowNodes, type FlowNode } from './to-flow';
import { reuseUnchanged, VIRTUALIZE_AT_NODES } from './reuse';
import { useDocumentColorMode } from './color-mode';
import { useLowDetail } from './lod';

/** Dot grid; skipped in low detail (S21: at 0.25× it is thousands of dots repainted per pan frame). */
function CanvasBackground() {
  const lowDetail = useLowDetail();
  return lowDetail ? null : <Background variant={BackgroundVariant.Dots} gap={GRID * 2} size={1} />;
}

// S21: React Flow copies these props into its store whenever their identity changes; inline
// literals made every canvas render (e.g. each selection) re-render all edges.
const SNAP_GRID: [number, number] = [GRID, GRID];
const MULTI_SELECT_KEYS = ['Meta', 'Control', 'Shift'];
const DEFAULT_EDGE_OPTIONS = { style: { strokeWidth: 1.5 } };
const FIT_VIEW_OPTIONS = { padding: 0.2, maxZoom: 1 };

const nodeTypes = { component: ComponentNode, sdGroup: GroupNode };
const edgeTypes = { sdEdge: ProtocolEdge };

/**
 * Fold the store's nodes into the local (rendered) copy. Nodes the store did not change (`kept`:
 * the very objects of the previous derivation) keep their local object, so React Flow skips them
 * (S21); changed ones take the store's version with React Flow's measurements.
 */
function mergeMeasured(
  next: FlowNode[],
  prev: FlowNode[],
  kept?: ReadonlySet<FlowNode>,
): FlowNode[] {
  const byId = new Map(prev.map((n) => [n.id, n]));
  return next.map((n) => {
    const local = byId.get(n.id);
    if (!local) return n;
    if (kept?.has(n)) return local;
    return local.measured ? ({ ...n, measured: local.measured } as FlowNode) : n;
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
  const freshNodes = useMemo(() => toFlowNodes(doc, rects, selSet, registry), [doc, rects, selSet]);
  const freshEdges = useMemo(() => toFlowEdges(doc, selSet, registry), [doc, selSet]);

  // S21: reuse unchanged node/edge objects across derivations so only touched elements re-render.
  const [derived, setDerived] = useState(() => ({ fresh: freshNodes, nodes: freshNodes }));
  const [edgeState, setEdgeState] = useState(() => ({ fresh: freshEdges, edges: freshEdges }));
  // Local copy so drags and resizes render live; the store gets one command when they end.
  const [nodes, setNodes] = useState<FlowNode[]>(freshNodes);
  if (derived.fresh !== freshNodes) {
    const next = reuseUnchanged(derived.nodes, freshNodes);
    setDerived({ fresh: freshNodes, nodes: next });
    if (next !== derived.nodes) {
      const kept = new Set(derived.nodes);
      setNodes((prev) => mergeMeasured(next, prev, kept));
    }
  }
  if (edgeState.fresh !== freshEdges) {
    setEdgeState({ fresh: freshEdges, edges: reuseUnchanged(edgeState.edges, freshEdges) });
  }
  const derivedNodes = derived.nodes;
  const edges = edgeState.edges;
  const resync = useCallback(
    () => setNodes((prev) => mergeMeasured(derivedNodes, prev)),
    [derivedNodes],
  );
  const colorMode = useDocumentColorMode();
  // S21: compositor layer only while the view moves (see canvas.css); no re-render needed.
  const wrapperEl = useRef<HTMLDivElement | null>(null);
  const setWrapperRef = useCallback(
    (el: HTMLDivElement | null) => {
      wrapperEl.current = el;
      setWrapper(el);
    },
    [setWrapper],
  );
  // Drag-pans only: wheel zoom starts/ends a "move" on every tick, and re-creating the layer
  // each tick costs more than it saves.
  const onMoveStart = useCallback((e: MouseEvent | TouchEvent | null) => {
    if (e && e.type !== 'wheel') wrapperEl.current?.classList.add('sd-moving');
  }, []);
  const onMoveEnd = useCallback(() => wrapperEl.current?.classList.remove('sd-moving'), []);
  const virtualize = doc.graph.nodes.length >= VIRTUALIZE_AT_NODES;

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

  // Focus requests (e.g. a bottleneck clicked in the metrics drawer): centre and zoom to the node.
  const focus = useSimulationStore((s) => s.focus);
  useEffect(() => {
    if (!focus) return;
    if (!store.getState().doc.graph.nodes.some((n) => n.id === focus.nodeId)) return;
    void rf.fitView({ nodes: [{ id: focus.nodeId }], padding: 0.6, maxZoom: 1.25, duration: 300 });
  }, [focus, rf, store]);

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
    <div ref={setWrapperRef} className="absolute inset-0" data-testid="board-canvas">
      <ReactFlow<FlowNode>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onDragOver={onDragOver}
        onDrop={onDrop}
        deleteKeyCode={null}
        selectionKeyCode="Shift"
        multiSelectionKeyCode={MULTI_SELECT_KEYS}
        snapToGrid={snap}
        snapGrid={SNAP_GRID}
        connectionLineType={ConnectionLineType.Bezier}
        defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
        minZoom={0.1}
        colorMode={colorMode}
        onMoveStart={onMoveStart}
        onMoveEnd={onMoveEnd}
        onlyRenderVisibleElements={virtualize}
        fitView={fitOnOpen}
        fitViewOptions={FIT_VIEW_OPTIONS}
      >
        <CanvasBackground />
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
            <div
              data-testid="canvas-empty"
              className="max-w-sm rounded-lg border border-dashed border-slate-300 bg-white/90 px-5 py-4 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900/90"
            >
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                This board is empty
              </p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Drag components here from the palette, or press{' '}
                <kbd className="rounded border border-slate-300 px-1 font-mono text-xs dark:border-slate-600">
                  Ctrl/⌘ K
                </kbd>{' '}
                and type a component name. Start from a practice problem with{' '}
                <span className="font-medium">Problems</span> in the top bar.
              </p>
            </div>
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
      <span className="mx-1 h-4 w-px bg-slate-200 dark:bg-slate-700" />
      <TraceToggle />
      <SecurityToggle />
      <ReviewToggle />
    </div>
  );
}

/** S16: shows the security overlay (edges by encryption, nodes by exposure) and the review. */
function SecurityToggle() {
  const sec = useSecurityStoreApi();
  const open = useSecurityStore((s) => s.open);
  const serious = useSecurityStore(
    (s) =>
      s.view?.findings.filter((f) => f.severity === 'critical' || f.severity === 'error').length ??
      0,
  );
  return (
    <button
      type="button"
      className={`${btn} ${open ? 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200' : ''}`}
      aria-pressed={open}
      onClick={() => sec.getState().setOpen(!open)}
      title="Security overlay: edges by encryption, components by exposure, and the threat review"
    >
      Security
      {serious > 0 && (
        <span
          data-testid="security-badge"
          className="ml-1 rounded-full bg-red-600 px-1.5 text-[10px] font-semibold text-white"
          aria-label={`${serious} critical or error findings`}
        >
          {serious}
        </span>
      )}
    </button>
  );
}

/** S19: opens/closes the design review; the badge counts critical + error findings. */
function ReviewToggle() {
  const review = useReviewStoreApi();
  const open = useReviewStore((s) => s.open);
  const serious = useReviewStore(
    (s) =>
      s.view?.findings.filter((f) => f.severity === 'critical' || f.severity === 'error').length ??
      0,
  );
  return (
    <button
      type="button"
      className={`${btn} ${open ? 'bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-200' : ''}`}
      aria-pressed={open}
      onClick={() => review.getState().setOpen(!open)}
      title="Design review: single points of failure, bottlenecks, missing caches/queues, retries, cost…"
    >
      Review
      {serious > 0 && (
        <span
          data-testid="review-badge"
          className="ml-1 rounded-full bg-red-600 px-1.5 text-[10px] font-semibold text-white"
          aria-label={`${serious} critical or error findings`}
        >
          {serious}
        </span>
      )}
    </button>
  );
}

/** S15: opens/closes the request-trace panel. */
function TraceToggle() {
  const trace = useTraceStoreApi();
  const open = useTraceStore((s) => s.open);
  return (
    <button
      type="button"
      className={`${btn} ${open ? 'bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-200' : ''}`}
      aria-pressed={open}
      onClick={() => trace.getState().setOpen(!open)}
      title="Follow one request end to end: DNS, handshakes, every hop and where the time goes"
    >
      Trace request
    </button>
  );
}
