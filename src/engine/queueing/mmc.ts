/**
 * M/M/c queueing (ENGINE.md → Formulas). Rates are per second, times returned in ms.
 *   ρ = λ / (c μ)        Wq = C(c, a) / (c μ − λ)        T = Wq + 1/μ        a = λ/μ
 */

/** Erlang B blocking probability via the stable recursion B(k) = a·B(k−1) / (k + a·B(k−1)). */
export function erlangB(c: number, a: number): number {
  if (a <= 0) return 0;
  let b = 1;
  for (let k = 1; k <= c; k++) {
    b = (a * b) / (k + a * b);
    // Past the offered load B only shrinks; once negligible the rest of the loop changes nothing
    // that matters (keeps 50 000-server load balancers cheap).
    if (k > a && b < 1e-16) return b;
  }
  return b;
}

/** Erlang C: probability an arrival waits, for c servers and offered load a = λ/μ < c. */
export function erlangC(c: number, a: number): number {
  if (a <= 0) return 0;
  const rho = a / c;
  if (rho >= 1) return 1;
  const b = erlangB(c, a);
  return b / (1 - rho * (1 - b));
}

export interface MmcResult {
  rho: number;
  /** Erlang C(c, a). */
  waitProbability: number;
  /** Mean wait in queue (ms); Infinity when unstable. */
  wqMs: number;
  /** Mean number waiting, Lq = λ·Wq. */
  lq: number;
  /** Mean response time T = Wq + 1/μ (ms). */
  tMs: number;
  stable: boolean;
}

export function mmc(lambda: number, mu: number, c: number): MmcResult {
  const serviceMs = 1000 / mu;
  if (lambda <= 0) {
    return { rho: 0, waitProbability: 0, wqMs: 0, lq: 0, tMs: serviceMs, stable: true };
  }
  const a = lambda / mu;
  const rho = a / c;
  if (rho >= 1) {
    return { rho, waitProbability: 1, wqMs: Infinity, lq: Infinity, tMs: Infinity, stable: false };
  }
  const C = erlangC(c, a);
  const wqSec = C / (c * mu - lambda);
  return {
    rho,
    waitProbability: C,
    wqMs: wqSec * 1000,
    lq: lambda * wqSec,
    tMs: wqSec * 1000 + serviceMs,
    stable: true,
  };
}

/** ln(1/(1−q)): the q-quantile of an exponential with mean 1 (p99 ≈ T × ln 100). */
export function expQuantileFactor(q: number): number {
  return Math.log(1 / (1 - q));
}
