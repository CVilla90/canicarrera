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

export const QUALITIES: Quality[] = [
  make('720p30', '720p30', 1280, 720, 30, 5),
  make('1080p30', '1080p30', 1920, 1080, 30, 9),
  make('1080p60', '1080p60', 1920, 1080, 60, 13),
  make('1440p60', '1440p60', 2560, 1440, 60, 22),
  make('2160p60', '4K60', 3840, 2160, 60, 45),
];

/** 9:16 for Shorts is Stage 4, but the shape of the data already allows it. */
export const DEFAULT_QUALITY_ID = '1080p60';

export const qualityById = (id: string): Quality =>
  QUALITIES.find((q) => q.id === id) ?? QUALITIES[1];
