/**
 * Frame encoding, behind an interface.
 *
 * Today there is exactly one implementation — WebCodecs `VideoEncoder`, which
 * hands the work to the machine's hardware H.264 encoder. The interface exists
 * because tier C (browsers with no `VideoEncoder`, notably Firefox on Android)
 * needs a WASM encoder that plugs in here without the export loop learning
 * about it. See `HANDOFF.md` for what tier C still needs.
 */
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import type { AudioTrackConfig } from '../audio/render.ts';
import type { Quality } from './quality.ts';

export interface FrameEncoder {
  /** How many frames are waiting. The export loop throttles on this. */
  readonly queueSize: number;
  encode(frame: VideoFrame, keyFrame: boolean): void;
  /** Drains the queue and returns the finished MP4. */
  finish(): Promise<Blob>;
  /** Aborts without producing a file. Always safe to call. */
  abort(): void;
}

/**
 * H.264 levels, most capable first. We ask the browser rather than deciding
 * from the resolution, because "supported" also depends on the machine's
 * encoder — a level 5.2 string is meaningless if the GPU tops out at 4.2.
 */
const CODEC_CANDIDATES = [
  'avc1.640034', // High 5.2
  'avc1.640033', // High 5.1
  'avc1.640032', // High 5.0
  'avc1.64002a', // High 4.2
  'avc1.640028', // High 4.0
  'avc1.4d0028', // Main 4.0
  'avc1.42001f', // Baseline 3.1
];

export interface CodecChoice {
  codec: string;
  hardwareAccelerated: boolean;
}

export function hasWebCodecs(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

/**
 * Finds a codec string this browser will actually accept at this size.
 * Prefers hardware, but never refuses software — a slow export is a fine
 * outcome, a refusal is not.
 */
export async function pickCodec(quality: Quality): Promise<CodecChoice | null> {
  if (!hasWebCodecs()) return null;
  for (const preference of ['prefer-hardware', 'no-preference'] as const) {
    for (const codec of CODEC_CANDIDATES) {
      try {
        const support = await VideoEncoder.isConfigSupported({
          codec,
          width: quality.width,
          height: quality.height,
          bitrate: quality.bitrate,
          framerate: quality.fps,
          hardwareAcceleration: preference,
        });
        if (support.supported) {
          return { codec, hardwareAccelerated: preference === 'prefer-hardware' };
        }
      } catch {
        // isConfigSupported throws on malformed configs in some builds; try the
        // next candidate rather than failing the whole export.
      }
    }
  }
  return null;
}

export class WebCodecsEncoder implements FrameEncoder {
  private readonly encoder: VideoEncoder;
  private readonly muxer: Muxer<ArrayBufferTarget>;
  /**
   * Present only when the caller asked for sound AND the browser agreed it
   * could encode it. `null` is a completely normal outcome — the export then
   * produces a silent video rather than failing.
   */
  private readonly audio: AudioEncoder | null = null;
  private error: Error | null = null;
  private finished = false;

  private constructor(quality: Quality, codec: string, audio: AudioTrackConfig | null) {
    this.muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: {
        codec: 'avc',
        width: quality.width,
        height: quality.height,
        frameRate: quality.fps,
      },
      // The audio track has to be DECLARED at construction — the muxer writes
      // the track table before it has seen a single chunk. That is why the
      // caller probes for an audio codec before creating the encoder rather
      // than discovering halfway through that it has samples to add.
      ...(audio
        ? {
            audio: {
              codec: 'aac' as const,
              numberOfChannels: audio.numberOfChannels,
              sampleRate: audio.sampleRate,
            },
          }
        : {}),
      // Metadata at the front, so the file starts playing immediately when
      // uploaded or opened over a network.
      fastStart: 'in-memory',
    });

    this.encoder = new VideoEncoder({
      output: (chunk, meta) => this.muxer.addVideoChunk(chunk, meta),
      error: (err) => {
        this.error = err instanceof Error ? err : new Error(String(err));
      },
    });

    this.encoder.configure({
      codec,
      width: quality.width,
      height: quality.height,
      bitrate: quality.bitrate,
      framerate: quality.fps,
      // Constant bitrate is more predictable for uploads; quality mode swings
      // wildly on a scene that alternates dark sky and bright confetti.
      latencyMode: 'quality',
    });

    if (audio) {
      this.audio = new AudioEncoder({
        output: (chunk, meta) => this.muxer.addAudioChunk(chunk, meta),
        error: (err) => {
          this.error = err instanceof Error ? err : new Error(String(err));
        },
      });
      this.audio.configure(audio);
    }
  }

  static async create(
    quality: Quality,
    audio: AudioTrackConfig | null = null,
  ): Promise<WebCodecsEncoder> {
    const choice = await pickCodec(quality);
    if (!choice) throw new Error('Este navegador no puede codificar H.264 en ese tamaño.');
    return new WebCodecsEncoder(quality, choice.codec, audio);
  }

  get queueSize(): number {
    return this.encoder.encodeQueueSize;
  }

  /** The audio encoder, or null when this file will be silent. */
  get audioEncoder(): AudioEncoder | null {
    return this.audio;
  }

  encode(frame: VideoFrame, keyFrame: boolean): void {
    if (this.error) throw this.error;
    this.encoder.encode(frame, { keyFrame });
  }

  async finish(): Promise<Blob> {
    // Both tracks have to be fully drained before the muxer is finalized, or the
    // file ends up describing chunks it never received.
    await this.encoder.flush();
    if (this.audio) await this.audio.flush();
    if (this.error) throw this.error;
    this.muxer.finalize();
    this.finished = true;
    const { buffer } = this.muxer.target;
    return new Blob([buffer], { type: 'video/mp4' });
  }

  abort(): void {
    if (this.finished) return;
    try {
      this.encoder.close();
    } catch {
      // Already closed — nothing to do.
    }
    try {
      this.audio?.close();
    } catch {
      // Same.
    }
  }
}
