/**
 * What can this machine actually do? (PLAN §2.3-2.4, W7)
 *
 * Never gate on user-agent. Two browsers with the same UA string can differ by
 * a GPU driver, and the support matrix changes under you. We ask the browser
 * whether it can encode, then we MEASURE the real scene — the translucent tube
 * is the expensive part, so a synthetic triangle benchmark would tell us
 * nothing useful.
 *
 * The measurement is not a proxy for the ETA. Export runs offline, as fast as
 * the machine allows, so measured seconds-per-frame times frame count IS the
 * ETA. That is what goes on the button.
 *
 * ## Two numbers, not one
 *
 * `rasterFps` (draw only) and `pipelineFps` (draw + encode + mux) are both
 * measured, and the difference between them is the encoder's share of a frame.
 * That split is what makes the render presets estimable: supersampling and
 * motion blur multiply the DRAW and leave the encode alone, because the encoder
 * still receives exactly one frame per output frame however many sub-frames
 * were averaged to make it. Charging preset cost to the whole pipeline would
 * over-estimate Ultra badly on machines with slow software encoders.
 */
import type { RaceScene } from '../scene/RaceScene.ts';
import { WebCodecsEncoder, hasWebCodecs, pickCodec } from './encoder.ts';
import { QUALITIES, qualityById, pixelFactor, type Quality } from './quality.ts';
import {
  PRESETS,
  baselinePreset,
  drawCost,
  needsPostFX,
  type RenderPreset,
} from '../render/presets.ts';
import { exportSeconds, resolveDrawCost } from '../render/cost.ts';

export { pixelFactor };

/** Tier A/B still export for free; C is slow but free; only D would cost us. */
export type Tier = 'A' | 'B' | 'C' | 'D';

export interface Benchmark {
  /** Draw-only throughput at 1920x1080, baseline preset, frames per second. */
  rasterFps: number;
  /** Full draw -> VideoFrame -> encode -> mux throughput at the same settings. */
  pipelineFps: number;
  /** Measured draw cost per preset id, relative to the baseline preset. */
  presetCost?: Record<string, number>;
  measuredAt: number;
}

export interface Capability {
  tier: Tier;
  webCodecs: boolean;
  codec: string | null;
  hardwareAccelerated: boolean;
  /** Quality ids the browser confirmed it can configure. */
  supported: string[];
  /** Can this GPU render into a half-float target? Gates every preset above Ligero. */
  postFX: boolean;
  benchmark: Benchmark | null;
  /** Spanish, shown to the user when it matters. */
  note: string | null;
}

// v2: measurements became relative to a known baseline preset.
// v3: added measured per-preset draw cost. A v2 entry still works — the cost
//     model falls back to the static guess — but it is worth retaking once.
const CACHE_KEY = 'canicarrera.capability.v3';

/**
 * Seconds this machine needs to export `frames` frames at `quality` + `preset`.
 *
 * draw scales with pixels AND preset cost; encode scales with pixels only.
 */
export function estimateSeconds(
  capability: Capability,
  quality: Quality,
  preset: RenderPreset,
  frames: number,
): number | null {
  const cost = resolveDrawCost(
    preset.id,
    drawCost(preset),
    capability.benchmark?.presetCost,
  );
  return exportSeconds(capability.benchmark, pixelFactor(quality), cost, frames);
}

function tierFor(webCodecs: boolean, hardware: boolean, pipelineFps: number): Tier {
  if (!webCodecs) return 'C';
  if (hardware && pipelineFps >= 25) return 'A';
  if (pipelineFps >= 8) return 'B';
  return 'C';
}

/**
 * Runs a real, small export and times it.
 *
 * Always measured at the BASELINE preset, whatever the user currently has
 * selected. The cost model extrapolates from there, so changing a setting never
 * silently invalidates the number on the button — and a single measurement
 * taken while Ultra happened to be selected cannot make every other row look
 * four times slower than it is.
 *
 * Deliberately destructive to the scene's sim state — it restarts the race
 * before and after, so the caller can run this immediately before the countdown
 * without the user seeing a jump.
 */
