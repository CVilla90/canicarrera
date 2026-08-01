/**
 * The export menu.
 *
 * Two axes get conflated constantly and are unrelated (PLAN §2.4):
 *   - RACE quality is the server's job, decided by curation. Never a setting.
 *   - VIDEO quality is this file. Measured default, user override always
 *     available, and every option stays selectable with an honest ETA rather
 *     than being greyed out. The downside of picking 4K on a weak laptop is a
 *     slow export and a warm device, not a broken one.
 */
export interface Quality {
  id: string;
  label: string;
  width: number;
  height: number;
  fps: number;
  /** bits per second */
  bitrate: number;
  /** Rough pixel throughput cost relative to 1080p30, used for ETAs. */
  costFactor: number;
}

const px1080p30 = 1920 * 1080 * 30;

const make = (id: string, label: string, width: number, height: number, fps: number, mbps: number): Quality => ({
  id,
  label,
  width,
  height,
  fps,
  bitrate: Math.round(mbps * 1_000_000),
  costFactor: (width * height * fps) / px1080p30,
});

/**
 * ## On frame rates
 *
 * **YouTube caps playback at 60 fps.** Upload 120 and it is re-encoded down, so
 * you pay double the frames, double the export time and double the bytes for a
 * video the platform will not play back at that rate. 120 is therefore offered
 * but deliberately kept OFF the automatic ladder — it is for someone who knows
 * they want it (a local file, a 2x slow-motion edit), not something to be
 * silently planned into.
 *
 * 30 vs 60 is the choice that actually matters, and it interacts with motion
 * blur: at 30 fps a marble crossing frame strobes without blur, which is
 * exactly why the higher presets accumulate sub-frames. 60 fps needs less blur
 * to read smoothly, so 60+Estándar often looks better than 30+Ultra and costs
 * about the same.
 */
export const QUALITIES: Quality[] = [
  make('720p30', '720p30', 1280, 720, 30, 5),
  make('720p60', '720p60', 1280, 720, 60, 8),
  make('1080p30', '1080p30', 1920, 1080, 30, 9),
  make('1080p60', '1080p60', 1920, 1080, 60, 13),
  make('1080p120', '1080p120', 1920, 1080, 120, 20),
  make('1440p60', '1440p60', 2560, 1440, 60, 22),
  make('2160p60', '4K60', 3840, 2160, 60, 45),
];

/** 9:16 for Shorts is Stage 4, but the shape of the data already allows it. */
export const DEFAULT_QUALITY_ID = '1080p60';

export const qualityById = (id: string): Quality =>
  QUALITIES.find((q) => q.id === id) ?? QUALITIES[1];

const REFERENCE_PIXELS = 1920 * 1080;

/**
 * Resolution relative to 1080p, which is what the benchmark measures at.
 *
 * Deliberately NOT `costFactor` above: that one folds in fps, which belongs to
 * the frame *count*, not to the cost of any single frame. Multiplying by both
 * would charge the frame rate twice.
 */
export const pixelFactor = (quality: Quality): number =>
  (quality.width * quality.height) / REFERENCE_PIXELS;
