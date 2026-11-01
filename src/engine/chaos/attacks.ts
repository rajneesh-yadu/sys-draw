/**
 * Attack chaos events (S16): DDoS flood, credential stuffing, man in the middle and data
 * exfiltration, and how much of each the design's security controls stop.
 *
 * Controls are registry data (`control:<id>` tags on components). An attack on the entry points
 * meets the controls of every node reachable from a client (the request path); a WAF in "count"
 * mode blocks nothing, and IAM only helps with `leastPrivilege` on. Approximations, named below:
 *
 * - DDoS: effective traffic multiplier = 1 + (m − 1) × (1 − B), B = 1 − Π(1 − bᵢ) over the
 *   controls in front (DDoS protection 99 %, WAF 90 %, rate limiting 80 %).
 * - Credential stuffing: R attempts/s add R × (1 − B) / baseline rps to every flow (logins hit the
 *   same path and the user store), with WAF bot control 90 % and rate limits 70 %. Without MFA
 *   0.1 % of attempts that get through take over an account.
 * - MITM: each plaintext edge in scope gets +20 ms (attacker relay) and its data is exposed;
 *   encrypted edges are unaffected (TLS authenticates the server).
 * - Exfiltration: with no least-privilege IAM, bulk reads take half of each target data store's
 *   capacity (modelled as 2× slower service) for the event's duration.
 */
import type { ChaosEvent, Finding } from '@/core';
import { CONTROL_LABEL, controlsOf, DATA_CATEGORIES, type SecurityControl } from '@/registry';
import { isEncrypted } from '@/network';
import { engineFinding } from '../model/findings';
import { fmt, pct } from '../model/format';
import type { CompiledNode, Model } from '../model/types';

export type AttackEvent = Extract<
  ChaosEvent,
  { kind: 'ddosAttack' | 'credentialStuffing' | 'mitm' | 'dataExfiltration' }
>;

export const DDOS_BLOCK: Partial<Record<SecurityControl, number>> = {
  'ddos-protection': 0.99,
  waf: 0.9,
  'rate-limit': 0.8,
};
export const STUFFING_BLOCK: Partial<Record<SecurityControl, number>> = {
  waf: 0.9,
  'rate-limit': 0.7,
};
/** Extra latency of an attacker relaying a plaintext connection, ms. */
export const MITM_RELAY_MS = 20;
/** Bulk reads leave the store this many times slower for real traffic (half its capacity). */
export const EXFIL_SLOWDOWN = 2;
/** Share of stuffed logins that use a valid password (when MFA is not required). */
export const STUFFING_SUCCESS_RATE = 0.001;

export function isAttack(ev: ChaosEvent): ev is AttackEvent {
  return (
    ev.kind === 'ddosAttack' ||
    ev.kind === 'credentialStuffing' ||
    ev.kind === 'mitm' ||
    ev.kind === 'dataExfiltration'
  );
}

/** Controls a node really provides (a WAF in count mode blocks nothing; IAM needs least privilege). */
function activeControls(n: CompiledNode): SecurityControl[] {
  return controlsOf(n.def).filter((c) => {
    if (c === 'waf' && n.config.mode === 'count') return false;
    if (c === 'iam' && n.config.leastPrivilege === false) return false;
    if (c === 'mtls' && n.config.mtls === 'off') return false;
    return true;
  });
}

/** Controls on the request path: every node reachable from a client node. */
export function frontControls(model: Model): Map<SecurityControl, string[]> {
  const out = new Map<SecurityControl, string[]>();
  const seen = new Set<string>();
  const queue = [...model.nodes.values()].filter((n) => n.category === 'clients').map((n) => n.id);
  const clients = new Set(queue);
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = model.nodes.get(id);
    if (n && !clients.has(id))
      for (const c of activeControls(n)) out.set(c, [...(out.get(c) ?? []), n.label]);
    for (const e of model.out.get(id) ?? []) queue.push(e.target);
  }
  return out;
}

/** Controls anywhere on the board (IAM, secrets, KMS are side services, not on the path). */
export function boardControls(model: Model): Set<SecurityControl> {
  const out = new Set<SecurityControl>();
  for (const n of model.nodes.values()) for (const c of activeControls(n)) out.add(c);
  return out;
}

