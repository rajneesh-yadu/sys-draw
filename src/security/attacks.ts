/**
 * Learn-panel data for the attack chaos events (S16): what each attack does, what an attacker
 * sees, and which controls stop it. The engine models the impact (engine/chaos/attacks.ts).
 */
import type { ChaosEventKind } from '@/core';
import type { SecurityControl } from '@/registry';

export interface AttackInfo {
  kind: Extract<ChaosEventKind, 'ddosAttack' | 'credentialStuffing' | 'mitm' | 'dataExfiltration'>;
  name: string;
  summary: string;
  impact: string;
  stoppedBy: SecurityControl[];
  talkingPoints: string[];
}

export const ATTACKS: readonly AttackInfo[] = [
  {
    kind: 'ddosAttack',
    name: 'DDoS flood',
    summary: 'A botnet sends far more requests than real users to exhaust bandwidth or capacity.',
    impact:
      'Entry points saturate: latency and error rate climb for everyone; autoscaling runs up the bill.',
    stoppedBy: ['ddos-protection', 'waf', 'rate-limit'],
    talkingPoints: [
      'Anycast CDN + DDoS protection absorb volumetric floods at the edge.',
      'WAF rate-based rules and bot control stop application-layer floods.',
      'Cap autoscaling so an attack does not become a cost incident.',
    ],
  },
  {
    kind: 'credentialStuffing',
    name: 'Credential stuffing',
    summary: 'Bots replay username/password pairs leaked from other sites against your login.',
    impact:
      'Login traffic (slow password hashing) loads the auth path and the user database; some accounts are taken over.',
    stoppedBy: ['waf', 'rate-limit', 'auth'],
    talkingPoints: [
      'MFA makes a stolen password useless.',
      'Rate-limit per account and per IP, detect bots, check passwords against breach lists.',
    ],
  },
  {
    kind: 'mitm',
    name: 'Man in the middle',
    summary: 'An attacker on the network path reads or modifies traffic on a connection.',
    impact:
      'Plaintext edges: data and tokens are stolen and the relay adds latency. TLS edges: nothing readable.',
    stoppedBy: ['mtls'],
    talkingPoints: [
      'TLS everywhere (HSTS for browsers); mTLS between services.',
      'Certificate validation is what makes TLS stop a MITM — never disable it.',
    ],
  },
  {
    kind: 'dataExfiltration',
    name: 'Data exfiltration',
    summary:
      'A compromised service uses an over-permissive role to bulk-read a data store and ship it out.',
    impact: 'Bulk scans load the data store (slower for real users) and data leaves the network.',
    stoppedBy: ['iam', 'kms'],
    talkingPoints: [
      'Least-privilege roles per service limit the blast radius.',
      'KMS key policies and egress controls (no direct internet from the data tier) add layers.',
    ],
  },
];
