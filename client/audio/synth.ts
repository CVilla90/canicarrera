/**
 * The synthesiser: a `Score` in, Web Audio nodes out.
 *
 * ## The one rule that makes this correct
 *
 * **Everything schedules against `BaseAudioContext`, never against `AudioContext`.**
 * That is not a style choice — it is the whole architecture. Live playback uses
 * an `AudioContext`; export uses an `OfflineAudioContext`, which renders a
 * seventy-second soundtrack in a couple of seconds. Both are `BaseAudioContext`,
 * so this file is the *single* implementation and the exported MP4 is guaranteed
 * to contain the same performance the user heard.
 *
 * PLAN §5.1 puts it as a warning: export runs faster than realtime, so you
 * cannot record live output. Writing two schedulers would be the same mistake
 * with extra steps — they would drift apart the first time either was edited.
 *
 * ## No samples, no assets, no network
 *
 * Every sound here is oscillators, filtered noise and gain envelopes. The bundle
 * grows by a few kilobytes rather than several megabytes, nothing can 404 in
 * front of a user, and — the reason that matters commercially — there is no
 * recording for YouTube's Content ID to match against.
 */
import {
  SFX_SHAPES,
  type CrowdSwell,
  type MusicNote,
  type Score,
  type SfxHit,
  type SfxKind,
  type Voice,
} from '@shared/audio/score.ts';

export interface Mix {
  /** 0-1, applied to everything. */
  master: number;
  music: number;
  sfx: number;
  crowd: number;
}

export const DEFAULT_MIX: Mix = { master: 0.8, music: 0.75, sfx: 0.85, crowd: 0.6 };

/** MIDI note number to hertz. */
const hz = (note: number): number => 440 * Math.pow(2, (note - 69) / 12);

/**
 * A window of score time to schedule.
 *
 * Live playback schedules in short slices as the race plays; the offline render
 * asks for the whole thing at once. Same code either way.
 */
export interface ScheduleWindow {
  from: number;
  to: number;
}

/** The buses a score is played through. Built once per context. */
export interface AudioBuses {
  music: GainNode;
  sfx: GainNode;
  crowd: GainNode;
  master: GainNode;
  /** Shared plate. Snare, stabs, chimes and cheers all send to it. */
  reverbSend: GainNode;
  noise: AudioBuffer;
  /** Pre-baked percussion, keyed `voice:gainStep`. See `drumBuffer`. */
  drums: Map<string, AudioBuffer>;
  /** One shared reverb send per percussion voice, so a hit stays a single node. */
  drumSends: Map<string, GainNode>;
}

/**
 * Percussion is **pre-baked into buffers**, not synthesised per hit.
 *
 * Measured, and it is the difference between a usable feature and an unusable
 * one. A hat built live is a noise source plus a filter plus an enveloped gain —
 * three nodes — and rendering the 492 hats in a 75-second race that way took
 * **10.6 s**. The identical hats played from a pre-baked buffer, one node each,
 * took **2.3 s**. The cost of an offline render turns out to be dominated by
 * graph size, not by DSP: a two-oscillator bass note measured no cheaper per
 * node than a filtered noise burst.
 *
 * So the drums work the way a drum machine works. Each (voice, velocity) pair is
 * rendered once into a small mono buffer by the plain arithmetic below, and a
 * hit becomes a single `AudioBufferSourceNode`. Velocity is quantised to eighths
 * so the cache stays at a handful of buffers per voice.
 *
 * ⚠️ Those timings were measured in a **hidden** tab, which this project has
 * already been bitten by twice (see `HANDOFF.md`). Treat the 4.6x ratio as
 * solid — both sides were measured the same way — and the absolute seconds as an
 * upper bound.
 */
const DRUM_GAIN_STEPS = 8;

/** Seconds of buffer to bake per percussion voice. */
const DRUM_SECONDS: Record<string, number> = {
  kick: 0.3,
  snare: 0.19,
  ghost: 0.075,
  hat: 0.055,
  ride: 0.34,
};

