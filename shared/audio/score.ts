/**
 * The soundtrack, as data.
 *
 * This file turns a race into a **score**: a list of timed notes, a list of
 * timed sound effects, and a curve describing how excited the crowd is. It
 * contains no Web Audio, no oscillators and no DOM — exactly the same split the
 * project already makes between `shared/sim.ts` and `client/scene`, and for the
 * same reason. The score is renderer-free, so `npm test` can assert things about
 * the music in node, and a future consumer (a server-side mixdown, a MIDI
 * export, a visualiser) is a second reader rather than a rewrite.
 *
 * ## The three rails
 *
 * 1. **Same seed, same soundtrack.** Every random choice comes from a cosmetic
 *    RNG stream keyed on the seed. Nothing here can reach the simulator, so a
 *    change to the music can never change who wins.
 * 2. **Written against events, never against a clock.** Export runs faster than
 *    realtime, so anything derived from wall-clock playback would desync the
 *    moment a frame took longer than 1/30 s. Every time in this file is a
 *    position in the finished video, measured from frame 0.
 * 3. **We know the whole race before it starts.** The sim is fully computed
 *    before a note is scheduled, so the arrangement can be laid down *against*
 *    the race — the drop lands exactly on lights-out, the breakdown backs off
 *    when the field is strung out, and the last phrase builds into a finish the
 *    music already knows is coming. Live-reactive systems cannot do that.
 *
 * ## Why it is synthesised rather than sampled
 *
 * PLAN §5.1 calls Content ID, not licensing, the real risk: a properly licensed
 * loop can still be *in* YouTube's fingerprint database, and this tool exists to
 * make videos people upload. Procedural drum and bass has no fingerprint to
 * match, ships as a few kilobytes of arithmetic instead of megabytes of audio,
 * and is deterministic for free.
 */
import { COUNTDOWN, type SimEvent, type SimSummary, type TensionSample } from '../sim.ts';
import { COSMETIC, stream, type Rng } from '../rng.ts';
import { clamp } from '../vec3.ts';
import type { RaceSpec } from '../spec.ts';

// ---------------------------------------------------------------- tempo

/**
 * 174 BPM — the tempo drum and bass has run at for thirty years, and the reason
 * the arithmetic below lands so cleanly against the race.
 */
export const BPM = 174;
/** Seconds per beat. */
export const BEAT = 60 / BPM;
/** Seconds per 4/4 bar. */
export const BAR = BEAT * 4;
/** Sixteenth note. The grid everything in the arrangement snaps to. */
export const STEP = BAR / 16;

/**
 * Bars of intro before the lights go out.
 *
 * Two bars is 2.759 s against a 3 s countdown, so the bar grid is anchored at
 * `COUNTDOWN - 2 * BAR` and **the drop lands exactly on lights-out** rather than
 * near it. That single alignment is most of what makes the music feel like it
 * belongs to the race instead of being played underneath it.
 */
export const INTRO_BARS = 2;

/** Video time at which the bar grid begins. */
export const BAR_ZERO = COUNTDOWN - INTRO_BARS * BAR;

// ---------------------------------------------------------------- music

export type Voice =
  | 'kick'
  | 'snare'
  | 'ghost'
  | 'hat'
  | 'ride'
  | 'sub'
  | 'reese'
  | 'stab'
  | 'riser'
  | 'impact';

export interface MusicNote {
  /** Seconds from the first frame of the video. */
  t: number;
  voice: Voice;
  /** MIDI note number. Ignored by the percussion voices. */
  note: number;
  /** 0-1. */
  gain: number;
  /** Seconds. The synth may shorten a note but never lengthen it past this. */
  dur: number;
}

// ---------------------------------------------------------------- sfx

export type SfxKind =
  | 'beep'
  | 'go'
  | 'clack'
  | 'whoosh'
  | 'cheer'
  | 'clap'
  | 'chime'
  | 'horn';

export interface SfxHit {
  t: number;
  kind: SfxKind;
  /** 0-1. */
  gain: number;
  /** Stereo position, -1 left to 1 right. */
  pan: number;
}

/**
 * The shape of every one-shot, in one table.
 *
 * **The rail this table exists to enforce: an effect is short, it fades in, and
 * it fades out.** A sound effect that starts at full amplitude clicks, one that
 * stops at full amplitude clicks louder, and one that outstays its welcome turns
 * a race into a noise floor. Putting the envelopes here rather than inside the
 * synth means `npm test` can assert the rule instead of trusting that whoever
 * writes the next effect remembers it — and the music bed is deliberately *not*
 * in this table, because a continuous arrangement is the one thing that is
 * allowed to be long.
 */
