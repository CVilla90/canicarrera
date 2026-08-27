/**
 * Live audio playback.
 *
 * Everything hard about this is scheduling, and there are exactly two hard
 * parts:
 *
 * **Autoplay policy.** Every browser refuses to make noise before a user
 * gesture, and Safari is the strictest. So the `AudioContext` is not created at
 * boot — it is created the first time the user turns sound on, inside the click
 * handler. Audio therefore ships off by default, which is also the right default
 * for a page that starts playing a video the moment it loads.
 *
 * **Lookahead, not per-frame.** Web Audio has its own clock, accurate to the
 * sample; `requestAnimationFrame` is accurate to whenever the browser feels like
 * it. Triggering a note when the frame loop notices it is due produces audible
 * jitter, so instead a timer runs ahead of playback and hands the audio clock a
 * slice of the score to perform. The frame loop never touches audio.
 *
 * The whole score is precomputed, which is what makes the anchor trivial: one
 * `t0` mapping score time to context time, established when playback starts.
 */
import type { Score } from '@shared/audio/score.ts';
import {
  applyMix,
  createBuses,
  scheduleCrowd,
  scheduleScore,
  DEFAULT_MIX,
  type AudioBuses,
  type Mix,
} from './synth.ts';

/** How far ahead of the audio clock notes are scheduled. */
const LOOKAHEAD = 0.7;
/** How often the scheduler wakes up. Well inside the lookahead. */
const TICK_MS = 90;
/** A beat of headroom so the first notes are never scheduled in the past. */
const START_LATENCY = 0.08;

export interface AudioSettings extends Mix {
  /** Master switch. When false no context is created at all. */
  enabled: boolean;
}

export const DEFAULT_SETTINGS: AudioSettings = { enabled: false, ...DEFAULT_MIX };

const STORAGE_KEY = 'canicarrera.audio.v1';

export function loadSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AudioSettings>;
    return {
      enabled: parsed.enabled === true,
      master: clamp01(parsed.master, DEFAULT_MIX.master),
      music: clamp01(parsed.music, DEFAULT_MIX.music),
      sfx: clamp01(parsed.sfx, DEFAULT_MIX.sfx),
      crowd: clamp01(parsed.crowd, DEFAULT_MIX.crowd),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AudioSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private browsing. The setting just will not survive the tab.
  }
}

const clamp01 = (value: unknown, fallback: number): number =>
  typeof value === 'number' && value >= 0 && value <= 1 ? value : fallback;

/**
 * Owns the live `AudioContext` and performs a score against it.
 *
 * Deliberately knows nothing about React, the scene or the sim — it is handed a
 * score and told what time the race is at.
 */
export class AudioDirector {
  private ctx: AudioContext | null = null;
  private buses: AudioBuses | null = null;
  private score: Score | null = null;
  private crowdSource: AudioBufferSourceNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Context time at which score time zero happens. */
  private t0 = 0;
  /** How much of the score has already been handed to the audio clock. */
  private scheduledTo = 0;
  private playing = false;
  private settings: AudioSettings;

  constructor(settings: AudioSettings = DEFAULT_SETTINGS) {
    this.settings = { ...settings };
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get enabled(): boolean {
    return this.settings.enabled;
  }

  /**
   * Creates or resumes the context.
   *
   * **Must be called from inside a user gesture** the first time, or the context
   * is created in a suspended state that never resumes. That is the whole reason
   * this is a separate method rather than something the constructor does.
   */
  async unlock(): Promise<boolean> {
    try {
      if (!this.ctx) {
        const Ctor: typeof AudioContext =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return false;
        this.ctx = new Ctor({ latencyHint: 'interactive' });
        this.buses = createBuses(this.ctx, this.ctx.destination);
        applyMix(this.buses, this.settings);
      }
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return this.ctx.state === 'running';
    } catch {
      this.ctx = null;
      this.buses = null;
      return false;
    }
  }

  setSettings(settings: AudioSettings): void {
    this.settings = { ...settings };
    if (this.buses) applyMix(this.buses, this.settings);
    if (!settings.enabled) this.stop();
  }

  /** Swaps in a new race. Always stops whatever was playing first. */
  load(score: Score | null): void {
    this.stop();
    this.score = score;
  }

  /**
   * Starts performing from `scoreTime` seconds into the race.
   *
   * Anything already scheduled is dropped, so this doubles as "seek": a replay
   * calls it with 0, and it is safe to call while playing.
   */
  start(scoreTime: number): void {
    if (!this.settings.enabled || !this.score || !this.ctx || !this.buses) return;
    if (this.ctx.state !== 'running') {
      // The tab was backgrounded or the gesture never landed. Fail quiet — a
      // race that plays silently is fine; one that throws is not.
      void this.ctx.resume().catch(() => undefined);
      return;
    }
    this.cancel();

    this.t0 = this.ctx.currentTime + START_LATENCY - scoreTime;
    this.scheduledTo = scoreTime;
    this.playing = true;
    this.crowdSource = scheduleCrowd(
      this.ctx,
      this.buses,
      this.score.crowd.filter((point) => point.t >= scoreTime),
      this.t0,
      this.score.duration,
    );
    this.pump();
    this.timer = setInterval(() => this.pump(), TICK_MS);
  }

  /** Silences everything immediately and forgets the anchor. */
  stop(): void {
    this.cancel();
    this.playing = false;
  }

  /**
   * Tears down every scheduled voice.
   *
   * Rebuilding the buses is the trick: hundreds of oscillators may already be
   * scheduled minutes ahead, and there is no API to un-schedule them. Cutting
   * the graph they feed into silences all of them at once, and they release
   * themselves when their own `stop()` time passes.
   */
  private cancel(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.crowdSource) {
      try {
        this.crowdSource.stop();
      } catch {
        // Already stopped.
      }
      this.crowdSource = null;
    }
    if (this.ctx && this.buses) {
      this.buses.master.disconnect();
      this.buses = createBuses(this.ctx, this.ctx.destination);
      applyMix(this.buses, this.settings);
    }
  }

  /** Hands the audio clock the next slice of the score. */
  private pump(): void {
    const ctx = this.ctx;
    const score = this.score;
    const buses = this.buses;
    if (!ctx || !score || !buses || !this.playing) return;

    const horizon = ctx.currentTime - this.t0 + LOOKAHEAD;
    if (horizon <= this.scheduledTo) return;

    scheduleScore(ctx, buses, score, this.t0, { from: this.scheduledTo, to: horizon });
    this.scheduledTo = horizon;

    if (this.scheduledTo >= score.duration) {
      // Everything is scheduled; the audio clock will finish it without us.
      if (this.timer !== null) {
        clearInterval(this.timer);
        this.timer = null;
      }
    }
  }

  dispose(): void {
    this.stop();
    const ctx = this.ctx;
    this.ctx = null;
    this.buses = null;
    void ctx?.close().catch(() => undefined);
  }
}