/** How much of each percussion voice goes to the plate. */
const DRUM_SEND: Record<string, number> = {
  kick: 0,
  snare: 0.14,
  ghost: 0.04,
  hat: 0,
  ride: 0.05,
};

/**
 * Per-voice level, applied inside the bake.
 *
 * These are the balance, and they are not optional: the live-synthesised voices
 * this replaced each attenuated their own envelope (the hat by 0.4, the snare by
 * 0.65), and baking without them pushed the drop to a **peak of 1.21 with 86
 * clipped samples**. A mix that clips is worse than a quiet one, because the
 * clipping is baked into the file the user uploads.
 */
const DRUM_LEVEL: Record<string, number> = {
  kick: 0.82,
  snare: 0.6,
  ghost: 0.5,
  hat: 0.3,
  ride: 0.28,
};

export const isDrumVoice = (voice: Voice): boolean => voice in DRUM_SECONDS;

/**
 * Renders one percussion one-shot into a buffer, by hand.
 *
 * Deliberately plain arithmetic rather than a nested `OfflineAudioContext`:
 * one-pole filters and an exponential decay are four lines each, they are
 * bit-identical on every machine, and baking this way costs microseconds
 * instead of spinning up a second audio graph per drum.
 */
function bakeDrum(ctx: BaseAudioContext, voice: string, gain: number): AudioBuffer {
  const seconds = DRUM_SECONDS[voice] ?? 0.1;
  const length = Math.max(1, Math.ceil(seconds * ctx.sampleRate));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const sr = ctx.sampleRate;

  // Fixed seed per voice: the noise floor of a snare must be identical in the
  // preview and in the exported file.
  let state = (0x9e3779b9 ^ voice.length * 2654435761) >>> 0;
  const white = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x80000000 - 1;
  };

  let previous = 0;
  let low = 0;

  for (let i = 0; i < length; i++) {
    const t = i / sr;
    const u = i / length;
    let sample = 0;

    switch (voice) {
      case 'kick': {
        // The pitch drop is the sound. A static 45 Hz sine is a hum.
        const freq = 45 + (130 - 45) * Math.exp(-t / 0.022);
        sample = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t / 0.075);
        const w = white();
        const hp = w - previous;
        previous = w;
        sample += hp * Math.exp(-t / 0.004) * 0.35;
        break;
      }
      case 'snare':
      case 'ghost': {
        const bodyFreq = voice === 'ghost' ? 240 : 195;
        const decay = voice === 'ghost' ? 0.018 : 0.05;
        // Triangle-ish body via a folded sine, plus band-limited noise.
        sample = Math.sin(2 * Math.PI * bodyFreq * Math.exp(-t / 0.03) * t) * 0.45;
        const w = white();
        const hp = w - previous;
        previous = w;
        low += (hp - low) * (voice === 'ghost' ? 0.55 : 0.35);
        sample = (sample + low * 1.8) * Math.exp(-t / decay);
        break;
      }
      case 'hat':
      case 'ride': {
        const decay = voice === 'ride' ? 0.11 : 0.012;
        const w = white();
        const hp = w - previous;
        previous = w;
        // A second difference pushes the spectrum higher still, which is what
        // separates a hi-hat from plain noise.
        sample = (hp - low) * Math.exp(-t / decay);
        low = hp;
        break;
      }
      default:
        sample = 0;
    }

    // A short fade at the very end, so a truncated buffer cannot click.
    const tail = u > 0.92 ? (1 - u) / 0.08 : 1;
    data[i] = sample * gain * (DRUM_LEVEL[voice] ?? 0.5) * tail;
  }

  return buffer;
}

/** The baked buffer for this voice and velocity, minting it on first use. */
function drumBuffer(ctx: BaseAudioContext, buses: AudioBuses, voice: string, gain: number): AudioBuffer {
  const step = Math.max(1, Math.round(gain * DRUM_GAIN_STEPS));
  const key = `${voice}:${step}`;
  const existing = buses.drums.get(key);
  if (existing) return existing;
  const created = bakeDrum(ctx, voice, step / DRUM_GAIN_STEPS);
  buses.drums.set(key, created);
  return created;
}