export interface SfxShape {
  /** Fade-in, seconds. Never zero. */
  attack: number;
  /** Full-amplitude portion, seconds. May be zero for a transient. */
  hold: number;
  /** Fade-out, seconds. Never zero. */
  release: number;
}

/** Nothing in `SFX_SHAPES` may last longer than this. */
export const SFX_MAX_SECONDS = 1.8;

export const SFX_SHAPES: Record<SfxKind, SfxShape> = {
  // Countdown pip. Tiny, so five of them read as a rhythm rather than a drone.
  beep: { attack: 0.006, hold: 0.05, release: 0.09 },
  // Lights out. The one effect allowed to be a statement.
  go: { attack: 0.004, hold: 0.06, release: 0.7 },
  // Marble on marble. Percussive by nature; the fades exist to stop the click.
  clack: { attack: 0.002, hold: 0.008, release: 0.09 },
  // A marble going past the camera.
  whoosh: { attack: 0.09, hold: 0.02, release: 0.22 },
  // The crowd reacting to something. Swells in, decays out.
  cheer: { attack: 0.18, hold: 0.3, release: 0.75 },
  clap: { attack: 0.01, hold: 0.22, release: 0.45 },
  // Crossing the line.
  chime: { attack: 0.005, hold: 0.04, release: 0.95 },
  horn: { attack: 0.02, hold: 0.34, release: 0.3 },
};

export const sfxSeconds = (kind: SfxKind): number => {
  const shape = SFX_SHAPES[kind];
  return shape.attack + shape.hold + shape.release;
};

// ---------------------------------------------------------------- score

export interface CrowdPoint {
  t: number;
  /** 0-1. Drives the ambient crowd bed, and nothing else. */
  level: number;
}

export interface Score {
  seed: string;
  /** Seconds. Always exactly the video's duration. */
  duration: number;
  bpm: number;
  /** Video time of lights-out, which is also the drop. */
  dropAt: number;
  music: MusicNote[];
  sfx: SfxHit[];
  crowd: CrowdPoint[];
}

/**
 * Safety valve on the note count.
 *
 * Every note becomes three or four Web Audio nodes, and an `OfflineAudioContext`
 * needs all of them constructed before rendering starts. A 150-second race at
 * the busiest energy would otherwise build tens of thousands of nodes on a phone
 * that is already holding a supersampled frame buffer.
 */
const MAX_NOTES = 6000;

/**
 * Roots to choose from, as MIDI notes.
 *
 * All minor, all low. The choice is cosmetic — it changes the key of the
 * soundtrack and nothing else — but it means two races do not sound like the
 * same track twice.
 */
const ROOTS = [38, 40, 41, 43, 45];

/**
 * Semitone offsets of the four chords, one per two bars.
 *
 * i - VI - III - VII in natural minor: the progression that underpins most of
 * the genre, and it resolves without ever needing a leading tone.
 */
const PROGRESSION = [0, 8, 3, 10];

/** Energy of a bar: 0 intro, 1 breakdown, 2 body, 3 drop. */
type Energy = 0 | 1 | 2 | 3;

export interface ScoreOptions {
  /**
   * Override the seed used for the cosmetic choices (key, fills). Defaults to
   * the spec's seed, which is what makes a shared link sound identical.
   */
  seed?: string;
}

/**
 * Builds the whole soundtrack for a race.
 *
 * Needs a summary produced with `trace: true` — without the contact events and
 * the tension curve the arrangement still works, it just loses the marble
 * impacts and arranges to a flat race instead of the real one.
 */
export function buildScore(
  spec: RaceSpec,
  summary: SimSummary,
  options: ScoreOptions = {},
): Score {
  const seed = options.seed ?? spec.seed;
  const rng = stream(seed, COSMETIC.music);
  const duration = summary.videoDuration;
  const dropAt = COUNTDOWN;

  const tension = tensionLookup(summary.tension, summary.endTime);
  const energies = planEnergy(summary.endTime, duration, tension, rng);

  const music = arrange(energies, rng, summary.endTime);
  const sfx = soundEffects(spec, summary.events, duration);
  const crowd = crowdBed(summary.tension, summary.events, duration);

  return { seed, duration, bpm: BPM, dropAt, music, sfx, crowd };
}

