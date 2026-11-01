/**
 * Order statistics of exponential service times — the latency of "wait for k of n replicas".
 * For n iid Exp(mean S), the k-th fastest answer arrives on average after
 *   E[X(k:n)] = S × Σ_{i=n−k+1..n} 1/i
 * (the gaps between successive arrivals are Exp(S/n), Exp(S/(n−1)), …). Examples, S = 1:
 *   1 of 3 → 1/3; 2 of 3 → 1/3 + 1/2 = 0.833; 3 of 3 → 1.833 (the slowest of three).
 */
export function kthOfN(k: number, n: number, meanMs = 1): number {
  const N = Math.max(0, Math.round(n));
  const K = Math.min(N, Math.max(0, Math.round(k)));
  let sum = 0;
  for (let i = N - K + 1; i <= N; i++) sum += 1 / i;
  return meanMs * sum;
}

/** Waiting for ALL n parallel calls (scatter-gather): E[max] = S × H_n. */
export function maxOfN(n: number, meanMs = 1): number {
  return kthOfN(n, n, meanMs);
}

/** Consistency level → replica count for a replication factor N. */
export function replicasFor(level: string | undefined, n: number): number {
  const N = Math.max(1, Math.round(n));
  switch (level) {
    case 'ONE':
      return 1;
    case 'TWO':
      return Math.min(2, N);
    case 'THREE':
      return Math.min(3, N);
    case 'ALL':
      return N;
    case 'QUORUM':
    case 'LOCAL_QUORUM':
    default:
      return Math.floor(N / 2) + 1;
  }
}
