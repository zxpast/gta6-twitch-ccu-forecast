// GTA VI launch-day Twitch forecast (gta6-twitch-ccu-forecast-01).
//
// Idea: hour 1 of a rolling-midnight console launch is a bad anchor for the
// rest of the day on its own — most of the world has not unlocked yet (US East
// unlocks in hour 6, US West in hour 9), so viewership climbs steeply into
// the US afternoon and only then fades. Persistence (the house baseline)
// misses that whole shape.
//
// This program therefore learns the shape from the case's own comparables:
// for every past launch it takes the log-ratio ln(viewers_h / viewers_1) of
// each release-day hour h to that launch's hour-1 print, then forecasts GTA
// VI's hour h as the hour-1 print times the robust centre of those ratios,
// with a spread from how much the launches disagree at that hour.
//
// Not every comparable is a useful analogue. Launches with one simultaneous
// global unlock, or with days of early access before the "release" day, have
// release-day curves that look nothing like a rolling-midnight console
// launch (in leave-one-out tests over the kit's comparables, pooling them
// roughly doubles the loss). So the pool is tiered and the program takes the
// tightest tier that still has enough launches:
//   A: unlock text says "midnight local", not early-access-contaminated,
//      not tier-weak, and hour-1 print >= 50,000 viewers;
//   B: midnight local, not early-access-contaminated, not tier-weak;
//   C: not early-access-contaminated, not tier-weak;
//   D: every comparable with a usable release day.
// A launch is usable when its hour-1 print exists and is >= 100 viewers and
// at least 20 of its 24 release-day hours are present (SullyGnome samples
// small categories sparsely, so a few missing hours are tolerated).
//
// Per hour, the centre is the 10%-trimmed mean of the pool's log-ratios,
// shrunk 15% toward persistence (0), and the log spread is the pool's
// interquartile range / 1.349, floored at 0.10 and scaled by 1.2. The five
// quantiles are the lognormal quantiles around that centre. Those three
// numbers (0.85 shrink, 1.2 spread scale, tiered pool) were picked by
// leave-one-out pinball-loss tests over the kit's comparables: on
// midnight-local launches the model scores ~0.32 vs ~0.36 for persistence,
// and on big (hour-1 >= 100k) launches ~0.26 vs ~0.26 — it beats the
// baseline where the shape is predictable and ties it where it is not.
// A rejected refinement, kept as a note so nobody re-tries it blindly: the
// pool was also tested without launches whose unlock text mentions a
// simultaneous PC unlock (Elden Ring, Cyberpunk 2077 — their hour-1 prints
// already contain PC viewers, so their curves look flat). Dropping them made
// leave-one-out WORSE on both test sets (midnight launches 0.337 vs 0.322,
// big launches 0.332 vs 0.256), so they stay in the pool: big launches'
// ratios are genuinely more modest than small launches', and the flat curves
// carry that information.
//
// Deterministic: no randomness, no clock, no network, no environment reads
// besides the two MAKEFUN_* directory variables. Every *.in file in the
// input directory is read in name order and one *.out written per case; a
// case that cannot be read still gets a persistence fallback output, so a
// run never produces a missing file.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** Quantile levels the contest scores, in row order. */
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
/** Standard normal quantiles at those levels. */
const Z = [-1.645, -0.674, 0, 0.674, 1.645];
/** Shrinkage of the pooled log-ratio centre toward persistence (0). */
const SHRINK = 0.85;
/** Multiplier on the IQR-based log spread. */
const SPREAD_SCALE = 1.2;
/** Smallest log spread allowed for any hour. */
const SIGMA_FLOOR = 0.1;
/** Largest log spread allowed for any hour (keeps tails sane). */
const SIGMA_CAP = 1.5;
/** Centre clamp, in log units, against wild extrapolation. */
const CENTRE_CAP = 2.5;
/** A pool tier must hold at least this many launches to be used. */
const MIN_POOL = 8;
/** A comparable's hour-1 print must be at least this many viewers. */
const MIN_HOUR1 = 100;
/** A comparable's release day must have at least this many hours present. */
const MIN_DAY_HOURS = 20;
/** Tier A additionally requires an hour-1 print this large. */
const TIER_A_MIN_HOUR1 = 50000;
/** Fallback spread (the house baseline's) when a case has no usable pool. */
const FALLBACK_SIGMA = 0.15;

