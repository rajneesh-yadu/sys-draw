/**
 * S16 — attack chaos events on the real registry (control tags on WAF, DDoS shield, IAM…).
 * Baseline: 1 000 users × 1 rps = 1 000 rps through client → [controls] → app → db.
 *   DDoS ×10, nothing in front: ×10 traffic. WAF (90 %): 1 + 9 × 0.1 = ×1.9.
 *   WAF + DDoS shield: B = 1 − 0.1 × 0.01 = 0.999 ⇒ 1 + 9 × 0.001 = ×1.009.
 *   Credential stuffing 2 000/s, nothing in front: 1 + 2 000 / 1 000 = ×3; WAF + gateway
 *   (90 %, 70 %): B = 0.97 ⇒ 1 + 60 / 1 000 = ×1.06.
 */
import { describe, expect, it } from 'vitest';
import type { ChaosEvent, EdgeInstance, Graph, NodeInstance, SimResult } from '@/core';
import { registry } from '@/registry';
import { simulate } from '../simulate';
import { flow, scenario } from '../test-fixtures';
import {
  blockedShare,
  ddosMultiplier,
  DDOS_BLOCK,
  MITM_RELAY_MS,
  stuffingMultiplier,
} from './attacks';

function n(id: string, defId: string, config: Record<string, unknown> = {}): NodeInstance {
  const def = registry.require(defId, 'component');
  return {
    id: `node_${id}`,
    defId,
    label: id,
    position: { x: 0, y: 0 },
    config: { ...def.defaults, ...config },
    scaling: { replicas: 4, instanceType: def.instanceTypes[0]!.id },
  };
}
const e = (s: string, t: string, protocolStack = ['tcp', 'tls13', 'http1']): EdgeInstance => ({
  id: `edge_${s}_${t}`,
  source: `node_${s}`,
  target: `node_${t}`,
  protocolStack,
  sync: true,
  config: {},
});

/** client → (front…) → app → db. */
function board(
  front: [string, string, Record<string, unknown>?][] = [],
  extra: NodeInstance[] = [],
  clientStack?: string[],
): Graph {
  const chain = ['web', ...front.map(([id]) => id), 'app'];
  return {
    nodes: [
      n('web', 'client.app'),
      ...front.map(([id, def, cfg]) => n(id, def, cfg)),
      n('app', 'compute.app-server'),
      n('db', 'database.postgres'),
      ...extra,
    ],
    edges: [
      ...chain
        .slice(1)
        .map((t, i) => e(chain[i]!, t, i === 0 && clientStack ? clientStack : undefined)),
      e('app', 'db', ['tcp', 'tls13', 'postgres-wire']),
    ],
    groups: [],
  };
}

type EventBody = ChaosEvent extends infer T
  ? T extends ChaosEvent
    ? Omit<T, 'id' | 'atSec' | 'durationSec'>
    : never
  : never;

function run(graph: Graph, ev: EventBody): SimResult {
  const path = graph.edges.map((x) => x.target.slice(5));
  const ids = ['web', ...path.slice(0, -1), 'db'].filter((v, i, a) => a.indexOf(v) === i);
  const event = { id: 'event_a', atSec: 10, durationSec: 20, ...ev } as ChaosEvent;
  return simulate(
    { graph, scenario: scenario(1000, [flow('f', ids)], { events: [event], durationSec: 40 }) },
    registry,
  );
}
const at = (r: SimResult, t: number) => r.timeline!.find((p) => p.tSec === t)!;
const ratio = (r: SimResult) => at(r, 15).rps / at(r, 5).rps;

describe('control maths', () => {
  it('B = 1 − Π(1 − bᵢ) over the controls present', () => {
    expect(blockedShare(DDOS_BLOCK, new Set()).blocked).toBe(0);
    expect(blockedShare(DDOS_BLOCK, new Set(['waf'] as const)).blocked).toBeCloseTo(0.9, 12);
    expect(blockedShare(DDOS_BLOCK, new Set(['waf', 'ddos-protection'] as const))).toMatchObject({
      by: ['ddos-protection', 'waf'],
    });
    expect(
      blockedShare(DDOS_BLOCK, new Set(['waf', 'ddos-protection'] as const)).blocked,
    ).toBeCloseTo(0.999, 12);
    expect(ddosMultiplier(10, 0.9)).toBeCloseTo(1.9, 12);
    expect(stuffingMultiplier(2000, 0, 1000)).toBe(3);
    expect(stuffingMultiplier(2000, 0, 0)).toBe(1);
  });
});

