import { describe, expect, it } from 'vitest';
import { createRegistry } from './catalog';
import { REGISTRY_KINDS } from './define';
import { discoverEntries, RegistryLoadError } from './discover';
import { findUnresolvedReferences, isAvailableOn, registry } from './index';
import { REGISTRY_SOURCES } from './sources';

const SEEDED_COMPONENTS = [
  'client.app',
  'network.dns',
  'network.cdn',
  'network.load-balancer',
  'network.api-gateway',
  'compute.app-server',
  'compute.serverless-function',
  'database.sql',
  'database.nosql',
  'cache.in-memory',
  'messaging.queue',
  'messaging.topic',
  'messaging.stream',
  'storage.object',
];
/** Components that exist on one cloud only (S12). */
const PROVIDER_ONLY_COMPONENTS = ['database.aurora', 'database.spanner'];
const SEEDED_PROTOCOLS = ['tcp', 'tls13', 'http1', 'http2', 'grpc', 'websocket'];

describe('seeded registry', () => {
  const all = registry.list();

  it('loads the 14 generic + 2 provider-only components, 6 protocols and 4 providers', () => {
    expect(
      registry
        .list({ kind: 'component' })
        .map((c) => c.id)
        .sort(),
    ).toEqual([...SEEDED_COMPONENTS, ...PROVIDER_ONLY_COMPONENTS].sort());
    expect(
      registry
        .list({ kind: 'protocol' })
        .map((p) => p.id)
        .sort(),
    ).toEqual([...SEEDED_PROTOCOLS].sort());
    expect(registry.list({ kind: 'provider' }).map((p) => p.id)).toEqual([
      'aws',
      'azure',
      'gcp',
      'generic',
    ]);
    expect(registry.size).toBe(26);
  });

  it('has unique ids across all kinds', () => {
    const ids = all.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(all.map((e) => [e.id, e] as const))('%s has a non-empty docs.summary', (_id, entry) => {
    expect(entry.docs.summary.trim().length).toBeGreaterThan(20);
  });

  it.each(registry.list({ kind: 'component' }).map((c) => [c.id, c] as const))(
    '%s has full docs, a perf model, security notes and valid defaults',
    (_id, c) => {
      expect(c.docs.howItWorks.length).toBeGreaterThan(50);
      expect(c.docs.tradeoffs.length).toBeGreaterThanOrEqual(2);
      expect(c.docs.interviewTips.length).toBeGreaterThanOrEqual(2);
      expect(c.security?.threats.length).toBeGreaterThan(0);
      expect(c.perf.serviceTimeMs.read).toBeGreaterThan(0);
      expect(c.configSchema.safeParse(c.defaults).success).toBe(true);
      expect(registry.kindOf(c.id)).toBe('component');
      // id prefix follows the category folder (clients → client.)
      expect(c.id.split('.')[0]).toBe(c.category === 'clients' ? 'client' : c.category);
    },
  );

  it('every protocol runsOn reference resolves to a seeded protocol', () => {
    expect(findUnresolvedReferences(registry).filter((r) => r.field === 'runsOn')).toEqual([]);
  });

  it('entries are frozen', () => {
    const lb = registry.require('network.load-balancer', 'component');
    expect(Object.isFrozen(lb)).toBe(true);
    expect(Object.isFrozen(lb.perf)).toBe(true);
  });

  it('records the source file of each entry', () => {
    expect(registry.sourceOf('http2')).toBe('./protocols/http2.ts');
    expect(registry.sourceOf('cache.in-memory')).toBe('./components/cache/cache.ts');
  });
});

describe('registry API', () => {
  it('get(id) returns the entry, optionally checked against a kind', () => {
    expect(registry.get('tcp')?.id).toBe('tcp');
    expect(registry.get('tcp', 'protocol')?.osiLayer).toBe(4);
    expect(registry.get('tcp', 'component')).toBeUndefined();
    expect(registry.get('nope')).toBeUndefined();
    expect(registry.has('database.sql')).toBe(true);
  });

  it('require throws a readable error for missing or wrong-kind ids', () => {
    expect(() => registry.require('cache.nope', 'component')).toThrow(
      /Unknown component "cache.nope"/,
    );
    expect(() => registry.require('tcp', 'component')).toThrow(/is a protocol, not a component/);
  });

  it('list filters by category', () => {
    expect(registry.list({ category: 'database' }).map((e) => e.id)).toEqual([
      'database.aurora',
      'database.nosql',
      'database.spanner',
      'database.sql',
    ]);
    expect(registry.list({ kind: 'component', category: 'network' })).toHaveLength(4);
  });

  it('list filters by tag', () => {
    expect(registry.list({ tag: 'cache' }).map((e) => e.id)).toEqual([
      'cache.in-memory',
      'network.cdn',
    ]);
  });

  it('list filters by provider', () => {
    const onAws = registry.list({ kind: 'component', provider: 'aws' }).map((c) => c.id);
    expect(onAws).toContain('storage.object');
    expect(onAws).toContain('client.app'); // provider-neutral
    expect(registry.list({ kind: 'component', provider: 'generic' })).toHaveLength(14);
    expect(onAws).toContain('database.aurora');
    expect(onAws).not.toContain('database.spanner');
    expect(registry.list({ kind: 'provider', provider: 'aws' }).map((p) => p.id)).toEqual(['aws']);
    expect(registry.list({ kind: 'provider', provider: 'generic' })).toHaveLength(1);
  });

  it('list combines filters and is sorted by kind then id', () => {
    expect(registry.list({ tag: 'managed', category: 'network' }).map((e) => e.id)).toEqual([
      'network.api-gateway',
      'network.cdn',
      'network.dns',
      'network.load-balancer',
    ]);
    const kinds = registry.list().map((e) => registry.kindOf(e.id)!);
    const ranks = kinds.map((k) => REGISTRY_KINDS.indexOf(k));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('isAvailableOn: generic always, cloud only with a provider name or when provider-neutral', () => {
    const def = registry.require('storage.object', 'component');
    expect(isAvailableOn(def, 'azure')).toBe(true);
    expect(isAvailableOn({ ...def, providerNames: { aws: 'S3' } }, 'gcp')).toBe(false);
    expect(isAvailableOn({ ...def, providerNames: { aws: 'S3' } }, 'generic')).toBe(true);
  });

  it('isAvailableOn: provider-only components exist on their cloud only, never on generic', () => {
    const spanner = registry.require('database.spanner', 'component');
    expect(isAvailableOn(spanner, 'gcp')).toBe(true);
    expect(isAvailableOn(spanner, 'aws')).toBe(false);
    expect(isAvailableOn(spanner, 'generic')).toBe(false);
  });
});

describe('auto-discovery', () => {
  it('picks up a new component file with no other edits', () => {
    const withDummy = createRegistry(
      discoverEntries([
        ...REGISTRY_SOURCES,
        {
          kind: 'component',
          modules: import.meta.glob('./test-fixtures/components/**/*.ts', { eager: true }),
        },
      ]),
    );
    const dummy = withDummy.get('compute.dummy-worker', 'component');
    expect(dummy?.name).toBe('Dummy Worker');
    expect(withDummy.sourceOf('compute.dummy-worker')).toBe(
      './test-fixtures/components/compute/dummy-worker.ts',
    );
    expect(withDummy.list({ category: 'compute' }).map((c) => c.id)).toContain(
      'compute.dummy-worker',
    );
    expect(withDummy.list({ kind: 'component', provider: 'aws' }).map((c) => c.id)).toContain(
      'compute.dummy-worker',
    );
    expect(withDummy.list({ kind: 'component', provider: 'gcp' }).map((c) => c.id)).not.toContain(
      'compute.dummy-worker',
    );
    expect(withDummy.size).toBe(registry.size + 1);
    // the app registry is untouched
    expect(registry.has('compute.dummy-worker')).toBe(false);
  });

  it('rejects duplicate ids, naming both files', () => {
    const entry = registry.require('tcp', 'protocol');
    const sources = [
      { kind: 'protocol' as const, modules: { './protocols/a.ts': { default: entry } } },
      { kind: 'protocol' as const, modules: { './protocols/b.ts': { tcp: entry } } },
    ];
    expect(() => createRegistry(discoverEntries(sources))).toThrow(
      /Duplicate id "tcp" in \.\/protocols\/a\.ts \(protocol\) and \.\/protocols\/b\.ts/,
    );
  });

  it('collects an entry exported as both default and named only once', () => {
    const entry = registry.require('tcp', 'protocol');
    const found = discoverEntries([
      { kind: 'protocol', modules: { './p.ts': { default: entry, tcp: entry } } },
    ]);
    expect(found).toHaveLength(1);
  });

  it('rejects files with no entry and entries in the wrong folder', () => {
    const tcp = registry.require('tcp', 'protocol');
    const err = (() => {
      try {
        discoverEntries([
          {
            kind: 'component',
            modules: { './components/x/empty.ts': { helper: 1 }, './components/x/tcp.ts': { tcp } },
          },
        ]);
      } catch (e) {
        return e as RegistryLoadError;
      }
      return undefined;
    })();
    expect(err).toBeInstanceOf(RegistryLoadError);
    expect(err?.errors.join('\n')).toMatch(/empty\.ts: exports no defineComponent/);
    expect(err?.errors.join('\n')).toMatch(
      /tcp\.ts: exports a protocol but this folder holds component entries/,
    );
  });

  it('ignores plain objects that look like entries but were not created with define*', () => {
    const fake = { ...registry.require('tcp', 'protocol'), id: 'fake' };
    expect(() =>
      discoverEntries([{ kind: 'protocol', modules: { './f.ts': { default: fake } } }]),
    ).toThrow(/exports no defineProtocol/);
  });
});