async function benchmarkScene(scene: RaceScene): Promise<Benchmark | null> {
  if (!scene.sim) return null;
  // Never measure a hidden tab. Browsers deprioritise GPU work there, so the
  // number would be wrong AND we would cache that wrong number for a month —
  // permanently recommending 720p to someone who opened the page in a
  // background tab.
  if (typeof document !== 'undefined' && document.hidden) return null;
  const reference = qualityById('1080p30');
  const codec = await pickCodec(reference);
  if (!codec) return null;

  const canvas = scene.renderer.domElement;
  const previousWidth = canvas.width;
  const previousHeight = canvas.height;
  const previousRatio = scene.renderer.getPixelRatio();
  const previousPreset = scene.renderPreset;

  scene.setRenderPreset(baselinePreset());
  scene.beginExportRender(1);
  scene.setPixelRatio(1);
  scene.setSize(reference.width, reference.height, false);
  scene.restart();

  try {
    // Warm-up: the first frames pay for shader compilation and buffer upload,
    // and counting those would make every machine look slower than it is.
    for (let i = 0; i < 6; i++) scene.renderFrameAt(i / 30, 1 / 30);

    const rasterFrames = 12;
    const rasterStart = performance.now();
    for (let i = 0; i < rasterFrames; i++) scene.renderFrameAt((6 + i) / 30, 1 / 30);
    const rasterFps = rasterFrames / ((performance.now() - rasterStart) / 1000);

    const encoder = await WebCodecsEncoder.create(reference);
    let frameIndex = 0;
    const pump = async (keyFrame: boolean): Promise<void> => {
      scene.renderFrameAt((18 + frameIndex) / 30, 1 / 30);
      const frame = new VideoFrame(canvas, {
        timestamp: Math.round((frameIndex * 1_000_000) / 30),
        duration: Math.round(1_000_000 / 30),
      });
      try {
        encoder.encode(frame, keyFrame);
      } finally {
        frame.close();
      }
      frameIndex++;
      // Backpressure IS part of real throughput, so it stays inside the timed
      // window — it is the encoder's drain rate we are trying to learn.
      while (encoder.queueSize > 8) await nextTick();
    };

    // Untimed warm-up through the full pipeline: the first frame is a keyframe
    // and the hardware encoder needs a moment to reach steady state.
    for (let i = 0; i < 6; i++) await pump(i === 0);

    const pipelineFrames = 30;
    const pipelineStart = performance.now();
    for (let i = 0; i < pipelineFrames; i++) await pump(false);
    const pipelineFps = pipelineFrames / ((performance.now() - pipelineStart) / 1000);

    // Flush AFTER timing. A flush is a fixed cost paid once per export; charging
    // it to 30 frames made this ~15x pessimistic, and the ETA on the export
    // button is a promise, so it has to be measured the way exports actually run.
    await encoder.finish();

    // Per-preset draw cost, measured rather than modelled. Done last so a
    // failure here cannot cost us the two numbers that matter most.
    let presetCost: Record<string, number> | undefined;
    try {
      presetCost = benchmarkPresets(scene, 1000 / rasterFps);
    } catch {
      presetCost = undefined;
    }

    return { rasterFps, pipelineFps, presetCost, measuredAt: Date.now() };
  } catch {
    return null;
  } finally {
    scene.endExportRender();
    scene.setRenderPreset(previousPreset);
    scene.setPixelRatio(previousRatio);
    scene.setSize(previousWidth / previousRatio, previousHeight / previousRatio, false);
    scene.restart();
  }
}

const nextTick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Stop timing a preset once it has cost this long; slow machines must not stall. */
const PRESET_PROBE_BUDGET_MS = 60;
const PRESET_PROBE_MAX_FRAMES = 8;

