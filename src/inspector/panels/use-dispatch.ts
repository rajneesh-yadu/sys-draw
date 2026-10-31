import { useCallback } from 'react';
import { useBoardStoreApi, type BoardCommand } from '@/store';
import type { CommitResult } from '../form/SchemaForm';

/** Dispatch one command on the board store in context; returns the store's result. */
export function useDispatch(): (cmd: BoardCommand) => CommitResult {
  const api = useBoardStoreApi();
  return useCallback((cmd: BoardCommand) => api.getState().dispatch(cmd), [api]);
}
