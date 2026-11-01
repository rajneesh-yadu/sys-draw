/**
 * "Latency numbers every engineer should know" — the classic orders of magnitude popularised by
 * Jeff Dean and Peter Norvig (circa 2010 hardware). Exact values drift with hardware (SSDs and
 * networks are faster today); the ratios between rows are the lesson.
 */

export interface LatencyNumber {
  id: string;
  label: string;
  ns: number;
  /** What the number teaches. */
  hint?: string;
}

/** The unit `humanScale` maps to one second. */
export const L1_REFERENCE_NS = 0.5;

export const LATENCY_NUMBERS: readonly LatencyNumber[] = [
  { id: 'l1', label: 'L1 cache reference', ns: L1_REFERENCE_NS },
  { id: 'branch', label: 'Branch mispredict', ns: 5 },
  { id: 'l2', label: 'L2 cache reference', ns: 7, hint: '14× L1' },
  { id: 'mutex', label: 'Mutex lock/unlock', ns: 25 },
  { id: 'ram', label: 'Main memory reference', ns: 100, hint: '200× L1' },
  { id: 'compress', label: 'Compress 1 KB (Snappy)', ns: 3_000 },
  { id: 'net1k', label: 'Send 1 KB over 1 Gbps network', ns: 10_000 },
  { id: 'ssdRandom', label: 'Read 4 KB randomly from SSD', ns: 150_000 },
  { id: 'ram1m', label: 'Read 1 MB sequentially from memory', ns: 250_000 },
  {
    id: 'dcRtt',
    label: 'Round trip within the same datacenter',
    ns: 500_000,
    hint: 'A cache hit over the network costs about this',
  },
  { id: 'ssd1m', label: 'Read 1 MB sequentially from SSD', ns: 1_000_000, hint: '4× memory' },
  { id: 'seek', label: 'Disk seek', ns: 10_000_000 },
  { id: 'disk1m', label: 'Read 1 MB sequentially from disk', ns: 20_000_000, hint: '80× memory' },
  {
    id: 'transatlantic',
    label: 'Packet California → Netherlands → California',
    ns: 150_000_000,
    hint: 'Speed of light: cross-ocean round trips dominate',
  },
];

/** Handy conversions for estimating in your head. */
export const ESTIMATION_RULES: readonly { label: string; value: string }[] = [
  { label: 'Seconds per day', value: '86 400 ≈ 10⁵' },
  { label: '1M requests/day', value: '≈ 12 rps' },
  { label: '1 rps sustained', value: '≈ 2.6M requests/month' },
  { label: '2¹⁰ / 2²⁰ / 2³⁰ / 2⁴⁰', value: '≈ thousand / million / billion / trillion' },
  { label: '1 Gbps', value: '125 MB/s' },
];

/** 0.5 → "0.5 ns", 150 000 → "150 µs", 1.5e8 → "150 ms". */
export function formatNs(ns: number): string {
  const t = (v: number) => Number(v.toPrecision(3)).toString();
  if (ns >= 1e9) return `${t(ns / 1e9)} s`;
  if (ns >= 1e6) return `${t(ns / 1e6)} ms`;
  if (ns >= 1e3) return `${t(ns / 1e3)} µs`;
  return `${t(ns)} ns`;
}

/**
 * The same delay if an L1 reference (0.5 ns) took one second — makes the gaps tangible:
 * memory ≈ 3 min, a datacenter round trip ≈ 12 days, a trans-Atlantic round trip ≈ 9.5 years.
 */
export function humanScale(ns: number): string {
  const sec = ns / L1_REFERENCE_NS;
  const t = (v: number) => Number(v.toPrecision(2)).toString();
  if (sec < 60) return `${t(sec)} s`;
  if (sec < 3_600) return `${t(sec / 60)} min`;
  if (sec < 86_400) return `${t(sec / 3_600)} h`;
  if (sec < 86_400 * 365) return `${t(sec / 86_400)} days`;
  return `${t(sec / (86_400 * 365))} years`;
}

const MIN_LOG = Math.log10(Math.min(...LATENCY_NUMBERS.map((l) => l.ns)));
const MAX_LOG = Math.log10(Math.max(...LATENCY_NUMBERS.map((l) => l.ns)));

/** Bar width in % on a log scale, never thinner than 2%. */
export function latencyBarPercent(ns: number): number {
  const t = (Math.log10(ns) - MIN_LOG) / (MAX_LOG - MIN_LOG);
  return Math.max(2, Math.round(t * 100));
}