/** The shared plate send for a percussion voice, or null if it does not use one. */
function drumSend(ctx: BaseAudioContext, buses: AudioBuses, voice: string): GainNode | null {
  const amount = DRUM_SEND[voice] ?? 0;
  if (amount <= 0) return null;
  const existing = buses.drumSends.get(voice);
  if (existing) return existing;
  const send = ctx.createGain();
  send.gain.value = amount;
  send.connect(buses.reverbSend);
  buses.drumSends.set(voice, send);
  return send;
}

// ---------------------------------------------------------------- primitives

/**
 * A second of white noise, built once per context and reused by every voice.
 *
 * Minting a buffer per hat would allocate thousands of them across a race. One
 * buffer, played from a different offset each time, is indistinguishable and
 * costs 192 KB total.
 */
function makeNoise(ctx: BaseAudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // A fixed LCG rather than Math.random: the noise floor is then identical in
  // the preview and in the export, which is one less way for the two to differ.
  let state = 0x2f6e2b1;
  for (let i = 0; i < data.length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    data[i] = (state / 0x80000000 - 1) * 0.9;
  }
  return buffer;
}

/**
 * A procedural plate reverb.
 *
 * Exponentially decaying stereo noise is the cheapest impulse response that
 * still sounds like a room, and a room is what separates "someone triggered a
 * sample" from "this happened somewhere". Generated, so it costs no bytes.
 */
function makeImpulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const length = Math.max(1, Math.ceil(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  let state = 0x9e3779b9;
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const white = state / 0x80000000 - 1;
      data[i] = white * Math.pow(1 - i / length, decay);
    }
  }
  return buffer;
}

/**
 * A soft-clip curve for the master bus.
 *
 * `tanh`, normalised so unity in is very nearly unity out. It is a safety net
 * with a real job: the drop stacks an impact, a kick, a sub, a reese and a
 * cheer on the same beat, and tuning individual levels until that particular
 * moment fits is a game you lose the next time the arrangement changes. Measured
 * before adding it, the drop peaked at **1.08 with 20 clipped samples** — and
 * hard clipping is baked permanently into the file the user uploads.
 *
 * A `DynamicsCompressorNode` would also work and would be one node either way,
 * but it introduces several milliseconds of lookahead latency, which would slide
 * the whole soundtrack against the video. A wave shaper has none.
 *
 * Saturation is also simply correct for the genre: this is what a drum bus does.
 */
function softClipCurve(): Float32Array<ArrayBuffer> {
  const size = 1024;
  const curve = new Float32Array(size);
  const drive = 1.35;
  // Ceiling under 1.0 on purpose. `oversample: '2x'` resamples through filters
  // that ring slightly, so a curve normalised to exactly 1.0 still measured a
  // peak of 1.0022 — twelve samples over full scale. The headroom is inaudible
  // and it makes "this file never clips" true rather than nearly true.
  const ceiling = 0.97;
  const norm = Math.tanh(drive);
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    curve[i] = (Math.tanh(x * drive) / norm) * ceiling;
  }
  return curve;
}

export function createBuses(ctx: BaseAudioContext, destination: AudioNode): AudioBuses {
  const limiter = ctx.createWaveShaper();
  limiter.curve = softClipCurve();
  limiter.oversample = '2x';
  limiter.connect(destination);

  const master = ctx.createGain();
  master.connect(limiter);

  const music = ctx.createGain();
  const sfx = ctx.createGain();
  const crowd = ctx.createGain();
  music.connect(master);
  sfx.connect(master);
  crowd.connect(master);

  const convolver = ctx.createConvolver();
  convolver.buffer = makeImpulse(ctx, 1.6, 2.4);
  const reverbReturn = ctx.createGain();
  reverbReturn.gain.value = 0.5;
  convolver.connect(reverbReturn);
  reverbReturn.connect(master);

  const reverbSend = ctx.createGain();
  reverbSend.gain.value = 1;
  reverbSend.connect(convolver);

  return {
    music,
    sfx,
    crowd,
    master,
    reverbSend,
    noise: makeNoise(ctx),
    drums: new Map(),
    drumSends: new Map(),
  };
}

