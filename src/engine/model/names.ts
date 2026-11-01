import type { ProviderId } from '@/core';
import { componentDisplayName } from '@/registry';
import type { CompiledNode } from './types';

/** Provider product name of a compiled node ('DynamoDB'), else its generic name, else its defId. */
export function componentDisplayNameOf(node: CompiledNode, provider: ProviderId): string {
  return node.def ? componentDisplayName(node.def, provider) : node.defId;
}