/**
 * Times each preset's DRAW on this machine, relative to the baseline.
 *
 * This replaces a static model that was wrong by 6x on real hardware — see
 * `resolveDrawCost` for the measurements. The whole thing is bounded: each
 * preset renders at most 8 frames and bails after 60 ms, so the worst case is
 * roughly a quarter of a second on a machine slow enough to need the accuracy.
 *
 * Draw only, no encoder. The encoder's share is already known from
 * `pipelineFps`, and it does not vary with preset — however many sub-frames get
 * averaged, exactly one frame per output frame reaches the encoder.
 */
function benchmarkPresets(scene: RaceScene, baselineMsPerFrame: number): Record<string, number> {
  const costs: Record<string, number> = {};
  if (!(baselineMsPerFrame > 0)) return costs;

  for (const preset of PRESETS) {
    if (needsPostFX(preset, true) && !scene.supportsPostFX) continue;
    scene.setRenderPreset(preset);
    scene.beginExportRender(preset.motionBlur);
    scene.restart();

    // Warm-up: a preset switch rebuilds materials and may compile new programs,
    // and charging that to the first timed frame would libel the preset.
    for (let i = 0; i < 3; i++) scene.renderFrameAt(i / 60, 1 / 60);

    const start = performance.now();
    let frames = 0;
    while (frames < PRESET_PROBE_MAX_FRAMES) {
      scene.renderFrameAt((3 + frames) / 60, 1 / 60);
      frames++;
      if (performance.now() - start > PRESET_PROBE_BUDGET_MS) break;
    }
    const elapsed = performance.now() - start;
    scene.endExportRender();

    if (frames > 0 && elapsed > 0) costs[preset.id] = elapsed / frames / baselineMsPerFrame;
  }
  return costs;
}

export interface ProbeOptions {
  /** Ignore any cached measurement. The "volver a medir" button sets this. */
  force?: boolean;
}

export async function probeCapability(
  scene: RaceScene,
  options: ProbeOptions = {},
): Promise<Capability> {
  const webCodecs = hasWebCodecs();
  const postFX = scene.supportsPostFX;

  if (!webCodecs) {
    return {
      tier: 'C',
      webCodecs: false,
      codec: null,
      hardwareAccelerated: false,
      supported: [],
      postFX,
      benchmark: null,
      note: 'Tu navegador no puede generar video todavía. Puedes ver la carrera y copiar el enlace para exportarla desde Chrome, Edge o Safari.',
    };
  }

  const supported: string[] = [];
  let codec: string | null = null;
  let hardware = false;
  for (const quality of QUALITIES) {
    const choice = await pickCodec(quality);
    if (choice) {
      supported.push(quality.id);
      if (!codec) {
        codec = choice.codec;
        hardware = choice.hardwareAccelerated;
      }
    }
  }

  const cached = options.force ? null : readCache();
  const benchmark = cached ?? (await benchmarkScene(scene));
  if (benchmark && benchmark !== cached) writeCache(benchmark);

  const tier = tierFor(webCodecs, hardware, benchmark?.pipelineFps ?? 0);

  let note: string | null = null;
  if (!postFX) {
    note = 'Tu GPU no admite los efectos avanzados, así que solo está disponible la calidad Ligero. El video se exporta igual.';
  } else if (tier === 'C') {
    note = 'Tu equipo puede exportar, pero despacio. Prueba 720p30 primero.';
  } else if (!hardware) {
    note = 'Tu navegador está codificando por software. Funciona, pero tarda más.';
  }

  return { tier, webCodecs, codec, hardwareAccelerated: hardware, supported, postFX, benchmark, note };
}

function readCache(): Benchmark | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Benchmark;
    // A month-old measurement is probably still true; a year-old one is not
    // worth trusting after a driver or hardware change.
    if (Date.now() - parsed.measuredAt > 30 * 24 * 3600 * 1000) return null;
    return parsed.pipelineFps > 0 && parsed.rasterFps > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache(benchmark: Benchmark): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(benchmark));
  } catch {
    // Private browsing, storage full — the measurement just won't persist.
  }
}