/** B = 1 − Π(1 − bᵢ) over the controls present, and which ones contributed. */
export function blockedShare(
  table: Partial<Record<SecurityControl, number>>,
  present: ReadonlyMap<SecurityControl, unknown> | ReadonlySet<SecurityControl>,
): { blocked: number; by: SecurityControl[] } {
  let pass = 1;
  const by: SecurityControl[] = [];
  for (const [c, b] of Object.entries(table) as [SecurityControl, number][]) {
    if (!present.has(c)) continue;
    pass *= 1 - b;
    by.push(c);
  }
  return { blocked: 1 - pass, by };
}

export function ddosMultiplier(multiplier: number, blocked: number): number {
  return 1 + Math.max(0, multiplier - 1) * (1 - blocked);
}

export function stuffingMultiplier(rps: number, blocked: number, baselineRps: number): number {
  if (!(baselineRps > 0)) return 1;
  return 1 + (rps * (1 - blocked)) / baselineRps;
}

/** Edges a MITM event intercepts: the named edge, or every plaintext edge. */
export function mitmEdges(
  model: Model,
  ev: AttackEvent & { kind: 'mitm' },
): { id: string; plaintext: boolean }[] {
  const ids = ev.edgeId ? [ev.edgeId] : [...model.edges.keys()];
  const out: { id: string; plaintext: boolean }[] = [];
  for (const id of ids) {
    const e = model.edges.get(id);
    if (!e || e.stack.layers.length === 0) continue;
    const plaintext = !isEncrypted(e.stack);
    if (ev.edgeId || plaintext) out.push({ id, plaintext });
  }
  return out;
}

/** Data stores an exfiltration event targets. */
export function exfilTargets(
  model: Model,
  ev: AttackEvent & { kind: 'dataExfiltration' },
): string[] {
  if (ev.nodeId) return model.nodes.has(ev.nodeId) ? [ev.nodeId] : [];
  return [...model.nodes.values()]
    .filter((n) => n.category !== undefined && DATA_CATEGORIES.includes(n.category))
    .map((n) => n.id);
}

export interface AttackEffects {
  /** Traffic multiplier on every flow. */
  spike: number;
  edgeAddedMs: Map<string, number>;
  /** Service-time factor per node. */
  slow: Map<string, number>;
}

/** What one active attack does at a tick. */
export function attackEffects(model: Model, ev: AttackEvent, baselineRps: number): AttackEffects {
  const fx: AttackEffects = { spike: 1, edgeAddedMs: new Map(), slow: new Map() };
  switch (ev.kind) {
    case 'ddosAttack':
      fx.spike = ddosMultiplier(
        ev.multiplier,
        blockedShare(DDOS_BLOCK, frontControls(model)).blocked,
      );
      break;
    case 'credentialStuffing':
      fx.spike = stuffingMultiplier(
        ev.rps,
        blockedShare(STUFFING_BLOCK, frontControls(model)).blocked,
        baselineRps,
      );
      break;
    case 'mitm':
      for (const e of mitmEdges(model, ev))
        if (e.plaintext) fx.edgeAddedMs.set(e.id, MITM_RELAY_MS);
      break;
    case 'dataExfiltration':
      if (!boardControls(model).has('iam'))
        for (const id of exfilTargets(model, ev)) fx.slow.set(id, EXFIL_SLOWDOWN);
      break;
  }
  return fx;
}

const ctlList = (cs: readonly SecurityControl[]) => cs.map((c) => CONTROL_LABEL[c]).join(' + ');

