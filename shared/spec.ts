/**
 * The race spec is the contract between everything.
 *
 * A seed is the *input* to generation; the spec is the *output*. The spec is
 * fully expanded — every marble trait, every track segment, resolved to numbers
 * — so replaying it needs no generator at all. That is what lets the generator
 * keep evolving without breaking races people already shared, and what lets a
 * future Blender exporter consume a race without importing a line of our
 * simulation code.
 */

/**
 * Bump on ANY change that alters race outcomes: physics constants, integration
 * order, arc-table resolution, segment geometry, RNG stream labels.
 *
 * v1 — first production version.
 */
export const SIM_VERSION = 1;

/** Bump when the generator's taste changes but old specs still replay correctly. */
export const GENERATOR_VERSION = 1;

// ---------------------------------------------------------------- track

export type SegmentKind =
  | 'ramp'
  | 'sweep'
  | 'chicane'
  | 'spiral'
  | 'plunge'
  | 'roller'
  | 'hairpin'
  | 'runout';

/** Straight launch or connector. */
export interface RampSegment {
  k: 'ramp';
  /** Horizontal length, metres. */
  len: number;
  /** Vertical drop over the segment, metres. */
  drop: number;
}

/** Long constant-radius bend. `turn` is the signed total heading change, radians. */
export interface SweepSegment {
  k: 'sweep';
  len: number;
  drop: number;
  turn: number;
}

/** Quick left-right-left. `swing` is the lateral amplitude, `beats` the count. */
export interface ChicaneSegment {
  k: 'chicane';
  len: number;
  drop: number;
  swing: number;
  beats: number;
}

/** Helix. Marbles bunch up here, which is where lead changes come from. */
export interface SpiralSegment {
  k: 'spiral';
  radius: number;
  turns: number;
  drop: number;
  dir: 1 | -1;
}

/** Short and steep — the speed injector. */
export interface PlungeSegment {
  k: 'plunge';
  len: number;
  drop: number;
}

/** Undulating floor. Never actually goes uphill; see `buildSegment`. */
export interface RollerSegment {
  k: 'roller';
  len: number;
  drop: number;
  waves: number;
  amp: number;
}

/** 180-degree turn at a tight radius. */
export interface HairpinSegment {
  k: 'hairpin';
  radius: number;
  drop: number;
  dir: 1 | -1;
}

/** Gentle final straight, where a close finish gets decided. */
export interface RunoutSegment {
  k: 'runout';
  len: number;
  drop: number;
}

export type Segment =
  | RampSegment
  | SweepSegment
  | ChicaneSegment
  | SpiralSegment
  | PlungeSegment
  | RollerSegment
  | HairpinSegment
  | RunoutSegment;

export interface TrackSpec {
  /** Where the grid sits and which way it points (radians in the xz plane). */
  heading: number;
  segments: Segment[];
  /** Inner radius of the glass chute, metres. */
  tubeRadius: number;
  /** Finish line this many metres before the end of the tube (run-off room). */
  finishOffset: number;
}

// ---------------------------------------------------------------- marbles

export interface MarbleSpec {
  id: number;
  name: string;
  /** HSL, 0-1 each. Kept as numbers so any renderer can interpret them. */
  hue: number;
  sat: number;
  light: number;
  /** Rolling resistance coefficient. */
  mu: number;
  /** Aerodynamic drag coefficient. */
  cd: number;
  mass: number;
  /** Lateral sway — cosmetic-looking, but it feeds collision geometry. */
  swayFreq: number;
  swayPhase: number;
  swayAmp: number;
  /** Grid slot, 0 = front row. */
  slot: number;
  /** Which side of the tube it starts on. */
  lane: 1 | -1;
}

// ---------------------------------------------------------------- spec

export type ArchetypeName = 'descenso' | 'helice' | 'guantelete' | 'acantilado' | 'serpiente';

export type PaletteName = 'neon' | 'citrico' | 'hielo' | 'magma' | 'bruma' | 'arcade';

export interface RaceSpec {
  version: number;
  generator: number;
  /** The seed the user sees and shares. */
  seed: string;
  /** Stream root for the per-substep wander noise. Usually equal to `seed`. */
  simSeed: string;
  archetype: ArchetypeName;
  palette: PaletteName;
  track: TrackSpec;
  marbles: MarbleSpec[];
}

/** Everything the curator measured while choosing this race. */
export interface RaceMetrics {
  /** Winner's finish time, seconds. */
  duration: number;
  /** Time between 1st and 2nd, seconds. Small is exciting. */
  finishMargin: number;
  /** Time between 1st and last, seconds. */
  spread: number;
  /** How many times the leader changed (with hysteresis, so no jitter). */
  leadChanges: number;
  /** Lead changes in the final quarter. */
  lateChanges: number;
  /** Fraction of the race the eventual winner spent in front. 1 = runaway. */
  frontRunning: number;
  /** Largest leader-to-last gap seen, metres. */
  maxGap: number;
  /** Whether every marble crossed the line. */
  allFinished: boolean;
}

export interface RaceRecord {
  id: string;
  spec: RaceSpec;
  metrics: RaceMetrics;
  /** Curation score, 0-1. Useful later for the data flywheel (PLAN §2b). */
  score: number;
  /** True when this race skipped curation — the exploration arm (PLAN §2b). */
  exploration: boolean;
  createdAt: number;
}

// ---------------------------------------------------------------- physics constants
//
// These ARE the sim version. Changing any of them changes every race ever run.

export const PHYSICS = {
  /** m/s^2 */
  gravity: 9.8,
  /** A solid sphere rolling without slipping only converts 5/7 of gravity. */
  rollingFactor: 5 / 7,
  /** Fixed simulation substep. */
  dt: 1 / 120,
  marbleRadius: 0.34,
  /** Ornstein-Uhlenbeck luck term. */
  wanderDrive: 9,
  wanderDecay: 1.1,
  wanderClamp: 1.6,
  /** Restitution when a marble rear-ends another. */
  restitution: 0.85,
  /** Deceleration applied after crossing the line. */
  brake: 2.2,
  /** Give up on stragglers this long after the winner. */
  stragglerTimeout: 25,
  /** Hard ceiling so a broken track can never hang the curator. */
  maxRaceSeconds: 150,
} as const;

export const MARBLE_COUNT = 8;
