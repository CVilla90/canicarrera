/**
 * seed -> RaceSpec.
 *
 * The generator is where "exciting map" is decided. Five archetypes each weight
 * the segment grammar differently, so tracks have recognisable characters
 * rather than all being the same winding chute with different numbers.
 *
 * Nothing here is consumed at replay time — the output spec is fully expanded.
 * This file can be rewritten tomorrow without invalidating a single shared race.
 */
import { stream, SIM_STREAMS, type Rng } from './rng.ts';
import {
  GENERATOR_VERSION,
  MARBLE_COUNT,
  SIM_VERSION,
  type ArchetypeName,
  type MarbleSpec,
  type PaletteName,
  type RaceSpec,
  type Segment,
  type TrackSpec,
} from './spec.ts';
import { MARBLE_NAMES, PALETTES, PALETTE_NAMES } from './palette.ts';
import { buildTrack, selfIntersects } from './track.ts';

/** How the body of the track is composed, per archetype. */
interface Grammar {
  label: string;
  /** Spanish one-liner for the UI. */
  blurb: string;
  weights: Partial<Record<Segment['k'], number>>;
  /** Multiplies every segment's slope — the character knob. */
  slopeScale: number;
  lengthRange: [number, number];
}

const GRAMMARS: Record<ArchetypeName, Grammar> = {
  descenso: {
    label: 'Descenso',
    blurb: 'Curvas largas y bajadas limpias.',
    weights: { sweep: 5, chicane: 3, ramp: 2, roller: 2, plunge: 1, spiral: 1 },
    slopeScale: 1,
    lengthRange: [340, 540],
  },
  helice: {
    label: 'Hélice',
    blurb: 'Espirales que aprietan al pelotón.',
    weights: { spiral: 6, sweep: 3, ramp: 2, plunge: 1, roller: 1 },
    slopeScale: 0.95,
    lengthRange: [320, 500],
  },
  guantelete: {
    label: 'Guantelete',
    blurb: 'Chicanas y rizos: nadie se escapa.',
    weights: { chicane: 5, roller: 4, hairpin: 3, sweep: 2, ramp: 1 },
    slopeScale: 0.85,
    lengthRange: [300, 470],
  },
  acantilado: {
    label: 'Acantilado',
    blurb: 'Caídas largas y mucha velocidad.',
    weights: { plunge: 4, sweep: 4, ramp: 3, spiral: 1, chicane: 1 },
    slopeScale: 1.25,
    lengthRange: [420, 660],
  },
  serpiente: {
    label: 'Serpiente',
    blurb: 'Horquillas encadenadas, sin respiro.',
    weights: { hairpin: 5, sweep: 4, chicane: 3, roller: 1 },
    slopeScale: 0.9,
    lengthRange: [320, 520],
  },
};

export const ARCHETYPES = GRAMMARS;
export const ARCHETYPE_NAMES = Object.keys(GRAMMARS) as ArchetypeName[];

/**
 * How much lateral wiggle stretches a chicane's real path beyond its horizontal
 * length. `g` is the peak lateral gradient; the mean of sqrt(1 + g^2 cos^2 x)
 * is within a percent of 1 + g^2/4 over the range we allow.
 */
const chicaneStretch = (swing: number, beats: number, len: number): number => {
  const g = (swing * 2 * Math.PI * beats) / len;
  return 1 + (g * g) / 4;
};

/**
 * True arc length a segment contributes.
 *
 * This must be the REAL path length, not the horizontal one. Slope is defined
 * as drop / path, so getting this wrong makes a segment shallower than intended
 * — which is how the first version produced 93-second races and marbles that
 * crawled to a stop in chicanes.
 */
function segmentLength(seg: Segment): number {
  switch (seg.k) {
    case 'spiral':
      return seg.turns * Math.PI * 2 * seg.radius;
    case 'hairpin':
      return Math.PI * seg.radius;
    case 'chicane':
      return seg.len * chicaneStretch(seg.swing, seg.beats, seg.len);
    default:
      return seg.len;
  }
}

function makeSegment(kind: Segment['k'], rng: Rng, slopeScale: number): Segment {
  const slope = (lo: number, hi: number) => rng.range(lo, hi) * slopeScale;
  switch (kind) {
    case 'ramp': {
      const len = rng.range(24, 46);
      return { k: 'ramp', len, drop: len * slope(0.2, 0.36) };
    }
    case 'sweep': {
      const turn = (rng.chance(0.5) ? 1 : -1) * rng.range(0.7, 2.5);
      const radius = rng.range(13, 30);
      const len = radius * Math.abs(turn);
      return { k: 'sweep', len, drop: len * slope(0.17, 0.31), turn };
    }
    case 'chicane': {
      const len = rng.range(34, 62);
      const beats = rng.chance(0.35) ? 2 : 1;
      // Cap the lateral gradient: past ~1.0 the marbles are travelling sideways
      // more than downhill, and the section turns into a car park.
      const swing = Math.min(rng.range(4, 9), (1.0 * len) / (2 * Math.PI * beats));
      return {
        k: 'chicane',
        len,
        drop: len * chicaneStretch(swing, beats, len) * slope(0.18, 0.32),
        swing,
        beats,
      };
    }
    case 'spiral': {
      const turns = rng.range(1.25, 2.9);
      const radius = rng.range(6.5, 11);
      // Drop per turn has a floor, or the helix folds through itself.
      const dropPerTurn = Math.max(
        rng.range(0.14, 0.24) * slopeScale * (2 * Math.PI * radius),
        4.2,
      );
      return { k: 'spiral', turns, radius, drop: turns * dropPerTurn, dir: rng.chance(0.5) ? 1 : -1 };
    }
    case 'plunge': {
      const len = rng.range(13, 27);
      return { k: 'plunge', len, drop: len * slope(0.5, 0.9) };
    }
    case 'roller': {
      const len = rng.range(42, 78);
      const drop = len * slope(0.11, 0.19);
      const waves = Math.round(rng.range(3, 7));
      return { k: 'roller', len, drop, waves, amp: rng.range(0.5, 1.4) };
    }
    case 'hairpin': {
      const radius = rng.range(7, 13);
      return {
        k: 'hairpin',
        radius,
        drop: Math.PI * radius * slope(0.17, 0.3),
        dir: rng.chance(0.5) ? 1 : -1,
      };
    }
    case 'runout': {
      const len = rng.range(44, 76);
      return { k: 'runout', len, drop: len * rng.range(0.065, 0.11) };
    }
  }
}