/** One finding per attack: what got through, what it did, and which control would stop it. */
export function attackFindings(
  model: Model,
  events: readonly ChaosEvent[],
  baselineRps: number,
  responseBytes: number,
  runSec: number,
): Finding[] {
  const out: Finding[] = [];
  const edgeName = (id: string) => {
    const e = model.edges.get(id);
    const n = (x: string) => model.nodes.get(x)?.label ?? x;
    return e ? `${n(e.source)} → ${n(e.target)}` : id;
  };
  for (const ev of events) {
    if (!isAttack(ev)) continue;
    const dur = Math.max(0, Math.min(runSec, ev.atSec + (ev.durationSec ?? Infinity)) - ev.atSec);
    switch (ev.kind) {
      case 'ddosAttack': {
        const { blocked, by } = blockedShare(DDOS_BLOCK, frontControls(model));
        const eff = ddosMultiplier(ev.multiplier, blocked);
        out.push(
          engineFinding(
            'engine.chaos',
            by.length > 0 ? 'info' : 'error',
            by.length > 0 ? 'DDoS mostly absorbed' : 'DDoS reached the servers',
            `A ×${fmt(ev.multiplier)} flood hit the entry points. ` +
              (by.length > 0
                ? `${ctlList(by)} blocked ${pct(blocked)} of it (B = 1 − Π(1 − bᵢ)), so traffic rose only to ×${fmt(eff)}.`
                : `Nothing in front filtered it, so every service saw ×${fmt(eff)} traffic. A DDoS shield (99 %), WAF (90 %) or rate limit (80 %) in front would have absorbed most of it.`),
            [],
          ),
        );
        break;
      }
      case 'credentialStuffing': {
        const { blocked, by } = blockedShare(STUFFING_BLOCK, frontControls(model));
        const through = ev.rps * (1 - blocked);
        const mfa = [...model.nodes.values()].some(
          (n) => controlsOf(n.def).includes('auth') && n.config.mfa === 'required',
        );
        const takeovers = mfa ? 0 : through * STUFFING_SUCCESS_RATE * dur;
        out.push(
          engineFinding(
            'engine.chaos',
            takeovers >= 1 ? 'error' : 'warning',
            'Credential stuffing',
            `${fmt(ev.rps)} login attempts/s; ${by.length > 0 ? `${ctlList(by)} blocked ${pct(blocked)}, ` : 'nothing blocked them, '}${fmt(through)}/s reached the login path (+${pct(baselineRps > 0 ? through / baselineRps : 0)} load). ` +
              (mfa
                ? 'MFA is required, so leaked passwords alone take over no accounts.'
                : `About ${fmt(takeovers)} accounts taken over (${pct(STUFFING_SUCCESS_RATE)} of attempts use a valid password). Require MFA on the auth server and add WAF bot control / rate limits.`),
            [],
          ),
        );
        break;
      }
      case 'mitm': {
        const edges = mitmEdges(model, ev);
        const open = edges.filter((e) => e.plaintext);
        out.push(
          engineFinding(
            'engine.chaos',
            open.length > 0 ? 'critical' : 'info',
            open.length > 0
              ? 'Man in the middle read plaintext traffic'
              : 'TLS stopped the man in the middle',
            open.length > 0
              ? `${open.length} plaintext edge(s) (${open
                  .slice(0, 3)
                  .map((e) => edgeName(e.id))
                  .join(
                    ', ',
                  )}${open.length > 3 ? '…' : ''}) were intercepted: tokens and data readable, +${MITM_RELAY_MS} ms relay delay. TLS (mTLS inside) would have stopped it.`
              : `Every intercepted edge is encrypted: the attacker saw only ciphertext and could not impersonate the server.`,
            open.map((e) => e.id),
          ),
        );
        break;
      }
      case 'dataExfiltration': {
        const targets = exfilTargets(model, ev);
        const iam = boardControls(model).has('iam');
        const gb = (baselineRps * responseBytes * dur) / 1e9;
        out.push(
          engineFinding(
            'engine.chaos',
            iam ? 'info' : 'critical',
            iam ? 'Exfiltration denied by IAM' : 'Data exfiltrated',
            iam
              ? 'The compromised role had least-privilege permissions: bulk reads of other data were denied.'
              : `An over-permissive role bulk-read ${targets.map((id) => `"${model.nodes.get(id)?.label ?? id}"`).join(', ')} for ${fmt(dur)} s, using half of its capacity and copying ≈ ${fmt(gb)} GB out. Least-privilege IAM roles (one per service) would have denied it; KMS key policies and no internet egress from the data tier add layers.`,
            targets,
          ),
        );
        break;
      }
    }
  }
  return out;
}
