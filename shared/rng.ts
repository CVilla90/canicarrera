/**
 * Seeded randomness. The whole product rests on this file: seed in -> identical
 * race out, forever, on every machine.
 *
 * Two rules that matter more than the algorithm:
 *
 *  1. Streams are derived from the SEED STRING plus a label, never from a
 *     parent's mutable state. So `stream(seed, 'wander:3')` returns the same
 *     sequence no matter what else consumed randomness first. Adding a marble,
 *     reordering generator code, or drawing one extra confetti particle cannot
 *     shift another stream by a single value.
 *  2. Cosmetic randomness lives in its own stream (see `COSMETIC`). A visual
 *     tweak must never change who wins.
 */

/** Bump when the *meaning* of a stream changes in a way that alters races. */
export const RNG_VERSION = 1;

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [a, b). */
  range(a: number, b: number): number;
  /** Integer in [0, n). */
  int(n: number): number;
  /** Uniform in [-1, 1). */
  signed(): number;
  /** True with probability p. */
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** Picks by weight; `weights[i]` corresponds to `items[i]`. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T;
  /** Fisher-Yates, in place, returns the same array. */
  shuffle<T>(items: T[]): T[];
}

/** cyrb128 — string -> four well-mixed 32-bit words. */
function hashSeed(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

/**
 * xoshiro128** — 32-bit ops only, so it is bit-identical in every JS engine.
 * (Anything using floats for state would drift; anything using BigInt would be
 * slow enough to matter when the curator runs 20 sims per request.)
 */
export function makeRng(...state: [number, number, number, number]): Rng {
  let [a, b, c, d] = state;

  const next = (): number => {
    const t = b << 9;
    let r = Math.imul(b, 5);
    r = Math.imul((r << 7) | (r >>> 25), 9);
    c ^= a;
    d ^= b;
    b ^= c;
    a ^= d;
    c ^= t;
    d = (d << 11) | (d >>> 21);
    return (r >>> 0) / 4294967296;
  };

  const rng: Rng = {
    next,
    range: (lo, hi) => lo + next() * (hi - lo),
    int: (n) => Math.floor(next() * n),
    signed: () => next() * 2 - 1,
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)],
    weighted: (items, weights) => {
      let total = 0;
      for (const w of weights) total += w;
      let roll = next() * total;
      for (let i = 0; i < items.length; i++) {
        roll -= weights[i];
        if (roll < 0) return items[i];
      }
      return items[items.length - 1];
    },
    shuffle: (items) => {
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = items[i];
        items[i] = items[j];
        items[j] = tmp;
      }
      return items;
    },
  };
  return rng;
}

/**
 * The only way to get randomness in this codebase.
 *
 * `label` names an independent stream. Use a stable label — renaming one is a
 * breaking change to every race that used it.
 */
export function stream(seed: string, label: string): Rng {
  return makeRng(...hashSeed(`canicarrera/${RNG_VERSION}/${seed}/${label}`));
}

/**
 * Stream labels used by the sim. Anything not in here is cosmetic and must not
 * feed the physics.
 */
export const SIM_STREAMS = {
  track: 'track',
  marbles: 'marbles',
  grid: 'grid',
  /** Per-marble, so marble 3's luck never depends on marble 2's. */
  wander: (index: number) => `wander:${index}`,
} as const;

/** Cosmetic streams. Changing what these produce must never change a result. */
export const COSMETIC = {
  stars: 'cosmetic:stars',
  confetti: 'cosmetic:confetti',
  dust: 'cosmetic:dust',
} as const;

const SEED_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford-ish: no I, L, O, U

/** A short, human-typeable, case-insensitive race seed. */
export function randomSeed(entropy: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < 8; i++) out += SEED_ALPHABET[Math.floor(entropy() * SEED_ALPHABET.length)];
  return out;
}

/**
 * Anything the user types becomes a valid seed. We never reject a seed — we
 * normalise it, so "hola mundo" and "HOLA-MUNDO" are the same race.
 */
export function normaliseSeed(raw: string): string {
  const cleaned = raw
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
  return cleaned.slice(0, 32) || randomSeed();
}
