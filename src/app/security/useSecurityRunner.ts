import { useEffect } from 'react';
import type { SecurityStore } from '@/canvas';
import { registry } from '@/registry';
import { useBoardStoreApi } from '@/store';
import { startSecurityRunner } from './runner';

/** Keep the security overlay and threat review current while the shell is mounted (S16). */
export function useSecurityRunner(securityStore: SecurityStore): void {
  const boardStore = useBoardStoreApi();
  useEffect(() => {
    const runner = startSecurityRunner({ boardStore, securityStore, registry });
    return () => runner.dispose();
  }, [boardStore, securityStore]);
}
