/** "Docs" tab: renders the definition docs carried by registry entries (no docs live in the UI). */
import type { ReactNode } from 'react';
import type { EntryByKind } from '@/registry';

type ComponentDef = EntryByKind['component'];
type ProtocolDef = EntryByKind['protocol'];
type ProviderDef = EntryByKind['provider'];

function List({ title, items }: { title: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold text-slate-700 dark:text-slate-300">{title}</h4>
      <ul className="list-disc space-y-1 pl-4 text-xs text-slate-600 dark:text-slate-400">
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

function Para({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div>
      {title !== undefined && (
        <h4 className="mb-1 text-xs font-semibold text-slate-700 dark:text-slate-300">{title}</h4>
      )}
      <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">{children}</p>
    </div>
  );
}

export function ComponentDocs({ def }: { def: ComponentDef }) {
  return (
    <article aria-label={`${def.name} docs`} className="space-y-3">
      <Para>{def.docs.summary}</Para>
      {def.docs.howItWorks !== '' && <Para title="How it works">{def.docs.howItWorks}</Para>}
      <List title="Trade-offs" items={def.docs.tradeoffs} />
      <List title="Interview tips" items={def.docs.interviewTips} />
      {def.security && (
        <>
          <List title="Threats" items={def.security.threats} />
          <List title="Security controls" items={def.security.controls} />
        </>
      )}
      <List
        title="Ports"
        items={def.ports.map((p) => `${p.id} (${p.direction}): ${p.protocols.join(', ')}`)}
      />
    </article>
  );
}

export function ProtocolDocs({ def }: { def: ProtocolDef }) {
  const facts = [
    `OSI layer ${def.osiLayer}`,
    `${def.handshakeRtts} handshake RTT${def.handshakeRtts === 1 ? '' : 's'}`,
    `${def.perMessageOverheadBytes} B overhead per message`,
    def.encrypted ? 'encrypted' : 'not encrypted',
    def.multiplexing ? 'multiplexed' : 'one request at a time',
  ];
  return (
    <article
      aria-label={`${def.name} docs`}
      className="space-y-2 border-t border-slate-200 pt-2 first:border-0 first:pt-0 dark:border-slate-800"
    >
      <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{def.name}</h4>
      <p className="text-[11px] text-slate-500">{facts.join(' · ')}</p>
      <Para>{def.docs.summary}</Para>
      <List title="Handshake" items={def.docs.handshakeSteps} />
      <List title="Header fields" items={def.docs.headerFields} />
      <List title="Security notes" items={def.docs.securityNotes} />
    </article>
  );
}

export function ProviderDocs({ def }: { def: ProviderDef }) {
  return (
    <article aria-label={`${def.name} docs`} className="space-y-3">
      <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{def.name}</h4>
      <Para>{def.docs.summary}</Para>
      {def.docs.howItWorks !== '' && <Para title="How it works">{def.docs.howItWorks}</Para>}
      <List title="Trade-offs" items={def.docs.tradeoffs} />
    </article>
  );
}
