/** The inspector: picks a panel for the current selection (node, edge, group, or the board). */
import { useBoardStore } from '@/store';
import { EdgePanel } from './panels/EdgePanel';
import { GroupPanel } from './panels/GroupPanel';
import { NodePanel } from './panels/NodePanel';
import { ScenarioPanel } from './panels/ScenarioPanel';

export function Inspector() {
  const selection = useBoardStore((s) => s.selection);
  const doc = useBoardStore((s) => s.doc);

  if (selection.length > 1) {
    return (
      <p className="p-3 text-sm text-slate-500">
        {selection.length} items selected. Select one to configure it.
      </p>
    );
  }
  const id = selection[0];
  if (id === undefined)
    return <ScenarioPanel scenario={doc.scenario} providerId={doc.providerId} />;

  const node = doc.graph.nodes.find((n) => n.id === id);
  // `key` resets per-item state (tabs, field errors) when the selection changes.
  if (node) return <NodePanel key={id} node={node} providerId={doc.providerId} />;
  const edge = doc.graph.edges.find((e) => e.id === id);
  if (edge) return <EdgePanel key={id} edge={edge} graph={doc.graph} scenario={doc.scenario} />;
  const group = doc.graph.groups.find((g) => g.id === id);
  if (group)
    return <GroupPanel key={id} group={group} graph={doc.graph} providerId={doc.providerId} />;
  return <ScenarioPanel scenario={doc.scenario} providerId={doc.providerId} />;
}
