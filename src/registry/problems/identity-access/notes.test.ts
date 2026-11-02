/**
 * S25: the companion notes stay in sync with the identity sample — they trace both identity paths,
 * explain each security component, name every flow and protocol on the board, and record the
 * relationships the model cannot draw.
 */
import { describe, expect, it } from 'vitest';
import { registry } from '../../index';
import notes from './NOTES.md?raw';

describe('S25 identity sample notes', () => {
  const p = registry.require('problem.sample-identity-access', 'problem');
  const graph = p.referenceSolutions[0]!;

  it('traces the user and service identity paths and contrasts the concepts', () => {
    for (const h of [
      '## Authentication vs authorization',
      '## User identity path',
      '## Service identity path',
      '## User roles vs workload roles',
      '## Why each component is here',
      '## Connections and trust boundaries',
      '## Known limits',
    ])
      expect(notes, h).toContain(h);
    // The three misconceptions the task rules out are stated explicitly.
    expect(notes).toMatch(/\*\*not\*\* a general database/);
    expect(notes).toMatch(/IAM does \*\*not\*\* replace end-user authorization/);
    expect(notes).toMatch(/verifies the JWT \*\*locally\*\*/);
    expect(notes).toMatch(/auth server is \*\*not\*\* on this path/);
  });

  it('names every flow, every component on the board and every application protocol', () => {
    for (const f of p.scenario.flows) expect(notes, f.id).toContain(`\`${f.id}\``);
    for (const n of graph.nodes) {
      const name = n.label.replace(/ \(.*$/, '');
      expect(notes, n.label).toContain(name);
    }
    expect(notes).toMatch(/HTTP\/2/);
    expect(notes).toMatch(/postgres-wire/);
    expect(notes).toMatch(/mTLS/);
  });

  it('records the modelling gaps as follow-ups', () => {
    expect(notes).toMatch(/Roles and permissions are not modelled/);
    expect(notes).toMatch(/Managed services have no outgoing ports/);
    expect(notes).toMatch(/False positive in `rule\.secrets-in-config`/);
    expect(notes).not.toMatch(/AKIA|BEGIN (RSA )?PRIVATE KEY/);
  });
});