// ---------------------------------------------------------------- arrangement

/**
 * Reads the tension curve at any video time.
 *
 * Returns 0 before lights-out (nothing has happened yet) and holds the final
 * value through the outro, so the last phrase of music does not deflate the
 * instant the winner crosses the line.
 */
function tensionLookup(samples: TensionSample[], endTime: number): (t: number) => number {
  if (samples.length === 0) return () => 0.5;
  return (t: number): number => {
    if (t < COUNTDOWN) return 0;
    if (t >= endTime) return samples[samples.length - 1].level;
    // The samples are evenly spaced at 5 Hz, so this is an index rather than a
    // search — worth it because the planner calls it once per bar per race and
    // the crowd bed calls it a few hundred times.
    const first = samples[0].t;
    const spacing = samples.length > 1 ? (samples[samples.length - 1].t - first) / (samples.length - 1) : 1;
    const index = clamp(Math.round((t - first) / spacing), 0, samples.length - 1);
    return samples[index].level;
  };
}

/**
 * One energy value per bar, for the whole video.
 *
 * The 16-bar cycle underneath is the genre's own structure — eight bars of drop,
 * four of breakdown, four building back — and the race is then allowed to
 * override it: a bar where the front two are fighting is a drop bar whatever the
 * cycle says, and the last few bars before the finish always are. That ordering
 * is the point. The form gives it shape; the race gives it meaning.
 */
function planEnergy(
  endTime: number,
  duration: number,
  tension: (t: number) => number,
  rng: Rng,
): Energy[] {
  const bars = Math.max(INTRO_BARS + 1, Math.ceil((duration - BAR_ZERO) / BAR));
  const finishBar = (endTime - BAR_ZERO) / BAR;
  // A phrase offset drawn from the seed, so two races of the same length do not
  // put the breakdown in the same place.
  const offset = rng.int(4) * 4;

  const energies: Energy[] = [];
  for (let bar = 0; bar < bars; bar++) {
    if (bar < INTRO_BARS) {
      energies.push(0);
      continue;
    }
    if (bar >= finishBar) {
      // After the flag: one bar of aftermath, then out of the way of the crowd.
      energies.push(bar >= finishBar + 2 ? 0 : 1);
      continue;
    }

    const phase = (bar - INTRO_BARS + offset) % 16;
    let energy: Energy = phase < 8 ? 3 : phase < 12 ? 1 : 2;

    const level = tension(BAR_ZERO + (bar + 0.5) * BAR);
    if (level > 0.66) energy = 3;
    else if (level < 0.34 && energy === 3) energy = 2;
    // The run-in is always full: the finish is the loudest thing in the race.
    if (bar >= finishBar - 4) energy = 3;

    energies.push(energy);
  }
  return energies;
}

/** Appends a note if there is room in the budget. */
function push(notes: MusicNote[], note: MusicNote): void {
  if (notes.length < MAX_NOTES) notes.push(note);
}

/**
 * Lays the notes down bar by bar.
 *
 * The percussion is the classic two-step: kick on the first sixteenth and the
 * eleventh, snare on the fifth and thirteenth. That single pattern is what makes
 * 174 BPM feel like ~87 to the listener, which is why drum and bass can be this
 * fast and still sit under something without exhausting anyone.
 */
