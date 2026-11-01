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

/** S16: zone badge (text + colour). */
const ZONE_STYLE = {
  public: 'bg-red-100/90 text-red-800 dark:bg-red-900/70 dark:text-red-100',
  dmz: 'bg-amber-100/90 text-amber-900 dark:bg-amber-900/70 dark:text-amber-100',
  private: 'bg-emerald-100/90 text-emerald-900 dark:bg-emerald-900/70 dark:text-emerald-100',
  data: 'bg-indigo-100/90 text-indigo-900 dark:bg-indigo-900/70 dark:text-indigo-100',
} as const;
const ZONE_TEXT = {
  public: 'Public zone',
  dmz: 'DMZ',
  private: 'Private zone',
  data: 'Data zone',
} as const;
const ZONE_TITLE = {
  public: 'Public zone: reachable from the internet. Only edge services belong here.',
  dmz: 'DMZ: between the internet and the inside (load balancers, gateways, WAF, bastion).',
  private: 'Private zone: no inbound internet access (application tier).',
  data: 'Data zone: databases, caches and storage, reachable only from the app tier.',
} as const;

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
        {data.zone !== undefined && (
          <span
            data-testid="group-zone"
            data-zone={data.zone}
            className={`shrink-0 rounded px-1.5 py-0.5 font-semibold ${ZONE_STYLE[data.zone]}`}
            title={ZONE_TITLE[data.zone]}
          >
            {ZONE_TEXT[data.zone]}
          </span>
        )}
        {data.region !== undefined && (
          <span
            data-testid="group-region"
            className={`ml-auto shrink-0 truncate rounded px-1.5 py-0.5 ${
              data.region
                ? 'bg-violet-100/80 text-violet-800 dark:bg-violet-900/60 dark:text-violet-200'
                : 'bg-amber-100/80 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200'
            }`}
            title={
              data.region
                ? `Runs in ${data.region.name}: distance to users and other regions is simulated from here.`
                : 'No region set: select the group and pick its cloud region so distance is simulated.'
            }
          >
            {data.region ? data.region.id : 'Pick a region'}
          </span>
        )}
      </div>
    </div>
  );
});
