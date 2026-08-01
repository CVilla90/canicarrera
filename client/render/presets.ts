/**
 * Render presets — the SECOND quality axis.
 *
 * `export/quality.ts` owns the video *format* (resolution, fps, bitrate). This
 * file owns how good each frame *looks*. They are independent on purpose: 4K of
 * flat shading and 720p of full shading are both legitimate choices, and which
 * one someone wants depends on where the video is going.
 *
 * Three rules hold this file together:
 *
 *   1. **A preset can never touch the simulation.** Nothing here is an input to
 *      `RaceSpec`, `RaceSim` or curation. Same seed renders the same race on a
 *      phone and on a workstation; only the pixels differ. That is what keeps
 *      share links honest and `SIM_VERSION` still at 1.
 *   2. **Everything is data.** Adding, retuning or deleting a preset is an edit
 *      to the array below. No other file enumerates them.
 *   3. **Nothing costs us anything.** Every technique here runs on the user's
 *      GPU. The server bill does not move when someone picks Ultra.
 *
 * Two of these techniques are only possible because export is *offline* — it
 * has no clock and can take as long as it likes per frame. Supersampling and
 * accumulation motion blur are what a real renderer does and what a realtime
 * game cannot afford. That is the whole reason the exported MP4 can look better
 * than the live preview.
 */

export type PresetId = 'ligero' | 'estandar' | 'alto' | 'ultra';

export interface RenderPreset {
  id: PresetId;
  /** Shown in the UI. */
  label: { es: string; en: string };
  /** One line on what you get. */
  blurb: { es: string; en: string };

  // ---- scene features (apply to live playback AND export)
  /** Bloom. The single cheapest thing that makes glass read as glass. */
  bloom: boolean;
  /** Image-based lighting from a procedural environment. Marbles gain reflections. */
  env: boolean;
  /** Physical marble material: clearcoat + low roughness instead of flat standard. */
  glossyMarbles: boolean;

  // ---- export-only luxuries (impossible in realtime, free offline)
  /** Linear supersampling factor. 2 means render 4x the pixels and downsample. */
  supersample: number;
  /** Sub-frames accumulated per output frame. 1 disables motion blur. */
  motionBlur: number;

  /**
   * Draw cost relative to `estandar`, before supersampling and motion blur are
   * applied. Measured-ish: bloom is roughly a third of a frame on the machines
   * this was tuned on, the physical material rather less.
   */
  sceneCost: number;
}

export const PRESETS: RenderPreset[] = [
  {
    id: 'ligero',
    label: { es: 'Ligero', en: 'Light' },
    blurb: { es: 'Lo más rápido. Pensado para teléfonos.', en: 'Fastest. Built for phones.' },
    bloom: false,
    env: false,
    glossyMarbles: false,
    supersample: 1,
    motionBlur: 1,
    sceneCost: 0.85,
  },
  {
    id: 'estandar',
    label: { es: 'Estándar', en: 'Standard' },
    blurb: { es: 'Brillo y reflejos. El equilibrio.', en: 'Bloom and reflections. The balance.' },
    bloom: true,
    env: true,
    glossyMarbles: false,
    supersample: 1,
    motionBlur: 1,
    sceneCost: 1,
  },
  {
    id: 'alto',
    label: { es: 'Alto', en: 'High' },
    blurb: {
      es: 'Canicas de vidrio pulido y bordes suaves.',
      en: 'Polished glass marbles and smooth edges.',
    },
    bloom: true,
    env: true,
    glossyMarbles: true,
    supersample: 2,
    motionBlur: 2,
    sceneCost: 1.35,
  },
  {
    id: 'ultra',
    label: { es: 'Ultra', en: 'Ultra' },
    blurb: {
      es: 'Desenfoque de movimiento de cine. Lento a propósito.',
      en: 'Cinematic motion blur. Deliberately slow.',
    },
    bloom: true,
    env: true,
    glossyMarbles: true,
    supersample: 2,
    motionBlur: 4,
    sceneCost: 1.35,
  },
];

/**
 * What the capability probe measures against.
 *
 * The benchmark always runs at this preset and the cost model extrapolates to
 * the others, so changing preset never forces a re-measurement — and one slow
 * measurement cannot poison every ETA on the panel.
 */
export const BASELINE_PRESET_ID: PresetId = 'estandar';

export const DEFAULT_PRESET_ID: PresetId = 'estandar';

export const presetById = (id: string): RenderPreset =>
  PRESETS.find((p) => p.id === id) ?? PRESETS[1];

export const baselinePreset = (): RenderPreset => presetById(BASELINE_PRESET_ID);

/**
 * Per-frame draw cost relative to the baseline measurement.
 *
 * Supersampling is quadratic (it is a linear scale on both axes) and motion
 * blur is linear (it is N full draws averaged together). Both multiply the
 * *draw*, never the encode — the encoder still sees exactly one frame per
 * output frame, which is why `estimateSeconds` splits the two.
 */
export function drawCost(preset: RenderPreset): number {
  return preset.sceneCost * preset.supersample * preset.supersample * preset.motionBlur;
}

/** True when this preset needs the post-processing pipeline at all. */
export const needsPostFX = (preset: RenderPreset, forExport: boolean): boolean =>
  preset.bloom || (forExport && (preset.supersample > 1 || preset.motionBlur > 1));
