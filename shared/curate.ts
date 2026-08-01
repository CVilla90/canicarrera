/**
 * Pre-sim curation — the highest-value thing the server does (PLAN §2.1).
 *
 * Rendering is a commodity; taste is not. Because a race costs a few
 * milliseconds to simulate headlessly, the server can run twenty of them,
 * measure what actually happened, and hand back the one worth watching. The
 * user never picks "race quality" — nobody chooses a boring race.
 */
import { generateSpec, type GenerateOptions } from './generator.ts';
import { simulate, type SimSummary } from './sim.ts';
import { remap } from './vec3.ts';
import type { RaceMetrics, RaceSpec } from './spec.ts';

/** What a good race looks like, as numbers. Tuned by hand; later, by data. */
export const TASTE = {
  /** Hard window. Outside this the race is rejected unless nothing else scores. */
  durationMin: 38,
  durationMax: 82,
  /** Full marks inside this band. */
  durationIdeal: [46, 72] as const,
  /** A photo finish. Seconds. */
  marginIdeal: 0.5,
  marginBad: 3,
  /** Below this, the race was a procession. */
  leadChangesIdeal: 4,
  /** Above this it is noise, not drama. */
  leadChangesMax: 16,
  /** Fraction of the race the winner led. Above this it is a runaway. */
  runawayThreshold: 0.8,
  /** Seconds between first and last. A long tail is dead air. */
  spreadBad: 16,
} as const;

export interface Scored {
  score: number;
  parts: Record<string, number>;
}

/** 0-1. The weights here are the product's opinion, and the thing Stage 2b learns. */
export function scoreRace(m: RaceMetrics): Scored {
  const parts: Record<string, number> = {};

  parts.duration =
    m.duration < TASTE.durationIdeal[0]
      ? remap(m.duration, TASTE.durationMin - 8, TASTE.durationIdeal[0], 0, 1)
      : remap(m.duration, TASTE.durationIdeal[1], TASTE.durationMax + 8, 1, 0);

  parts.margin = remap(m.finishMargin, TASTE.marginBad, TASTE.marginIdeal, 0, 1);

  parts.leadChanges =
    m.leadChanges <= TASTE.leadChangesIdeal
      ? remap(m.leadChanges, 0, TASTE.leadChangesIdeal, 0.1, 1)
      : remap(m.leadChanges, TASTE.leadChangesIdeal, TASTE.leadChangesMax, 1, 0.45);

  parts.late = Math.min(m.lateChanges, 3) / 3;

  parts.runaway = remap(m.frontRunning, TASTE.runawayThreshold, 0.4, 0, 1);

  parts.spread = remap(m.spread, TASTE.spreadBad, 3, 0, 1);

  parts.complete = m.allFinished ? 1 : 0;

  const weighted =
    parts.duration * 0.2 +
    parts.margin * 0.24 +
    parts.leadChanges * 0.18 +
    parts.late * 0.12 +
    parts.runaway * 0.14 +
    parts.spread * 0.12;

  // A race where someone never crossed the line is broken, not merely dull.
  const score = parts.complete === 0 ? weighted * 0.15 : weighted;
  return { score, parts };
}

export interface Candidate {
  seed: string;
  spec: RaceSpec;
  summary: SimSummary;
  scored: Scored;
}

export interface CurationResult {
  best: Candidate;
  /** Every candidate's score, for telemetry. Specs are dropped to keep it small. */
  considered: { seed: string; score: number; duration: number; leadChanges: number }[];
  /** Milliseconds spent simulating. Watch this on a 1 vCPU box. */
  elapsedMs: number;
  /** True when curation was deliberately skipped (PLAN §2b exploration arm). */
  exploration: boolean;
}

export interface CurateOptions extends GenerateOptions {
  /** Seeds to try, in order. The first is used as-is when `exploration` is set. */
  seeds: string[];
  /** Skip scoring and take the first seed. Keeps the scorer from eating its own tail. */
  exploration?: boolean;
  /** Wall-clock budget. Stops early rather than risking a request timeout. */
  budgetMs?: number;
  now?: () => number;
}

export function curate(opts: CurateOptions): CurationResult {
  const now = opts.now ?? (() => Date.now());
  const started = now();
  const { seeds, exploration = false, budgetMs = 4000, ...generateOptions } = opts;
  if (seeds.length === 0) throw new Error('curate() needs at least one seed');

  const evaluate = (seed: string): Candidate => {
    const spec = generateSpec(seed, generateOptions);
    const summary = simulate(spec);
    return { seed, spec, summary, scored: scoreRace(summary.metrics) };
  };

  if (exploration) {
    const only = evaluate(seeds[0]);
    return {
      best: only,
      considered: [
        {
          seed: only.seed,
          score: only.scored.score,
          duration: only.summary.metrics.duration,
          leadChanges: only.summary.metrics.leadChanges,
        },
      ],
      elapsedMs: now() - started,
      exploration: true,
    };
  }

  let best: Candidate | null = null;
  const considered: CurationResult['considered'] = [];

  for (const seed of seeds) {
    const candidate = evaluate(seed);
    considered.push({
      seed,
      score: candidate.scored.score,
      duration: candidate.summary.metrics.duration,
      leadChanges: candidate.summary.metrics.leadChanges,
    });
    if (!best || candidate.scored.score > best.scored.score) best = candidate;
    // A near-perfect race is worth stopping for; so is running out of time.
    if (best.scored.score > 0.92) break;
    if (now() - started > budgetMs) break;
  }

  return { best: best!, considered, elapsedMs: now() - started, exploration: false };
}
