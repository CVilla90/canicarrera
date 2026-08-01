/**
 * "How long am I willing to wait?" instead of "what settings should I pick?"
 *
 * Asking a user to choose between 1440p60/Alto and 1080p60/Ultra is asking them
 * to do arithmetic with a benchmark they have not seen. Asking how long they
 * will wait is a question they can actually answer, and it is the one they
 * really care about. So the budget is the control and the settings are the
 * *output* — the richest combination this machine can finish inside the wait.
 *
 * The manual overrides in the advanced panel stay, because someone who wants
 * 4K and does not care that it takes four minutes is entitled to it. This just
 * means nobody has to open that panel to get a good answer.
 *
 * ## The ladder
 *
 * The order below is a taste judgement, deliberately written as a plain list so
 * it can be re-ordered without touching a line of logic. The judgement is:
 * **past 1080p, shading beats pixels.** A marble race is glass, glow and
 * motion; 4K of flat shading looks worse on YouTube than 1080p with bloom,
 * reflections and real motion blur — and it is a much bigger file. So the
 * ladder climbs to 1080p60 first, spends the next budget on visual presets, and
 * only reaches for more pixels once Ultra is already affordable.
 */
import { qualityById, pixelFactor, type Quality } from '../export/quality.ts';
import {
  presetById,
  drawCost,
  DEFAULT_PRESET_ID,
  type PresetId,
  type RenderPreset,
} from './presets.ts';
import { exportSeconds, type Throughput } from './cost.ts';

export interface RenderPlan {
  qualityId: string;
  presetId: PresetId;
}

/**
 * The slice of `Capability` the planner actually reads.
 *
 * Structural on purpose: a real `Capability` satisfies it, and so does an
 * object literal in a test. That keeps this module free of every import the
 * encoder needs, which is what lets `npm test` cover the planning logic in node
 * instead of only ever exercising it in a browser nobody is watching.
 */
export interface PlanCapability {
  supported: string[];
  postFX: boolean;
  benchmark: Throughput | null;
}

/** Worst to best. `planForBudget` walks it from the top down. */
export const LADDER: RenderPlan[] = [
  { qualityId: '720p30', presetId: 'ligero' },
  { qualityId: '720p30', presetId: 'estandar' },
  { qualityId: '1080p30', presetId: 'estandar' },
  { qualityId: '1080p60', presetId: 'estandar' },
  { qualityId: '1080p60', presetId: 'alto' },
  { qualityId: '1080p60', presetId: 'ultra' },
  { qualityId: '1440p60', presetId: 'ultra' },
  { qualityId: '2160p60', presetId: 'ultra' },
];

export interface Budget {
  id: string;
  seconds: number;
  label: { es: string; en: string };
}

/**
 * Three answers, not a slider.
 *
 * A slider implies the user knows what 37 seconds buys. These are named after
 * the intent instead, and the panel prints the resulting settings and the real
 * ETA underneath, so the abstraction is never load-bearing.
 */
export const BUDGETS: Budget[] = [
  { id: 'rapido', seconds: 10, label: { es: 'Rápido', en: 'Fast' } },
  { id: 'equilibrado', seconds: 30, label: { es: 'Equilibrado', en: 'Balanced' } },
  { id: 'maxima', seconds: 120, label: { es: 'Máxima calidad', en: 'Best quality' } },
];

export const DEFAULT_BUDGET_ID = 'equilibrado';

export const budgetById = (id: string): Budget =>
  BUDGETS.find((b) => b.id === id) ?? BUDGETS[1];

export const framesFor = (quality: Quality, videoDuration: number): number =>
  Math.max(1, Math.round(videoDuration * quality.fps));

/** Seconds this machine needs for one ladder rung, or null if unmeasured. */
export function planSeconds(
  capability: PlanCapability,
  plan: RenderPlan,
  videoDuration: number,
): number | null {
  const quality = qualityById(plan.qualityId);
  const preset = presetById(plan.presetId);
  return exportSeconds(
    capability.benchmark,
    pixelFactor(quality),
    drawCost(preset),
    framesFor(quality, videoDuration),
  );
}

/** A rung is only offered if the browser can encode it and can run its preset. */
export function planIsAvailable(capability: PlanCapability, plan: RenderPlan): boolean {
  if (!capability.supported.includes(plan.qualityId)) return false;
  const preset = presetById(plan.presetId);
  if (!capability.postFX && requiresPostFX(preset)) return false;
  return true;
}

export const requiresPostFX = (preset: RenderPreset): boolean =>
  preset.bloom || preset.supersample > 1 || preset.motionBlur > 1;

/**
 * The richest rung that finishes inside `budgetSeconds`.
 *
 * Falls back to the cheapest *available* rung rather than the cheapest rung, so
 * a machine that cannot run post-processing still gets a working answer instead
 * of a plan it will fail to execute.
 */
export function planForBudget(
  capability: PlanCapability,
  videoDuration: number,
  budgetSeconds: number,
): RenderPlan {
  const available = LADDER.filter((plan) => planIsAvailable(capability, plan));
  const cheapest = available[0] ?? LADDER[0];

  // With no measurement we cannot promise a time, so resolution stays at the
  // rung that works everywhere. The PRESET is a different question: it also
  // drives the live preview the user is looking at *right now*, and dropping
  // that to the cheapest tier would make an unmeasured machine — anyone who
  // opened the link in a background tab, since the probe refuses to run
  // hidden — permanently see a worse-looking app than the one we built.
  // `estandar` is the tier the benchmark itself runs at, so it is the honest
  // definition of normal.
  if (!capability.benchmark) {
    return available.find((plan) => plan.presetId === DEFAULT_PRESET_ID) ?? cheapest;
  }

  for (let i = available.length - 1; i >= 0; i--) {
    const seconds = planSeconds(capability, available[i], videoDuration);
    if (seconds !== null && seconds <= budgetSeconds) return available[i];
  }
  return cheapest;
}
