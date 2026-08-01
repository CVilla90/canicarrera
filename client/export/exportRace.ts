/**
 * The export loop.
 *
 * One uncompressed 1080p frame is ~8 MB and a 70-second race at 60 fps is 4200
 * frames. Buffering them would need ~34 GB, so this is an assembly line:
 *
 *     draw -> VideoFrame -> encode -> mux -> release -> next
 *
 * The trap (PLAN §2.5): drawing is usually FASTER than encoding. Draw 100
 * frames while the encoder finishes 10 and the other 90 sit in memory, and the
 * tab dies — iOS Safari jetsams around 1-1.5 GB. `encoder.queueSize` is the
 * whole defence, and it bites hardest on exactly the mid-range devices we most
 * want to work.
 */
import { simulate } from '@shared/sim.ts';
import type { RaceSpec } from '@shared/spec.ts';
import type { RaceScene } from '../scene/RaceScene.ts';
import { WebCodecsEncoder } from './encoder.ts';
import type { Quality } from './quality.ts';
import type { RenderPreset } from '../render/presets.ts';

/** Pause drawing when this many frames are already queued for the encoder. */
const QUEUE_HIGH_WATER = 10;
/** Resume once it drains to here, so we are not stopping and starting per frame. */
const QUEUE_LOW_WATER = 4;

export interface ExportProgress {
  phase: 'preparing' | 'rendering' | 'finishing';
  frame: number;
  totalFrames: number;
  /** Measured frames per second, so far. */
  fps: number;
  /** Best current estimate, seconds. Null until we have measured something. */
  secondsLeft: number | null;
  /** How full the encoder queue is, 0-1. Useful when diagnosing a slow export. */
  queuePressure: number;
}

export interface ExportResult {
  blob: Blob;
  frames: number;
  elapsedMs: number;
  /** Measured frames per second over the whole export. */
  fps: number;
}

export interface ExportOptions {
  scene: RaceScene;
  spec: RaceSpec;
  quality: Quality;
  /** Visual fidelity. Independent of `quality`, and never an input to the sim. */
  preset: RenderPreset;
  onProgress?: (progress: ExportProgress) => void;
  signal?: AbortSignal;
}

export class ExportAborted extends Error {
  constructor() {
    super('Exportación cancelada');
    this.name = 'ExportAborted';
  }
}

/**
 * Yields to the event loop without the 4 ms clamp `setTimeout(0)` picks up once
 * nested. Also keeps working in a background tab, which `requestAnimationFrame`
 * does not — a throttled export that never finishes reads as a hang.
 */
function makeYield(): () => Promise<void> {
  if (typeof MessageChannel === 'undefined') {
    return () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  const channel = new MessageChannel();
  let resolveNext: (() => void) | null = null;
  channel.port1.onmessage = () => {
    const resolve = resolveNext;
    resolveNext = null;
    resolve?.();
  };
  return () =>
    new Promise<void>((resolve) => {
      resolveNext = resolve;
      channel.port2.postMessage(null);
    });
}

export async function exportRace({
  scene,
  spec,
  quality,
  preset,
  onProgress,
  signal,
}: ExportOptions): Promise<ExportResult> {
  const yieldToLoop = makeYield();
  const canvas = scene.renderer.domElement;

  // Ask the simulator how long the race is before drawing anything. It costs a
  // few milliseconds and it is the only way to know the frame count up front,
  // which is what makes the progress bar honest.
  const summary = simulate(spec);
  const totalFrames = Math.max(1, Math.round(summary.videoDuration * quality.fps));

  onProgress?.({
    phase: 'preparing',
    frame: 0,
    totalFrames,
    fps: 0,
    secondsLeft: null,
    queuePressure: 0,
  });

  const displayWidth = canvas.clientWidth || window.innerWidth;
  const displayHeight = canvas.clientHeight || window.innerHeight;
  const previousRatio = scene.renderer.getPixelRatio();
  const wasRunning = scene.isRunning;
  scene.stop();

  // Offline mode: supersampled buffers and sub-frame accumulation come on here
  // and go off in the `finally`. Order matters — the preset decides how many
  // sub-frames, `beginExportRender` allocates for it, and `setSize` then sizes
  // those buffers to the export resolution rather than the display's.
  scene.setRenderPreset(preset);
  scene.beginExportRender(preset.motionBlur);

  // Render at export resolution into the visible canvas with `updateStyle`
  // off: the CSS size is untouched, so the user watches the frames being
  // encoded instead of a spinner. The live thumbnail costs nothing.
  scene.setPixelRatio(1);
  scene.setSize(quality.width, quality.height, false);
  scene.restart();

  let encoder: WebCodecsEncoder | null = null;
  const started = performance.now();

  try {
    encoder = await WebCodecsEncoder.create(quality);
    const frameDuration = 1 / quality.fps;
    const keyEvery = Math.max(1, quality.fps * 2);
    let lastReport = 0;

    for (let frame = 0; frame < totalFrames; frame++) {
      if (signal?.aborted) throw new ExportAborted();

      scene.renderFrameAt(frame * frameDuration, frameDuration);

      const videoFrame = new VideoFrame(canvas, {
        timestamp: Math.round((frame * 1_000_000) / quality.fps),
        duration: Math.round(1_000_000 / quality.fps),
      });
      try {
        encoder.encode(videoFrame, frame % keyEvery === 0);
      } finally {
        // Never leak a frame: an unreleased VideoFrame pins GPU memory and the
        // browser will start warning in the console before it starts failing.
        videoFrame.close();
      }

      // Backpressure. Five lines, and the single most likely failure in this
      // feature if they are missing.
      if (encoder.queueSize > QUEUE_HIGH_WATER) {
        while (encoder.queueSize > QUEUE_LOW_WATER) {
          if (signal?.aborted) throw new ExportAborted();
          await yieldToLoop();
        }
      } else {
        await yieldToLoop();
      }

      const now = performance.now();
      if (now - lastReport > 100 || frame === totalFrames - 1) {
        lastReport = now;
        const elapsed = (now - started) / 1000;
        const fps = (frame + 1) / elapsed;
        onProgress?.({
          phase: 'rendering',
          frame: frame + 1,
          totalFrames,
          fps,
          secondsLeft: fps > 0 ? (totalFrames - frame - 1) / fps : null,
          queuePressure: Math.min(encoder.queueSize / QUEUE_HIGH_WATER, 1),
        });
      }
    }

    onProgress?.({
      phase: 'finishing',
      frame: totalFrames,
      totalFrames,
      fps: totalFrames / ((performance.now() - started) / 1000),
      secondsLeft: 0,
      queuePressure: 0,
    });

    const blob = await encoder.finish();
    const elapsedMs = performance.now() - started;
    return { blob, frames: totalFrames, elapsedMs, fps: totalFrames / (elapsedMs / 1000) };
  } catch (error) {
    encoder?.abort();
    throw error;
  } finally {
    // Leave offline mode before resizing, so the supersampled buffers are not
    // briefly reallocated at display size on the way out.
    scene.endExportRender();
    scene.setPixelRatio(previousRatio);
    scene.setSize(displayWidth, displayHeight, true);
    scene.restart();
    if (wasRunning) scene.start();
  }
}

/** Hands the finished file to the browser. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the download a moment to start before the URL goes away.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
