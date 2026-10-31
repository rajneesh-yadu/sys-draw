import { DynamicIcon, iconNames, type IconName } from 'lucide-react/dynamic';

const KNOWN = new Set<string>(iconNames);

/** Renders a registry `icon` (a lucide icon name); unknown names fall back to a box. */
export function RegistryIcon({ name, className }: { name: string; className?: string }) {
  const icon = (KNOWN.has(name) ? name : 'box') as IconName;
  return <DynamicIcon name={icon} className={className} aria-hidden="true" size={18} />;
}