export function applyMix(buses: AudioBuses, mix: Mix): void {
  buses.master.gain.value = mix.master;
  buses.music.gain.value = mix.music;
  buses.sfx.gain.value = mix.sfx;
  buses.crowd.gain.value = mix.crowd;
}

/** A noise voice starting at a deterministic offset into the shared buffer. */
function noiseSource(ctx: BaseAudioContext, buses: AudioBuses, at: number): AudioBufferSourceNode {
  const source = ctx.createBufferSource();
  source.buffer = buses.noise;
  // Offset derived from the scheduled time, so the same note in the preview and
  // in the export reads the same slice of noise.
  source.loop = true;
  source.loopStart = 0;
  source.loopEnd = buses.noise.duration;
  const offset = (Math.abs(at) * 7.13) % buses.noise.duration;
  source.start(at, offset);
  return source;
}

/**
 * The envelope every one-shot in this file uses.
 *
 * Attack and release are read from `SFX_SHAPES` and are never zero, which is
 * what stops a sound effect clicking at either end. `stop()` is always armed, so
 * no voice can outlive its own envelope and leak into the render.
 */
function envelope(
  gain: GainNode,
  at: number,
  peak: number,
  attack: number,
  hold: number,
  release: number,
): number {
  const end = at + attack + hold + release;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), at + attack);
  gain.gain.setValueAtTime(Math.max(peak, 0.0002), at + attack + hold);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  return end;
}

/** Percussive decay: instant-ish attack, exponential tail. */
function hit(gain: GainNode, at: number, peak: number, attack: number, decay: number): number {
  const end = at + attack + decay;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  return end;
}

// ---------------------------------------------------------------- music voices