function arrange(energies: Energy[], rng: Rng, endTime: number): MusicNote[] {
  const notes: MusicNote[] = [];
  const root = rng.pick(ROOTS);

  for (let bar = 0; bar < energies.length; bar++) {
    const barStart = BAR_ZERO + bar * BAR;
    const energy = energies[bar];
    const chord = PROGRESSION[Math.floor(bar / 2) % PROGRESSION.length];
    const at = (step: number): number => barStart + step * STEP;
    const last = bar === energies.length - 1;

    if (energy === 0) {
      // ---- intro: air, a pulse, and a riser that resolves on the drop.
      push(notes, { t: barStart, voice: 'hat', note: 0, gain: 0.16, dur: 0.05 });
      push(notes, { t: at(4), voice: 'hat', note: 0, gain: 0.12, dur: 0.05 });
      push(notes, { t: at(8), voice: 'hat', note: 0, gain: 0.16, dur: 0.05 });
      push(notes, { t: at(12), voice: 'hat', note: 0, gain: 0.12, dur: 0.05 });
      if (bar === 0) {
        push(notes, {
          t: barStart,
          voice: 'riser',
          note: root + 12,
          gain: 0.34,
          dur: INTRO_BARS * BAR,
        });
      }
      if (bar === INTRO_BARS - 1) {
        push(notes, { t: at(12), voice: 'snare', note: 0, gain: 0.4, dur: 0.2 });
        push(notes, { t: at(14), voice: 'snare', note: 0, gain: 0.55, dur: 0.2 });
      }
      continue;
    }

    // The downbeat of every drop bar that follows a quieter one gets the impact.
    if (energy === 3 && (bar === 0 || energies[bar - 1] < 3)) {
      push(notes, { t: barStart, voice: 'impact', note: root - 12, gain: 0.7, dur: 1.6 });
    }

    // ---- drums
    if (energy >= 2) {
      push(notes, { t: barStart, voice: 'kick', note: 0, gain: 0.9, dur: 0.3 });
      push(notes, { t: at(10), voice: 'kick', note: 0, gain: 0.8, dur: 0.3 });
      push(notes, { t: at(4), voice: 'snare', note: 0, gain: 0.85, dur: 0.25 });
      push(notes, { t: at(12), voice: 'snare', note: 0, gain: 0.85, dur: 0.25 });
      if (energy === 3) {
        // Fills, drawn from the seed so a phrase does not repeat verbatim.
        if (rng.chance(0.4)) push(notes, { t: at(6), voice: 'kick', note: 0, gain: 0.6, dur: 0.3 });
        if (rng.chance(0.5)) push(notes, { t: at(14), voice: 'ghost', note: 0, gain: 0.3, dur: 0.1 });
        if (rng.chance(0.3)) push(notes, { t: at(7), voice: 'ghost', note: 0, gain: 0.22, dur: 0.1 });
      }
    } else {
      push(notes, { t: at(12), voice: 'snare', note: 0, gain: 0.5, dur: 0.25 });
    }

    // ---- hats: eighths as the floor, extra sixteenths only where it lifts.
    for (let step = 0; step < 16; step += 2) {
      const accent = step % 8 === 0;
      push(notes, {
        t: at(step),
        voice: energy === 1 ? 'ride' : 'hat',
        note: 0,
        gain: (accent ? 0.3 : 0.19) * (energy === 1 ? 0.8 : 1),
        dur: energy === 1 ? 0.3 : 0.05,
      });
    }
    if (energy === 3) {
      for (const step of [6, 7, 14, 15]) {
        push(notes, { t: at(step), voice: 'hat', note: 0, gain: 0.13, dur: 0.04 });
      }
    }

    // ---- bass
    const bassNote = root + chord - 12;
    if (energy >= 2) {
      push(notes, { t: barStart, voice: 'sub', note: bassNote, gain: 0.85, dur: STEP * 9 });
      push(notes, { t: at(10), voice: 'sub', note: bassNote, gain: 0.75, dur: STEP * 5 });
    } else {
      push(notes, { t: barStart, voice: 'sub', note: bassNote, gain: 0.6, dur: BAR * 0.9 });
    }
    if (energy === 3) {
      push(notes, { t: barStart, voice: 'reese', note: bassNote + 12, gain: 0.34, dur: BAR });
    }

    // ---- chords
    //
    // One stab per bar at full energy, one every other bar below it. Three
    // voiced notes each, so this is the densest thing in the arrangement after
    // the hats — and it was twice this, which was both muddier to listen to and
    // several hundred extra Web Audio nodes per race.
    if (energy >= 2 && (energy === 3 || bar % 2 === 1)) {
      const third = chord === 0 ? 3 : 4; // minor tonic, major everywhere else
      for (const interval of [0, third, 7]) {
        push(notes, {
          t: at(11),
          voice: 'stab',
          note: root + chord + interval + 12,
          gain: 0.16,
          dur: STEP * 3,
        });
      }
    }

    // A riser into the next drop, so the return is announced rather than abrupt.
    if (!last && energy < 3 && energies[bar + 1] === 3) {
      push(notes, { t: barStart, voice: 'riser', note: root + 12, gain: 0.28, dur: BAR });
    }
  }

  // Nothing after the flag but the tail of what is already ringing.
  return notes.filter((note) => note.t < endTime + 2.2);
}

// ---------------------------------------------------------------- effects

