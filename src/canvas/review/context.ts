/** React access to the canvas's review store (created by CanvasProvider, filled by the app). */
import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import { createReviewStore, type ReviewState, type ReviewStore } from './review-store';

export const ReviewStoreContext = createContext<ReviewStore | null>(null);

/** Used when a component renders outside CanvasProvider (isolated tests): never opens. */
const INERT = createReviewStore();

export function useReviewStoreApi(): ReviewStore {
  return useContext(ReviewStoreContext) ?? INERT;
}

export function useReviewStore<T>(selector: (s: ReviewState) => T): T {
  return useStore(useReviewStoreApi(), selector);
}