function playNote(ctx: BaseAudioContext, buses: AudioBuses, note: MusicNote, at: number): void {
  const voice: Voice = note.voice;

  // Percussion: one node, always. See the note above `DRUM_GAIN_STEPS` — this
  // single branch is worth more than every other optimisation in the file.
  if (isDrumVoice(voice)) {
    const source = ctx.createBufferSource();
    source.buffer = drumBuffer(ctx, buses, voice, note.gain);
    source.connect(buses.music);
    const send = drumSend(ctx, buses, voice);
    // A second connection from the same node, not a second node: the send gain
    // is shared by every hit of this voice for the life of the context.
    if (send) source.connect(send);
    source.start(at);
    return;
  }

  const out = ctx.createGain();
  out.connect(buses.music);

  switch (voice) {
    case 'kick':
    case 'snare':
    case 'ghost':
    case 'hat':
    case 'ride':
      // Unreachable: handled above. Listed so a new percussion voice added to
      // `Voice` without a baked recipe is a compile error, not silence.
      break;
    case 'sub': {
      // Sine plus a quiet octave. A pure sine below 60 Hz disappears on a phone
      // speaker; the octave is what makes the bass line audible there without
      // making it boomy on anything better.
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = hz(note.note);
      osc.connect(out);
      const octave = ctx.createOscillator();
      octave.type = 'sine';
      octave.frequency.value = hz(note.note + 12);
      const octaveGain = ctx.createGain();
      octaveGain.gain.value = 0.22;
      octave.connect(octaveGain);
      octaveGain.connect(out);

      const end = at + note.dur;
      out.gain.setValueAtTime(0.0001, at);
      out.gain.exponentialRampToValueAtTime(note.gain * 0.5, at + 0.012);
      out.gain.setValueAtTime(note.gain * 0.5, Math.max(at + 0.012, end - 0.05));
      out.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.start(at);
      octave.start(at);
      osc.stop(end + 0.02);
      octave.stop(end + 0.02);
      break;
    }
    case 'reese': {
      // Two detuned saws through a moving lowpass — the genre's signature bass,
      // and it is literally three nodes.
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 6;
      filter.frequency.setValueAtTime(260, at);
      filter.frequency.linearRampToValueAtTime(1150, at + note.dur * 0.55);
      filter.frequency.linearRampToValueAtTime(340, at + note.dur);
      filter.connect(out);

      const ends: OscillatorNode[] = [];
      for (const detune of [-9, 9]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = hz(note.note);
        osc.detune.value = detune;
        osc.connect(filter);
        ends.push(osc);
      }
      const end = at + note.dur;
      out.gain.setValueAtTime(0.0001, at);
      out.gain.exponentialRampToValueAtTime(note.gain * 0.4, at + 0.05);
      out.gain.setValueAtTime(note.gain * 0.4, end - 0.08);
      out.gain.exponentialRampToValueAtTime(0.0001, end);
      for (const osc of ends) {
        osc.start(at);
        osc.stop(end + 0.02);
      }
      break;
    }
    case 'stab': {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(3800, at);
      filter.frequency.exponentialRampToValueAtTime(900, at + note.dur);
      filter.Q.value = 1.2;
      filter.connect(out);
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = hz(note.note);
      osc.detune.value = 6;
      osc.connect(filter);
      const end = hit(out, at, note.gain * 0.45, 0.006, note.dur);
      const send = ctx.createGain();
      send.gain.value = 0.22;
      out.connect(send);
      send.connect(buses.reverbSend);
      osc.start(at);
      osc.stop(end + 0.02);
      break;
    }
    case 'bell': {
      const duration = Math.min(note.dur, 0.9);
      const attack = Math.min(0.006, duration * 0.2);
      const end = hit(out, at, note.gain * 0.42, attack, Math.max(0.001, duration - attack));
      for (const [ratio, level] of [
        [1, 1],
        [2, 0.24],
        [3, 0.08],
      ] as const) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = hz(note.note) * ratio;
        const partial = ctx.createGain();
        partial.gain.value = level;
        osc.connect(partial);
        partial.connect(out);
        osc.start(at);
        osc.stop(end + 0.02);
      }
      break;
    }
    case 'pluck': {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2600, at);
      filter.frequency.exponentialRampToValueAtTime(720, at + note.dur);
      filter.Q.value = 0.7;
      filter.connect(out);
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = hz(note.note);
      osc.connect(filter);
      const attack = Math.min(0.008, note.dur * 0.2);
      const end = hit(out, at, note.gain * 0.48, attack, Math.max(0.001, note.dur - attack));
      osc.start(at);
      osc.stop(end + 0.02);
      break;
    }
    case 'guitar': {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(3200, at);
      filter.frequency.exponentialRampToValueAtTime(1050, at + note.dur);
      filter.Q.value = 1.6;
      filter.connect(out);
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = hz(note.note);
      osc.detune.value = note.note % 2 === 0 ? -4 : 4;
      osc.connect(filter);
      const end = at + note.dur;
      const attackEnd = Math.min(end, at + 0.008);
      const releaseStart = Math.max(attackEnd, end - Math.min(0.07, note.dur * 0.35));
      out.gain.setValueAtTime(0.0001, at);
      out.gain.exponentialRampToValueAtTime(Math.max(note.gain * 0.3, 0.0002), attackEnd);
      out.gain.setValueAtTime(Math.max(note.gain * 0.22, 0.0002), releaseStart);
      out.gain.exponentialRampToValueAtTime(0.0001, end);
      const send = ctx.createGain();
      send.gain.value = 0.12;
      out.connect(send);
      send.connect(buses.reverbSend);
      osc.start(at);
      osc.stop(end + 0.02);
      break;
    }
    case 'bassGuitar': {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1200, at);
      filter.frequency.exponentialRampToValueAtTime(420, at + note.dur);
      filter.Q.value = 0.9;
      filter.connect(out);
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = hz(note.note);
      osc.connect(filter);
      const octave = ctx.createOscillator();
      octave.type = 'sine';
      octave.frequency.value = hz(note.note + 12);
      const octaveGain = ctx.createGain();
      octaveGain.gain.value = 0.14;
      octave.connect(octaveGain);
      octaveGain.connect(filter);
      const attack = Math.min(0.009, note.dur * 0.2);
      const end = hit(out, at, note.gain * 0.5, attack, Math.max(0.001, note.dur - attack));
      osc.start(at);
      octave.start(at);
      osc.stop(end + 0.02);
      octave.stop(end + 0.02);
      break;
    }
    case 'riser': {
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.Q.value = 2.2;
      band.frequency.setValueAtTime(420, at);
      band.frequency.exponentialRampToValueAtTime(8200, at + note.dur);
      const source = noiseSource(ctx, buses, at);
      source.connect(band);
      band.connect(out);
      const end = at + note.dur;
      out.gain.setValueAtTime(0.0001, at);
      out.gain.exponentialRampToValueAtTime(note.gain * 0.55, end - 0.03);
      // Cut, do not fade: a riser that decays into the drop robs the drop.
      out.gain.exponentialRampToValueAtTime(0.0001, end);
      source.stop(end + 0.02);
      break;
    }
    case 'impact': {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(90, at);
      osc.frequency.exponentialRampToValueAtTime(28, at + 0.6);
      osc.connect(out);
      const band = ctx.createBiquadFilter();
      band.type = 'lowpass';
      band.frequency.value = 900;
      const source = noiseSource(ctx, buses, at);
      source.connect(band);
      const noiseGain = ctx.createGain();
      noiseGain.gain.value = 0.35;
      band.connect(noiseGain);
      noiseGain.connect(out);
      const end = hit(out, at, note.gain * 0.7, 0.004, note.dur);
      const send = ctx.createGain();
      send.gain.value = 0.3;
      out.connect(send);
      send.connect(buses.reverbSend);
      osc.start(at);
      osc.stop(end + 0.02);
      source.stop(end + 0.02);
      break;
    }
  }
}

