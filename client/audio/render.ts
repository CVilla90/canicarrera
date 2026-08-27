/**
 * Rendering the soundtrack for the exported file.
 *
 * The constraint, and it is the one PLAN §5.1 warns about: **export runs faster
 * than realtime, so the live output cannot be recorded.** A 70-second race can
 * finish exporting in five seconds; anything tapped off the live `AudioContext`
 * would be five seconds of audio against seventy seconds of video.
 *
 * `OfflineAudioContext` is the answer. It runs the exact same graph as fast as
 * the CPU allows and hands back a buffer, so the audio in the MP4 is the
 * performance the user heard in the preview, sample for sample.
 */
import type { Score } from '@shared/audio/score.ts';
import { makeYield } from '../lib/yield.ts';
import { applyMix, createBuses, scheduleCrowd, scheduleScore, type Mix } from './synth.ts';

/** 48 kHz, because that is what AAC in MP4 wants and what every encoder takes. */
export const AUDIO_SAMPLE_RATE = 48000;
export const AUDIO_CHANNELS = 2;

/**
 * True when this browser can put audio into the file at all.
 *
 * Safari shipped `VideoEncoder` well before `AudioEncoder`, so the two cannot be
 * assumed together — and a missing audio encoder must degrade to a silent video,
 * never to a failed export.
 */
export function hasAudioEncoder(): boolean {
  return typeof AudioEncoder !== 'undefined' && typeof AudioData !== 'undefined';
}

export interface AudioTrackConfig {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  bitrate: number;
}

const AAC_LC = 'mp4a.40.2';

/** The audio config this browser will accept, or null if there is none. */
export async function pickAudioConfig(): Promise<AudioTrackConfig | null> {
  if (!hasAudioEncoder()) return null;
  const config: AudioTrackConfig = {
    codec: AAC_LC,
    sampleRate: AUDIO_SAMPLE_RATE,
    numberOfChannels: AUDIO_CHANNELS,
    bitrate: 160_000,
  };
  try {
    const support = await AudioEncoder.isConfigSupported(config);
    return support.supported ? config : null;
  } catch {
    return null;
  }
}

/**
 * Performs the whole score offline.
 *
 * `OfflineAudioContext` needs every node constructed before rendering starts,
 * which is why `shared/audio/score.ts` caps the note count — this is the call
 * that would otherwise allocate tens of thousands of nodes on a phone.
 */
export async function renderScore(score: Score, mix: Mix): Promise<AudioBuffer> {
  const length = Math.max(1, Math.ceil(score.duration * AUDIO_SAMPLE_RATE));
  const ctx = new OfflineAudioContext({
    numberOfChannels: AUDIO_CHANNELS,
    length,
    sampleRate: AUDIO_SAMPLE_RATE,
  });

  const buses = createBuses(ctx, ctx.destination);
  applyMix(buses, mix);
  // The whole score in one window. Live playback tiles it; here there is no
  // reason not to hand it over at once.
  scheduleScore(ctx, buses, score, 0, { from: 0, to: score.duration });
  scheduleCrowd(ctx, buses, score.crowd, 0, score.duration);

  return ctx.startRendering();
}

/**
 * Slices an `AudioBuffer` into `AudioData` chunks and feeds them to an encoder.
 *
 * Planar float is the format every `AudioEncoder` accepts and the format an
 * `AudioBuffer` already stores, so there is no conversion — just a copy into the
 * interleaved-by-channel layout `f32-planar` expects.
 */
export async function encodeAudioBuffer(
  buffer: AudioBuffer,
  encoder: AudioEncoder,
  onChunk?: () => void,
): Promise<void> {
  const yieldToLoop = makeYield();
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  /** ~21 ms per chunk. Small enough that the queue never grows a full second. */
  const frames = 1024;
  const source: Float32Array[] = [];
  for (let channel = 0; channel < channels; channel++) {
    source.push(buffer.getChannelData(channel));
  }

  for (let offset = 0; offset < buffer.length; offset += frames) {
    const count = Math.min(frames, buffer.length - offset);
    const planar = new Float32Array(count * channels);
    for (let channel = 0; channel < channels; channel++) {
      planar.set(source[channel].subarray(offset, offset + count), channel * count);
    }
    const data = new AudioData({
      format: 'f32-planar',
      sampleRate,
      numberOfFrames: count,
      numberOfChannels: channels,
      timestamp: Math.round((offset / sampleRate) * 1_000_000),
      data: planar,
    });
    try {
      encoder.encode(data);
    } finally {
      // Same discipline as `VideoFrame`: never leave one unclosed.
      data.close();
    }
    onChunk?.();

    // Backpressure. The audio encoder is far cheaper than the video one, but a
    // 70-second file is still 3000 chunks and letting them pile up on a phone is
    // the same mistake in a smaller coat.
    //
    // ⚠️ `setTimeout` here is a hang, not a slowdown. A 70-second race is ~3300
    // chunks, and a background tab clamps nested timeouts to one second — an
    // export left in another tab sat in the `audio` phase indefinitely. The
    // MessageChannel yield is not throttled.
    if (encoder.encodeQueueSize > 24) {
      await yieldToLoop();
    }
  }
}
