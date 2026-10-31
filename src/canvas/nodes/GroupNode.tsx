import { NodeResizer, useReactFlow, type NodeProps, type OnResizeEnd } from '@xyflow/react';
import { memo, useCallback } from 'react';
import { useBoardStoreApi, type GroupKind } from '@/store';
import type { GroupFlowNode } from '../to-flow';
import { GROUP_HEADER } from '../geometry';

const KIND_STYLE: Record<GroupKind, string> = {
  region: 'border-violet-400 bg-violet-50/40 dark:bg-violet-950/20',
  az: 'border-sky-400 bg-sky-50/40 dark:bg-sky-950/20',
  vpc: 'border-emerald-400 bg-emerald-50/40 dark:bg-emerald-950/20',
  subnet: 'border-amber-400 bg-amber-50/40 dark:bg-amber-950/20',
  cluster: 'border-slate-400 bg-slate-100/40 dark:bg-slate-800/20',
};

/** Region / AZ / VPC / subnet / cluster container. Drag it by the header; resize when selected. */
export const GroupNode = memo(function GroupNode({
  id,
  data,
  selected,
  parentId,
}: NodeProps<GroupFlowNode>) {
  const store = useBoardStoreApi();
  const rf = useReactFlow();
  const onResizeEnd: OnResizeEnd = useCallback(
    (_e, p) => {
      const origin =
        parentId === undefined
          ? { x: 0, y: 0 }
          : (rf.getInternalNode(parentId)?.internals.positionAbsolute ?? { x: 0, y: 0 });
      store.getState().dispatch({
        type: 'setGroupFrame',
        groupId: id,
        frame: {
          x: Math.round(origin.x + p.x),
          y: Math.round(origin.y + p.y),
          width: Math.round(p.width),
          height: Math.round(p.height),
        },
      });
    },
    [store, rf, id, parentId],
  );
  return (
    <div
      data-testid="group-node"
      className={`h-full w-full rounded-xl border-2 border-dashed ${KIND_STYLE[data.kind]} ${
        selected ? 'ring-2 ring-sky-500/50' : ''
      }`}
    >
      <NodeResizer
        isVisible={selected ?? false}
        minWidth={160}
        minHeight={100}
        color="#0ea5e9"
        onResizeEnd={onResizeEnd}
      />
      <div
        className="sd-group-header flex cursor-move items-center gap-2 px-3 text-xs"
        style={{ height: GROUP_HEADER }}
      >
        <span className="rounded bg-white/80 px-1.5 py-0.5 font-semibold tracking-wide text-slate-600 uppercase dark:bg-slate-900/80 dark:text-slate-300">
          {data.kindLabel}
        </span>
        <span className="truncate font-medium text-slate-700 dark:text-slate-200">
          {data.label}
        </span>
      </div>
    </div>
  );
});
