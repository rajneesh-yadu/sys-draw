/** Saved documents (DATA-MODEL.md → "Saved documents"). */
import { z } from 'zod';
import { idSchema, RegistryIdSchema } from '../ids';
import { IsoDateTimeSchema, ModeIdSchema, NonEmptyStringSchema, ProviderIdSchema } from './common';
import { GraphSchema } from './graph';
import { SimResultSchema } from './result';
import { ScenarioSchema } from './scenario';

/** Not spelled out in DATA-MODEL.md; minimal app-wide preferences. */
export const THEMES = ['system', 'light', 'dark'] as const;
export const UserSettingsSchema = z.object({
  theme: z.enum(THEMES),
  defaultProviderId: ProviderIdSchema,
  autosave: z.boolean(),
  showFormulas: z.boolean(),
});
export type UserSettings = z.infer<typeof UserSettingsSchema>;

export const DEFAULT_USER_SETTINGS: UserSettings = {
  theme: 'system',
  defaultProviderId: 'generic',
  autosave: true,
  showFormulas: true,
};

export const ProjectSchema = z
  .object({
    id: idSchema('project'),
    name: NonEmptyStringSchema,
    boardIds: z.array(idSchema('board')),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .superRefine((p, ctx) => {
    const seen = new Set<string>();
    p.boardIds.forEach((id, i) => {
      if (seen.has(id))
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate board id "${id}"`,
          path: ['boardIds', i],
        });
      seen.add(id);
    });
  });
export type Project = z.infer<typeof ProjectSchema>;

export const SnapshotSchema = z.object({
  id: idSchema('snapshot'),
  label: NonEmptyStringSchema,
  at: IsoDateTimeSchema,
  graph: GraphSchema,
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

export const BoardSchema = z
  .object({
    id: idSchema('board'),
    projectId: idSchema('project'),
    name: NonEmptyStringSchema,
    providerId: ProviderIdSchema,
    mode: ModeIdSchema,
    problemId: RegistryIdSchema.optional(),
    graph: GraphSchema,
    scenario: ScenarioSchema,
    snapshots: z.array(SnapshotSchema),
    lastResult: SimResultSchema.optional(),
  })
  .superRefine((b, ctx) => {
    // Flows and chaos events must point at things that exist on this board.
    const nodeIds = new Set(b.graph.nodes.map((n) => n.id));
    const edgeIds = new Set(b.graph.edges.map((e) => e.id));
    const groupIds = new Set(b.graph.groups.map((g) => g.id));
    b.scenario.flows.forEach((f, fi) => {
      f.path.forEach((step, si) => {
        if (!nodeIds.has(step.nodeId)) {
          ctx.addIssue({
            code: 'custom',
            message: `Flow "${f.name}" visits unknown node "${step.nodeId}"`,
            path: ['scenario', 'flows', fi, 'path', si, 'nodeId'],
          });
        }
      });
    });
    b.scenario.events.forEach((ev, i) => {
      const refs: [string, string | undefined, Set<string>][] = [];
      if ('nodeId' in ev) refs.push(['nodeId', ev.nodeId, nodeIds]);
      if ('edgeId' in ev) refs.push(['edgeId', ev.edgeId, edgeIds]);
      if ('groupId' in ev) refs.push(['groupId', ev.groupId, groupIds]);
      for (const [key, value, known] of refs) {
        if (value !== undefined && !known.has(value)) {
          ctx.addIssue({
            code: 'custom',
            message: `Chaos event "${ev.id}" targets unknown ${key.replace('Id', '')} "${value}"`,
            path: ['scenario', 'events', i, key],
          });
        }
      }
    });
  });
export type Board = z.infer<typeof BoardSchema>;

export const WorkspaceSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    projects: z.array(ProjectSchema),
    settings: UserSettingsSchema,
  })
  .superRefine((w, ctx) => {
    const projectIds = new Set<string>();
    const boardOwner = new Map<string, string>();
    w.projects.forEach((p, pi) => {
      if (projectIds.has(p.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate project id "${p.id}"`,
          path: ['projects', pi, 'id'],
        });
      }
      projectIds.add(p.id);
      p.boardIds.forEach((bid, bi) => {
        const owner = boardOwner.get(bid);
        if (owner !== undefined && owner !== p.id) {
          ctx.addIssue({
            code: 'custom',
            message: `Board "${bid}" is listed in both "${owner}" and "${p.id}"`,
            path: ['projects', pi, 'boardIds', bi],
          });
        }
        boardOwner.set(bid, p.id);
      });
    });
  });
export type Workspace = z.infer<typeof WorkspaceSchema>;
