/**
 * S21 performance: structural sharing for React Flow nodes/edges. `toFlowNodes`/`toFlowEdges`
 * build fresh objects on every store change; React Flow re-renders every node whose object
 * changed, so on a 300-node board one click (selection) re-rendered all 300. `reuseUnchanged`
 * hands back the previous object wherever nothing visible changed, so only the touched nodes
 * re-render.
 */

/** Element-wise `===` for arrays. */
function sameArray(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** `===`, or the same plain object / array one level down (values compared with `===`). */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return sameArray(a, b);
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    const va = (a as Record<string, unknown>)[k];
    const vb = (b as Record<string, unknown>)[k];
    if (va === vb) continue;
    if (Array.isArray(va) && Array.isArray(vb) && sameArray(va, vb)) continue;
    return false;
  }
  return true;
}

/**
 * Two flow elements render the same: same keys, each value `===` or equal one/two levels down
 * (positions, styles, `data` with its small nested objects such as `region`).
 */
export function sameFlowElement(a: object, b: object): boolean {
  if (a === b) return true;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    const va = (a as Record<string, unknown>)[k];
    const vb = (b as Record<string, unknown>)[k];
    if (va === vb) continue;
    if (k === 'data' && va && vb && typeof va === 'object' && typeof vb === 'object') {
      const da = va as Record<string, unknown>;
      const db = vb as Record<string, unknown>;
      const keys = Object.keys(da);
      if (keys.length !== Object.keys(db).length) return false;
      if (
        !keys.every(
          (dk) => Object.prototype.hasOwnProperty.call(db, dk) && sameValue(da[dk], db[dk]),
        )
      )
        return false;
      continue;
    }
    if (!sameValue(va, vb)) return false;
  }
  return true;
}

/**
 * `next` with every element that renders the same as its previous version (by id) replaced by
 * that previous object. Returns `prev` itself when nothing changed at all (same ids, same order).
 */
export function reuseUnchanged<T extends { id: string }>(prev: readonly T[], next: T[]): T[] {
  if (prev.length === 0) return next;
  const byId = new Map(prev.map((p) => [p.id, p]));
  let allSame = prev.length === next.length;
  const out = next.map((n, i) => {
    const old = byId.get(n.id);
    if (old !== undefined && sameFlowElement(old, n)) {
      if (prev[i] !== old) allSame = false;
      return old;
    }
    allSame = false;
    return n;
  });
  return allSame ? (prev as T[]) : out;
}

/** Above this many nodes the canvas only renders what is in view (React Flow virtualisation). */
export const VIRTUALIZE_AT_NODES = 150;