interface HourRow {
  hour: number;
  viewers: number;
}

interface Comparable {
  name: string;
  day_start: string;
  unlock?: string;
  hourly: Array<{ from: string; viewers: number }>;
}

interface CaseFile {
  levels: number[];
  known: HourRow[];
  forecast: Array<{ hour: number }>;
  comparables: Comparable[];
}

/** x rounded to 2 decimals (half up). */
const round2 = (x: number): number => Math.round(x * 100) / 100;

/** Interpolated quantile of an ascending array. */
function quantileOf(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Mean of xs after dropping the lowest and highest 10% (at least the median for tiny samples). */
function trimmedMean(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const k = Math.floor(s.length / 10);
  const core = k > 0 && s.length - 2 * k > 0 ? s.slice(k, s.length - k) : s;
  return core.reduce((a, b) => a + b, 0) / core.length;
}

/**
 * A comparable's 24 release-day hourly viewer counts, hour 1 first, with
 * null for hours SullyGnome did not sample. Returns null when the launch
 * has no usable release day at all.
 */
function releaseDay(comp: Comparable): Array<number | null> | null {
  const start = Date.parse(comp.day_start);
  if (Number.isNaN(start)) return null;
  const byHour = new Map<number, number>();
  for (const row of comp.hourly ?? []) {
    const t = Date.parse(row.from);
    if (Number.isNaN(t) || typeof row.viewers !== 'number' || row.viewers <= 0) continue;
    const h = Math.round((t - start) / 3_600_000);
    if (h >= 0 && h < 24 && !byHour.has(h)) byHour.set(h, row.viewers);
  }
  const hours: Array<number | null> = [];
  for (let h = 0; h < 24; h++) hours.push(byHour.get(h) ?? null);
  const first = hours[0];
  if (first === null || first < MIN_HOUR1) return null;
  if (hours.filter((v) => v !== null).length < MIN_DAY_HOURS) return null;
  return hours;
}

/** Which analogue tier a usable comparable belongs to (A tightest, D widest). */
function tierOf(comp: Comparable, hour1: number): string {
  const note = (comp.unlock ?? '').toLowerCase();
  const clean = !note.includes('early-access-contaminated') && !note.includes('tier: weak');
  const midnight = note.includes('midnight local');
  if (midnight && clean && hour1 >= TIER_A_MIN_HOUR1) return 'A';
  if (midnight && clean) return 'B';
  if (clean) return 'C';
  return 'D';
}

/** The tightest tier holding at least MIN_POOL launches, else the largest tier available. */
function pickPool(days: Array<{ tier: string; hours: Array<number | null> }>): Array<{ tier: string; hours: Array<number | null> }> {
  const order = ['A', 'B', 'C', 'D'];
  for (const want of order) {
    const tier = days.filter((d) => d.tier === want);
    if (tier.length >= MIN_POOL) return tier;
  }
  // No tier is big enough: pool every tier up to the largest one available.
  for (const want of order) {
    const tier = days.filter((d) => d.tier === want);
    if (tier.length > 0) {
      const upto = order.slice(0, order.indexOf(want) + 1);
      return days.filter((d) => upto.includes(d.tier));
    }
  }
  return days;
}

/** Five quantiles for one hour, from the pooled log-ratios of that hour. */
function hourQuantiles(p1: number, h: number, ratios: number[]): number[] {
  let centre = 0;
  let sigma = FALLBACK_SIGMA * Math.sqrt(h - 1);
  if (ratios.length >= 3) {
    const sorted = [...ratios].sort((a, b) => a - b);
    centre = Math.max(-CENTRE_CAP, Math.min(CENTRE_CAP, trimmedMean(sorted)));
    const iqr = quantileOf(sorted, 0.75) - quantileOf(sorted, 0.25);
    sigma = Math.max(SIGMA_FLOOR, Math.min(SIGMA_CAP, (iqr / 1.349) * SPREAD_SCALE));
  }
  const qs = Z.map((z) => p1 * Math.exp(centre * SHRINK + z * sigma));
  // Clamp to the contest's bounds and keep the row non-decreasing.
  let prev = 1;
  return qs.map((q) => {
    const v = round2(Math.max(1, Math.min(1e9, q)));
    const out = Math.max(prev, v);
    prev = out;
    return out;
  });
}

/** Forecast one case: 23 rows, hours 2..24. Never throws. */
function forecastCase(c: CaseFile): Array<{ hour: number; q: number[] }> {
  const first = (c.known ?? []).find((k) => k.hour === 1);
  const p1 = Math.max(1, first !== undefined && typeof first.viewers === 'number' ? first.viewers : 1);
  const days: Array<{ tier: string; hours: Array<number | null> }> = [];
  for (const comp of c.comparables ?? []) {
    const hours = releaseDay(comp);
    if (hours === null) continue;
    days.push({ tier: tierOf(comp, hours[0] as number), hours });
  }
  const pool = pickPool(days);
  // Log-ratios ln(viewers_h / viewers_1) per hour, pooled across the pool.
  const ratiosByHour = new Map<number, number[]>();
  for (let h = 2; h <= 24; h++) {
    const ratios: number[] = [];
    for (const d of pool) {
      const v = d.hours[h - 1];
      const v1 = d.hours[0];
      if (v !== null && v1 !== null && v > 0 && v1 > 0) ratios.push(Math.log(v / v1));
    }
    ratiosByHour.set(h, ratios);
  }
  const hours = (c.forecast ?? []).map(({ hour }) => ({
    hour,
    q: hourQuantiles(p1, hour, ratiosByHour.get(hour) ?? []),
  }));
  // The contest always asks for hours 2..24; fill any gap defensively.
  const seen = new Set(hours.map((r) => r.hour));
  for (let h = 2; h <= 24; h++) {
    if (!seen.has(h)) hours.push({ hour: h, q: hourQuantiles(p1, h, ratiosByHour.get(h) ?? []) });
  }
  hours.sort((a, b) => a.hour - b.hour);
  return hours;
}

/** Persistence fallback (house baseline shape) for an unreadable case file. */
function fallbackHours(p1: number): Array<{ hour: number; q: number[] }> {
  const hours = [];
  for (let h = 2; h <= 24; h++) {
    const qs = Z.map((z) => round2(Math.max(1, p1 * Math.exp(z * FALLBACK_SIGMA * Math.sqrt(h - 1)))));
    hours.push({ hour: h, q: qs });
  }
  return hours;
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  let hours: Array<{ hour: number; q: number[] }>;
  try {
    const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as CaseFile;
    if (!Array.isArray(c.levels) || c.levels.length !== LEVELS.length || c.levels.some((t, j) => t !== LEVELS[j])) {
      throw new Error(`${file} asks for unexpected levels`);
    }
    hours = forecastCase(c);
  } catch {
    // Never leave a case without an output: persist hour 1 (or 1 viewer).
    let p1 = 1;
    try {
      const raw = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as CaseFile;
      const first = (raw.known ?? []).find((k) => k.hour === 1);
      if (first !== undefined && typeof first.viewers === 'number' && first.viewers > 0) p1 = first.viewers;
    } catch {
      p1 = 1;
    }
    hours = fallbackHours(p1);
  }
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ hours })}\n`);
}
