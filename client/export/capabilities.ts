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
 */
import type { RaceScene } from '../scene/RaceScene.ts';
import { WebCodecsEncoder, hasWebCodecs, pickCodec } from './encoder.ts';
import { QUALITIES, qualityById, type Quality } from './quality.ts';

/** Tier A/B still export for free; C is slow but free; only D would cost us. */
export type Tier = 'A' | 'B' | 'C' | 'D';

export interface Benchmark {
  /** Draw-only throughput at 1920x1080, frames per second. */
  rasterFps: number;
  /** Full draw -> VideoFrame -> encode -> mux throughput at 1920x1080. */
  pipelineFps: number;
  measuredAt: number;
}

export interface Capability {
  tier: Tier;
  webCodecs: boolean;
  codec: string | null;
  hardwareAccelerated: boolean;
  /** Quality ids the browser confirmed it can configure. */
  supported: string[];
  benchmark: Benchmark | null;
  /** Quality id we default to. */
  recommended: string;
  /** Spanish, shown to the user when it matters. */
  note: string | null;
}

const REFERENCE_PIXELS = 1920 * 1080;
const CACHE_KEY = 'canicarrera.capability.v1';

export const pixelFactor = (quality: Quality): number =>
  (quality.width * quality.height) / REFERENCE_PIXELS;

/** Seconds this machine needs to export `frames` frames at `quality`. */
export function estimateSeconds(
  capability: Capability,
  quality: Quality,
  frames: number,
): number | null {
  if (!capability.benchmark || capability.benchmark.pipelineFps <= 0) return null;
  const secondsPerFrame = 1 / capability.benchmark.pipelineFps;
  return frames * secondsPerFrame * pixelFactor(quality);
}

function tierFor(webCodecs: boolean, hardware: boolean, pipelineFps: number): Tier {
  if (!webCodecs) return 'C';
  if (hardware && pipelineFps >= 25) return 'A';
  if (pipelineFps >= 8) return 'B';
  return 'C';
}

function recommend(capability: Omit<Capability, 'recommended' | 'note'>): string {
  const fps = capability.benchmark?.pipelineFps ?? 0;
  const affordable = QUALITIES.filter((q) => capability.supported.includes(q.id));
  if (affordable.length === 0) return '720p30';
  // Aim for an export that finishes in about half a minute for a typical race.
  const budgetSeconds = 30;
  const typicalFrames = (q: Quality) => 70 * q.fps;
  const best = affordable.filter((q) => {
    if (fps <= 0) return q.id === '720p30';
    return (typicalFrames(q) / fps) * pixelFactor(q) <= budgetSeconds;
  });
  return (best[best.length - 1] ?? affordable[0]).id;
}

/**
 * Runs a real, small export and times it.
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

    return { rasterFps, pipelineFps, measuredAt: Date.now() };
  } catch {
    return null;
  } finally {
    scene.setPixelRatio(previousRatio);
    scene.setSize(previousWidth / previousRatio, previousHeight / previousRatio, false);
    scene.restart();
  }
}

const nextTick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export interface ProbeOptions {
  /** Ignore any cached measurement. The "volver a medir" button sets this. */
  force?: boolean;
}

export async function probeCapability(
  scene: RaceScene,
  options: ProbeOptions = {},
): Promise<Capability> {
  const webCodecs = hasWebCodecs();

  if (!webCodecs) {
    return {
      tier: 'C',
      webCodecs: false,
      codec: null,
      hardwareAccelerated: false,
      supported: [],
      benchmark: null,
      recommended: '720p30',
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

  const base = {
    tier: tierFor(webCodecs, hardware, benchmark?.pipelineFps ?? 0),
    webCodecs,
    codec,
    hardwareAccelerated: hardware,
    supported,
    benchmark,
  };

  let note: string | null = null;
  if (base.tier === 'C') {
    note = 'Tu equipo puede exportar, pero despacio. Prueba 720p30 primero.';
  } else if (!hardware) {
    note = 'Tu navegador está codificando por software. Funciona, pero tarda más.';
  }

  return { ...base, recommended: recommend(base), note };
}

function readCache(): Benchmark | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Benchmark;
    // A month-old measurement is probably still true; a year-old one is not
    // worth trusting after a driver or hardware change.
    if (Date.now() - parsed.measuredAt > 30 * 24 * 3600 * 1000) return null;
    return parsed.pipelineFps > 0 ? parsed : null;
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