function buildTrackSpec(rng: Rng, archetype: ArchetypeName): TrackSpec {
  const grammar = GRAMMARS[archetype];
  const kinds = Object.keys(grammar.weights) as Segment['k'][];
  const weights = kinds.map((k) => grammar.weights[k] ?? 0);
  const target = rng.range(grammar.lengthRange[0], grammar.lengthRange[1]);

  // Launch ramp: everyone needs the same clean start before luck gets a vote.
  const launch: Segment = { k: 'ramp', len: rng.range(30, 42), drop: rng.range(9, 14) };
  const segments: Segment[] = [launch];
  let length = segmentLength(launch);

  // Reserve room for the run-out, where close finishes actually happen.
  const runout = makeSegment('runout', rng, grammar.slopeScale) as Segment;
  const budget = target - segmentLength(runout);

  let lastKind: Segment['k'] | null = null;
  let repeats = 0;
  let guard = 60;
  while (length < budget && guard-- > 0) {
    let kind = rng.weighted(kinds, weights);
    // Three of anything in a row stops reading as rhythm and starts reading as
    // a bug in the generator.
    if (kind === lastKind && repeats >= 1) {
      kind = rng.weighted(kinds, weights);
      if (kind === lastKind) kind = kinds.find((k) => k !== lastKind) ?? kind;
    }
    repeats = kind === lastKind ? repeats + 1 : 0;
    lastKind = kind;

    const seg = makeSegment(kind, rng, grammar.slopeScale);
    segments.push(seg);
    length += segmentLength(seg);
  }
  segments.push(runout);

  return {
    heading: rng.range(0, Math.PI * 2),
    segments,
    tubeRadius: 0.95,
    finishOffset: rng.range(10, 16),
  };
}

function buildMarbles(rng: Rng, grid: Rng, palette: PaletteName): MarbleSpec[] {
  const names = rng.shuffle(MARBLE_NAMES.slice()).slice(0, MARBLE_COUNT);
  const slots = grid.shuffle([...Array(MARBLE_COUNT).keys()]);
  const hueOffset = rng.next();
  const world = PALETTES[palette];

  return names.map((name, i) => {
    const slot = slots[i];
    return {
      id: i,
      name,
      // Hues are always spread evenly around the wheel: eight marbles have to
      // stay tellable apart on a phone. The palette moves the world, not them.
      hue: (hueOffset + i / MARBLE_COUNT) % 1,
      sat: world.marbleSat,
      light: world.marbleLight,
      mu: 0.088 * rng.range(0.92, 1.08),
      cd: 0.0095 * rng.range(0.88, 1.12),
      mass: rng.range(0.9, 1.15),
      swayFreq: rng.range(0.5, 1.3),
      swayPhase: rng.range(0, Math.PI * 2),
      swayAmp: rng.range(0.25, 0.4),
      slot,
      lane: slot % 2 === 0 ? 1 : -1,
    };
  });
}

export interface GenerateOptions {
  /** Force an archetype instead of rolling for one. */
  archetype?: ArchetypeName;
  /** Force a palette. */
  palette?: PaletteName;
  /** Same track, different luck. Defaults to `seed`. */
  simSeed?: string;
}

/**
 * Deterministic: same seed + same SIM_VERSION -> byte-identical spec.
 *
 * Retries on self-intersecting geometry with a fresh stream rather than nudging
 * the numbers, because nudging would make the result depend on how many times
 * we happened to retry.
 */
export function generateSpec(seed: string, opts: GenerateOptions = {}): RaceSpec {
  const meta = stream(seed, 'meta');
  const archetype = opts.archetype ?? meta.pick(ARCHETYPE_NAMES);
  const palette = opts.palette ?? meta.pick(PALETTE_NAMES);

  let track: TrackSpec | null = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const rng = stream(seed, attempt === 0 ? SIM_STREAMS.track : `${SIM_STREAMS.track}#${attempt}`);
    const candidate = buildTrackSpec(rng, archetype);
    if (!selfIntersects(buildTrack(candidate))) {
      track = candidate;
      break;
    }
  }
  if (!track) {
    // Last resort: the one grammar that geometrically cannot fold into itself.
    track = buildTrackSpec(stream(seed, `${SIM_STREAMS.track}#safe`), 'descenso');
  }

  const marbles = buildMarbles(
    stream(seed, SIM_STREAMS.marbles),
    stream(seed, SIM_STREAMS.grid),
    palette,
  );

  return {
    version: SIM_VERSION,
    generator: GENERATOR_VERSION,
    seed,
    simSeed: opts.simSeed ?? seed,
    archetype,
    palette,
    track,
    marbles,
  };
}