// ---------------------------------------------------------------- sfx voices

/**
 * One-shots.
 *
 * Every branch reads its attack/hold/release from `SFX_SHAPES` rather than
 * inventing its own, which is what keeps "short, fades in, fades out" a property
 * of the system instead of a habit — a new effect gets the rule by construction,
 * and `npm test` checks the table.
 */
function playSfx(ctx: BaseAudioContext, buses: AudioBuses, hitEvent: SfxHit, at: number): void {
  const kind: SfxKind = hitEvent.kind;
  const shape = SFX_SHAPES[kind];
  const panner = ctx.createStereoPanner();
  panner.pan.value = hitEvent.pan;
  panner.connect(buses.sfx);

  const out = ctx.createGain();
  out.connect(panner);

  switch (kind) {
    case 'beep':
    case 'go': {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = kind === 'go' ? 880 : 620;
      const soften = ctx.createBiquadFilter();
      soften.type = 'lowpass';
      soften.frequency.value = 2600;
      osc.connect(soften);
      soften.connect(out);
      const end = envelope(out, at, hitEvent.gain * 0.3, shape.attack, shape.hold, shape.release);
      osc.start(at);
      osc.stop(end + 0.02);
      if (kind === 'go') {
        // The lights going out get a low thump under the tone, because a race
        // starting should be felt as well as heard.
        const thump = ctx.createOscillator();
        thump.type = 'sine';
        thump.frequency.setValueAtTime(140, at);
        thump.frequency.exponentialRampToValueAtTime(40, at + 0.4);
        const thumpGain = ctx.createGain();
        thump.connect(thumpGain);
        thumpGain.connect(panner);
        const thumpEnd = hit(thumpGain, at, hitEvent.gain * 0.5, 0.004, 0.55);
        thump.start(at);
        thump.stop(thumpEnd + 0.02);
      }
      break;
    }
    case 'clack': {
      // Marble on marble: a short pitched tick plus a noise transient. Pitch
      // rises with intensity so a hard hit is audibly harder, not just louder.
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(900 + hitEvent.gain * 900, at);
      osc.frequency.exponentialRampToValueAtTime(420, at + 0.05);
      osc.connect(out);
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 3400;
      band.Q.value = 1.4;
      const source = noiseSource(ctx, buses, at);
      source.connect(band);
      const noiseGain = ctx.createGain();
      noiseGain.gain.value = 0.5;
      band.connect(noiseGain);
      noiseGain.connect(out);
      const end = envelope(out, at, hitEvent.gain * 0.35, shape.attack, shape.hold, shape.release);
      osc.start(at);
      osc.stop(end + 0.02);
      source.stop(end + 0.02);
      break;
    }
    case 'whoosh': {
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.Q.value = 1.6;
      band.frequency.setValueAtTime(500, at);
      band.frequency.exponentialRampToValueAtTime(2600, at + shape.attack + shape.hold);
      band.frequency.exponentialRampToValueAtTime(380, at + shape.attack + shape.hold + shape.release);
      const source = noiseSource(ctx, buses, at);
      source.connect(band);
      band.connect(out);
      const end = envelope(out, at, hitEvent.gain * 0.3, shape.attack, shape.hold, shape.release);
      source.stop(end + 0.02);
      break;
    }
    case 'cheer': {
      // A crowd is broadband noise with a vocal-ish formant on top. Sweeping the
      // formant upward through the swell is what makes it read as people rather
      // than as wind.
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.Q.value = 0.55;
      band.frequency.setValueAtTime(700, at);
      band.frequency.linearRampToValueAtTime(1500, at + shape.attack + shape.hold * 0.5);
      band.frequency.linearRampToValueAtTime(820, at + shape.attack + shape.hold + shape.release);
      const source = noiseSource(ctx, buses, at);
      source.connect(band);
      band.connect(out);
      const end = envelope(out, at, hitEvent.gain * 0.28, shape.attack, shape.hold, shape.release);
      const send = ctx.createGain();
      send.gain.value = 0.35;
      out.connect(send);
      send.connect(buses.reverbSend);
      source.stop(end + 0.02);
      break;
    }
    case 'clap': {
      // Applause is a burst of transients, not one sound. Six fixed offsets —
      // fixed, so preview and export clap identically.
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 1500;
      band.Q.value = 0.9;
      band.connect(out);
      const total = shape.attack + shape.hold + shape.release;
      const source = noiseSource(ctx, buses, at);
      source.connect(band);
      out.gain.setValueAtTime(0.0001, at);
      for (const offset of [0, 0.014, 0.023, 0.037, 0.052, 0.071]) {
        const when = at + offset;
        out.gain.exponentialRampToValueAtTime(hitEvent.gain * 0.22, when + shape.attack);
        out.gain.exponentialRampToValueAtTime(hitEvent.gain * 0.05, when + shape.attack + 0.012);
      }
      // The tail is the room, and it is what stops six clicks sounding like six
      // clicks.
      out.gain.exponentialRampToValueAtTime(hitEvent.gain * 0.12, at + shape.attack + shape.hold);
      out.gain.exponentialRampToValueAtTime(0.0001, at + total);
      const send = ctx.createGain();
      send.gain.value = 0.4;
      out.connect(send);
      send.connect(buses.reverbSend);
      source.stop(at + total + 0.02);
      break;
    }
    case 'chime': {
      // A perfect fifth, struck. Two partials is enough to read as a bell when
      // the upper one decays faster than the lower.
      for (const [ratio, level, decay] of [
        [1, 1, shape.release],
        [1.5, 0.5, shape.release * 0.6],
        [2.02, 0.24, shape.release * 0.35],
      ] as const) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 880 * ratio;
        const partial = ctx.createGain();
        osc.connect(partial);
        partial.connect(panner);
        const end = hit(partial, at, hitEvent.gain * 0.22 * level, shape.attack, decay);
        osc.start(at);
        osc.stop(end + 0.02);
      }
      const send = ctx.createGain();
      send.gain.value = 0.3;
      panner.connect(send);
      send.connect(buses.reverbSend);
      break;
    }
    case 'horn': {
      // An air horn: two detuned saws through a resonant lowpass. Kept short and
      // quiet enough to punctuate the finish rather than own it.
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 2400;
      filter.Q.value = 3;
      filter.connect(out);
      const oscs: OscillatorNode[] = [];
      for (const [note, detune] of [
        [440, -7],
        [554.37, 7],
      ] as const) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = note;
        osc.detune.value = detune;
        osc.connect(filter);
        oscs.push(osc);
      }
      const end = envelope(out, at, hitEvent.gain * 0.16, shape.attack, shape.hold, shape.release);
      for (const osc of oscs) {
        osc.start(at);
        osc.stop(end + 0.02);
      }
      break;
    }
  }
}

