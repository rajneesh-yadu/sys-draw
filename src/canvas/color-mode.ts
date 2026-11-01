/**
 * S21: React Flow's colour mode follows the app theme, which the app sets as the `dark` class on
 * <html>. The canvas only reads that class (no dependency on the app's theme store).
 */
import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void): () => void {
  if (typeof MutationObserver === 'undefined') return () => {};
  const obs = new MutationObserver(onChange);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => obs.disconnect();
}

const snapshot = (): 'light' | 'dark' =>
  document.documentElement.classList.contains('dark') ? 'dark' : 'light';

export function useDocumentColorMode(): 'light' | 'dark' {
  return useSyncExternalStore(subscribe, snapshot, () => 'light');
}