/**
 * Sound effects, straight off the event list.
 *
 * Pan comes from the marble id rather than its position on screen. Position
 * would be more correct and less useful: the chase camera swings constantly, so
 * a correctly-panned impact slides across the stereo field for reasons the
 * listener cannot see. A fixed per-marble seat keeps eight simultaneous events
 * separable, which is the actual job.
 */
function soundEffects(spec: RaceSpec, events: SimEvent[], duration: number): SfxHit[] {
  const hits: SfxHit[] = [];
  const count = Math.max(1, spec.marbles.length - 1);
  const seat = (id: number | undefined): number =>
    id === undefined ? 0 : ((id / count) * 2 - 1) * 0.55;

  const add = (t: number, kind: SfxKind, gain: number, pan = 0): void => {
    // Never schedule an effect that would be cut off by the end of the file: a
    // truncated release is exactly the click the envelopes exist to prevent.
    if (t < 0 || t + sfxSeconds(kind) > duration) return;
    hits.push({ t, kind, gain: clamp(gain, 0, 1), pan: clamp(pan, -1, 1) });
  };

  // Five lights, matching `StartLights` exactly: one every COUNTDOWN/6 seconds.
  for (let light = 1; light <= 5; light++) {
    add((light * COUNTDOWN) / 6, 'beep', 0.5, 0);
  }

  for (const event of events) {
    switch (event.kind) {
      case 'go':
        add(event.t, 'go', 1);
        add(event.t + 0.05, 'cheer', 0.7);
        break;
      case 'collide':
        add(event.t, 'clack', 0.25 + (event.intensity ?? 0) * 0.6, seat(event.marbleId));
        break;
      case 'overtake':
        add(event.t, 'whoosh', 0.55, seat(event.marbleId));
        // A pass is worth a reaction, but a modest one — the crowd bed is
        // already rising underneath, and stacking a full cheer on every one of
        // a dozen overtakes is how a soundtrack turns into a slot machine.
        add(event.t + 0.14, 'cheer', 0.32, seat(event.marbleId) * -0.5);
        break;
      case 'finish':
        if (event.place === 1) {
          add(event.t, 'chime', 0.85);
          add(event.t + 0.06, 'cheer', 1);
          add(event.t + 0.18, 'horn', 0.5);
          add(event.t + 0.5, 'clap', 0.85);
          add(event.t + 1.15, 'clap', 0.5, 0.3);
        } else if ((event.place ?? 9) <= 3) {
          add(event.t, 'clap', 0.3, seat(event.marbleId));
        }
        break;
      default:
        break;
    }
  }

  // Total order, so two effects at the same instant always schedule the same
  // way — the same rule the sim's sorts follow, for the same reason.
  hits.sort((a, b) => a.t - b.t || a.kind.localeCompare(b.kind) || a.pan - b.pan);
  return hits;
}

/**
 * The ambient crowd, as a level curve.
 *
 * One continuous bed rather than a bank of one-shots: a crowd is a *state*, not
 * an event. It rises when the front two are fighting, peaks at the flag, and
 * settles under the podium. The one-shot cheers in `soundEffects` then sit on
 * top of it, which is how a real crowd sounds — a swell you stop noticing, with
 * reactions cutting through it.
 */
function crowdBed(tension: TensionSample[], events: SimEvent[], duration: number): CrowdPoint[] {
  const points: CrowdPoint[] = [{ t: 0, level: 0.12 }];
  const finish = events.find((event) => event.kind === 'finish' && event.place === 1);

  // A hush over the last second of the countdown, so lights-out has somewhere
  // to come from. Silence is the cheapest dynamic range there is.
  points.push({ t: COUNTDOWN - 0.9, level: 0.05 });
  points.push({ t: COUNTDOWN, level: 0.55 });

  // Downsampled to ~2 Hz: the bed is a slow swell and 5 Hz would just be more
  // automation points describing the same shape.
  for (let i = 0; i < tension.length; i += 2) {
    const sample = tension[i];
    if (sample.t <= COUNTDOWN || sample.t >= duration) continue;
    points.push({ t: sample.t, level: clamp(0.16 + sample.level * 0.62, 0, 1) });
  }

  if (finish) {
    points.push({ t: finish.t, level: 1 });
    if (finish.t + 2.5 < duration) points.push({ t: finish.t + 2.5, level: 0.62 });
  }
  points.push({ t: Math.max(0, duration - 0.6), level: 0 });

  points.sort((a, b) => a.t - b.t);
  return points;
}