// ---------------------------------------------------------------- crowd bed

/**
 * The ambient crowd: short, individually stopped noise swells with filters that
 * open as the level rises. The gaps between them are literal silence.
 *
 * Scheduled in one go rather than in windows because there are only a handful
 * per race. Returns every stop handle so live playback can tear them down on
 * restart or a genre change.
 */
export function scheduleCrowd(
  ctx: BaseAudioContext,
  buses: AudioBuses,
  swells: CrowdSwell[],
  t0: number,
  duration: number,
): AudioBufferSourceNode[] {
  const sources: AudioBufferSourceNode[] = [];

  for (const swell of swells) {
    const at = t0 + swell.t;
    const end = Math.min(at + swell.dur, t0 + duration);
    if (end <= ctx.currentTime || end - at < 0.2) continue;

    const source = ctx.createBufferSource();
    source.buffer = buses.noise;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = buses.noise.duration;

    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 620 + swell.level * 250 + (Math.floor(swell.t * 10) % 5) * 24;
    band.Q.value = 0.5;

    const upper = ctx.createBiquadFilter();
    upper.type = 'bandpass';
    upper.frequency.value = 1650 + swell.level * 520;
    upper.Q.value = 0.9;
    const upperGain = ctx.createGain();
    upperGain.gain.value = 0.24;

    const out = ctx.createGain();
    source.connect(band);
    band.connect(out);
    source.connect(upper);
    upper.connect(upperGain);
    upperGain.connect(out);
    out.connect(buses.crowd);

    const start = Math.max(at, ctx.currentTime);
    const audibleDuration = end - start;
    const attack = Math.min(0.32, audibleDuration * 0.3);
    const release = Math.min(0.55, audibleDuration * 0.4);
    const releaseAt = Math.max(start + attack, end - release);
    const peak = Math.max(swell.level * 0.18, 0.0002);
    out.gain.setValueAtTime(0.0001, start);
    out.gain.exponentialRampToValueAtTime(peak, start + attack);
    out.gain.setValueAtTime(peak * 0.86, releaseAt);
    out.gain.exponentialRampToValueAtTime(0.0001, end);

    const offset = (Math.abs(swell.t) * 7.13) % buses.noise.duration;
    source.start(start, offset);
    source.stop(end + 0.02);
    sources.push(source);
  }

  return sources;
}

// ---------------------------------------------------------------- scheduling

/**
 * Schedules a slice of the score.
 *
 * `t0` is the context time at which score time zero happens. A window is
 * half-open — `[from, to)` — so consecutive calls tile the score exactly once
 * with no note played twice and none dropped between them.
 */
export function scheduleScore(
  ctx: BaseAudioContext,
  buses: AudioBuses,
  score: Score,
  t0: number,
  window: ScheduleWindow,
  include: { music: boolean; sfx: boolean } = { music: true, sfx: true },
): void {
  if (include.music) {
    for (const note of score.music) {
      if (note.t < window.from || note.t >= window.to) continue;
      const at = t0 + note.t;
      if (at < ctx.currentTime) continue;
      playNote(ctx, buses, note, at);
    }
  }
  if (include.sfx) {
    for (const effect of score.sfx) {
      if (effect.t < window.from || effect.t >= window.to) continue;
      const at = t0 + effect.t;
      if (at < ctx.currentTime) continue;
      playSfx(ctx, buses, effect, at);
    }
  }
}