describe('attack chaos events', () => {
  it('DDoS: ×10 unprotected, ×1.9 behind a WAF, ×1.009 behind WAF + DDoS shield; WAF in count mode blocks nothing', () => {
    const open = run(board(), { kind: 'ddosAttack', multiplier: 10 });
    expect(ratio(open)).toBeCloseTo(10, 6);
    expect(at(open, 35).rps).toBeCloseTo(at(open, 5).rps, 6); // over after 20 s
    expect(open.findings.find((f) => f.title === 'DDoS reached the servers')?.severity).toBe(
      'error',
    );

    expect(
      ratio(run(board([['waf', 'security.waf']]), { kind: 'ddosAttack', multiplier: 10 })),
    ).toBeCloseTo(1.9, 6);
    const both = run(
      board([
        ['shield', 'security.ddos-shield'],
        ['waf', 'security.waf'],
      ]),
      { kind: 'ddosAttack', multiplier: 10 },
    );
    expect(ratio(both)).toBeCloseTo(1.009, 6);
    expect(both.findings.find((f) => f.title === 'DDoS mostly absorbed')?.message).toContain(
      '99.9',
    );
    expect(
      ratio(
        run(board([['waf', 'security.waf', { mode: 'count' }]]), {
          kind: 'ddosAttack',
          multiplier: 10,
        }),
      ),
    ).toBeCloseTo(10, 6);
  });

  it('credential stuffing adds attempts/s to the baseline; WAF + gateway block 97 %; MFA stops takeovers', () => {
    const open = run(board(), { kind: 'credentialStuffing', rps: 2000 });
    expect(ratio(open)).toBeCloseTo(3, 6);
    // 2 000/s × 0.1 % × 20 s = 40 accounts
    expect(open.findings.find((f) => f.title === 'Credential stuffing')?.message).toContain(
      'About 40 accounts',
    );
    const guarded = run(
      board(
        [
          ['waf', 'security.waf'],
          ['gw', 'network.api-gateway', { rateLimitRps: 1_000_000, burst: 1_000_000 }],
        ],
        [n('auth', 'security.auth-server', { mfa: 'required' })],
      ),
      { kind: 'credentialStuffing', rps: 2000 },
    );
    expect(ratio(guarded)).toBeCloseTo(1.06, 6);
    expect(guarded.findings.find((f) => f.title === 'Credential stuffing')?.message).toContain(
      'MFA is required',
    );
  });

  it('MITM: a plaintext edge pays the relay delay and is exposed; TLS stops it', () => {
    const plain = run(board([], [], ['tcp', 'http1']), { kind: 'mitm' });
    expect(at(plain, 15).p50Ms - at(plain, 5).p50Ms).toBeCloseTo(MITM_RELAY_MS, 6);
    expect(
      plain.findings.find((f) => f.title === 'Man in the middle read plaintext traffic'),
    ).toMatchObject({
      severity: 'critical',
      targetIds: ['edge_web_app'],
    });
    const tls = run(board(), { kind: 'mitm' });
    expect(at(tls, 15).p50Ms).toBeCloseTo(at(tls, 5).p50Ms, 9);
    expect(tls.findings.some((f) => f.title === 'TLS stopped the man in the middle')).toBe(true);
  });

  it('exfiltration halves the data store’s capacity unless least-privilege IAM is on the board', () => {
    const open = run(board(), { kind: 'dataExfiltration' });
    const u = (r: SimResult, t: number) => at(r, t).nodes!.node_db!.utilization;
    expect(u(open, 15) / u(open, 5)).toBeCloseTo(2, 6);
    expect(open.findings.find((f) => f.title === 'Data exfiltrated')).toMatchObject({
      severity: 'critical',
      targetIds: ['node_db'],
    });
    const iam = run(board([], [n('iam', 'security.iam')]), { kind: 'dataExfiltration' });
    expect(u(iam, 15)).toBeCloseTo(u(iam, 5), 9);
    expect(iam.findings.some((f) => f.title === 'Exfiltration denied by IAM')).toBe(true);
    const lax = run(board([], [n('iam', 'security.iam', { leastPrivilege: false })]), {
      kind: 'dataExfiltration',
    });
    expect(u(lax, 15) / u(lax, 5)).toBeCloseTo(2, 6);
  });
});
