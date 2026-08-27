/**
 * Worlds and names.
 *
 * Deliberate rule: the palette changes the WORLD, never the marbles' hue
 * spread. Eight marbles have to stay tellable apart at 200 px on a phone — that
 * is a functional requirement, not a stylistic one — so their hues are always
 * spread evenly around the wheel. The palette moves the sky, the glass, the
 * rings, and the saturation.
 */
import type { PaletteName } from './spec.ts';

/**
 * Who lives here.
 *
 * Declared in `shared/` rather than in the renderer for the same reason
 * everything else about a world is: the palette is the *definition* of a world
 * and `client/scene` is one reader of it. Nothing about the cast reaches the
 * simulator — a character is a spectator, never an obstacle.
 *
 * Kept as a list per world rather than one species each, because a biome with
 * two residents feels populated and a biome with one feels like a mascot.
 */
export type CharacterKind =
  | 'serpiente'
  | 'pinguino'
  | 'mono'
  | 'cactus'
  | 'tucan'
  | 'foca'
  | 'robot';

/**
 * Two families of world.
 *
 * `orbit` is the original look: a star field, no ground, the chute hanging in
 * space. `surface` puts the race somewhere — a gradient sky, terrain below,
 * scenery scattered along the run and something drifting through the air.
 *
 * A biome is a bigger idea than a colour scheme (PLAN §3.1), and this is where
 * that shows: swapping green for orange gets you a differently-tinted void, not
 * a jungle. The jungle needs a canopy under the track and pollen in the light.
 */
export type WorldKind = 'orbit' | 'surface';

/** Instanced scenery scattered around a surface world. */
export type PropKind = 'none' | 'trees' | 'dunes' | 'shards';

/** What drifts through the air. Always cosmetic, always its own RNG stream. */
export type MoteKind = 'none' | 'snow' | 'sand' | 'spores';

/**
 * How the running surface is drawn.
 *
 * `tube` is the sealed glass chute — right for orbit, where a closed pipe in
 * a void is the whole idea. `channel` opens the roof: the marbles run in a
 * banked U with kerbs down both edges, which is what a track on the ground
 * actually looks like and reads much more like motorsport.
 *
 * **This is a rendering choice only.** The simulator is 1-D along the spline
 * with an angular position in the barrel; it has no concept of a ceiling and
 * cannot tell the difference. Same seed, same race, either way.
 */
export type TrackStyle = 'tube' | 'channel';

export interface Palette {
  name: PaletteName;
  /** Shown in the UI. Spanish. */
  label: string;
  kind: WorldKind;
  /** Sky / clear colour. On surface worlds this is the horizon band. */
  background: number;
  fogNear: number;
  fogFar: number;
  glass: number;
  glassOpacity: number;
  wire: number;
  ringA: number;
  ringB: number;
  finish: number;
  star: number;
  starCount: number;
  /** Applied to every marble in this world. */
  marbleSat: number;
  marbleLight: number;
  /** Key light tint. */
  keyLight: number;
  /** Bounce/hemisphere tint. */
  fillLight: number;
  groundLight: number;

  /**
   * Light intensities, per world.
   *
   * The orbit rig is deliberately flat and bright — in a black void with a
   * glowing chute there is nothing to lose to overexposure. On a surface world
   * that same rig blows the whole frame to pastel: a lit sky, lit terrain and
   * ~5 units of ambient leaves no dark side on anything. Surface worlds run a
   * strong sun and very little ambient so shapes keep their shading.
   */
  keyIntensity: number;
  hemiIntensity: number;
  ambientIntensity: number;
  rimIntensity: number;

  /**
   * Tone-mapping exposure, per world. Think of it as the camera's aperture.
   *
   * ⚠️ This is the setting that makes or breaks a surface world, and it is not
   * obvious. ACES starts with `color *= exposure / 0.6` — a 1.9x boost at
   * exposure 1.15 — so ANY mid-tone albedo lands near white after the curve.
   * The orbit worlds never showed it because they are nearly black to begin
   * with and the boost is exactly what makes their chute glow.
   *
   * Author a daylight world at orbit exposure and you get white soup no matter
   * how you retune the lights or the palette; the first three attempts at the
   * jungle all failed this way. Stopping down the camera fixes every colour in
   * the world proportionally, which re-authoring nine hex values does not.
   */
  exposure: number;

  trackStyle: TrackStyle;
  /**
   * Running surface of a `channel`.
   *
   * Deliberately NOT `glass`. The tube is tinted glass you look *through*; a
   * channel is a surface you look *at*, and reusing the pale glass tint gives
   * a track the colour of milk that blows out under a real sun.
   */
  trackColor: number;
  /** Kerbs down both edges of a channel. The F1 "pianos". */
  kerbs: boolean;
  kerbA: number;
  kerbB: number;

  // ---- surface worlds only (ignored when kind === 'orbit')
  /** Zenith colour of the gradient sky. */
  skyHigh: number;
  /** Terrain colour. `null` means no ground at all. */
  ground: number | null;
  /** Vertical relief of the terrain, metres. 0 is a flat plate. */
  groundRelief: number;
  props: PropKind;
  propColor: number;
  propCount: number;
  motes: MoteKind;
  moteColor: number;
  moteCount: number;

  // ---- the cast (every world, both families)
  /** Species that can appear trackside here. Drawn from per race. */
  characters: readonly CharacterKind[];
  /**
   * How many stand along the run.
   *
   * Each one is its own `Group`, so this is a draw-call budget as much as an
   * aesthetic choice. Six punctuates a race; twenty would line it.
   */
  characterCount: number;
}

/**
 * Defaults for the six orbit worlds, so adding a field here does not mean
 * editing nine literals by hand.
 */
const ORBIT = {
  kind: 'orbit',
  skyHigh: 0x000000,
  ground: null,
  groundRelief: 0,
  props: 'none',
  propColor: 0x000000,
  propCount: 0,
  motes: 'none',
  moteColor: 0x000000,
  moteCount: 0,
  keyIntensity: 2.2,
  hemiIntensity: 1.6,
  ambientIntensity: 0.35,
  rimIntensity: 0.9,
  exposure: 1.15,
  trackStyle: 'tube',
  trackColor: 0x000000,
  kerbs: false,
  kerbA: 0x000000,
  kerbB: 0x000000,
  // A void has no wildlife, so orbit worlds get the one species that makes
  // sense floating in one. Fewer of them than on a surface world: with no
  // terrain to sit on there is nothing to hide an over-populated shot behind.
  characters: ['robot'],
  characterCount: 4,
} as const satisfies Partial<Palette>;

/** Shared by the surface worlds: a real sun, almost no ambient, kerbed channel. */
const SURFACE = {
  kind: 'surface',
  starCount: 0,
  // Measured, not guessed. A mid-tone albedo of ~0.4 times a key of 3.1 lands
  // above 1.0 BEFORE tone mapping, so ACES compresses it to near-white and the
  // entire world reads as pastel — which is exactly what happened on the first
  // attempt. 1.5 keeps a lit surface below the knee and leaves the highlights
  // for things that are genuinely bright: the marbles, the kerbs, the sun.
  keyIntensity: 1.5,
  hemiIntensity: 0.34,
  ambientIntensity: 0.05,
  rimIntensity: 0.18,
  exposure: 0.5,
  trackStyle: 'channel',
  kerbs: true,
  kerbA: 0xd8382a,
  kerbB: 0xf4f4f0,
  characterCount: 7,
} as const satisfies Partial<Palette>;

export const PALETTES: Record<PaletteName, Palette> = {
  neon: {
    ...ORBIT,
    name: 'neon',
    label: 'Neón',
    background: 0x070b16,
    fogNear: 50,
    fogFar: 190,
    glass: 0x9fd8ff,
    glassOpacity: 0.16,
    wire: 0x3f6fae,
    ringA: 0x37e0ff,
    ringB: 0xff4fd8,
    finish: 0xffc23d,
    star: 0xbfd0ff,
    starCount: 1800,
    marbleSat: 0.74,
    marbleLight: 0.56,
    keyLight: 0xffffff,
    fillLight: 0x8899ff,
    groundLight: 0x0a0a14,
  },
  citrico: {
    ...ORBIT,
    name: 'citrico',
    label: 'Cítrico',
    background: 0x140c04,
    fogNear: 45,
    fogFar: 170,
    glass: 0xffd9a0,
    glassOpacity: 0.14,
    wire: 0xb4783a,
    ringA: 0xffe14f,
    ringB: 0xff7a2f,
    finish: 0xfff3c4,
    star: 0xffd9a0,
    starCount: 1200,
    marbleSat: 0.8,
    marbleLight: 0.55,
    keyLight: 0xfff0dc,
    fillLight: 0xffb066,
    groundLight: 0x1a0e04,
  },
  hielo: {
    ...ORBIT,
    name: 'hielo',
    label: 'Hielo',
    background: 0x0a1420,
    fogNear: 60,
    fogFar: 220,
    glass: 0xd6f2ff,
    glassOpacity: 0.2,
    wire: 0x5f9fc4,
    ringA: 0xffffff,
    ringB: 0x7fe4ff,
    finish: 0xffd166,
    star: 0xe8f6ff,
    starCount: 2200,
    marbleSat: 0.66,
    marbleLight: 0.6,
    keyLight: 0xeaf7ff,
    fillLight: 0x9fd0ff,
    groundLight: 0x101c28,
  },
  magma: {
    ...ORBIT,
    name: 'magma',
    label: 'Magma',
    background: 0x120306,
    fogNear: 40,
    fogFar: 150,
    glass: 0xffb0a0,
    glassOpacity: 0.15,
    wire: 0xa03828,
    ringA: 0xff5a2b,
    ringB: 0xffd23d,
    finish: 0xfff0a0,
    star: 0xff9a72,
    starCount: 900,
    marbleSat: 0.85,
    marbleLight: 0.55,
    keyLight: 0xffe0c8,
    fillLight: 0xff7a4a,
    groundLight: 0x1e0604,
  },
  bruma: {
    ...ORBIT,
    name: 'bruma',
    label: 'Bruma',
    background: 0x121018,
    fogNear: 30,
    fogFar: 120,
    glass: 0xd8d0e8,
    glassOpacity: 0.22,
    wire: 0x6b6480,
    ringA: 0xc8b8ff,
    ringB: 0x88ffd8,
    finish: 0xffe9a8,
    star: 0xd8d0e8,
    starCount: 700,
    marbleSat: 0.6,
    marbleLight: 0.62,
    keyLight: 0xf0ecff,
    fillLight: 0xa89ec8,
    groundLight: 0x18141e,
  },
  arcade: {
    ...ORBIT,
    name: 'arcade',
    label: 'Arcade',
    background: 0x05010f,
    fogNear: 55,
    fogFar: 200,
    glass: 0xb9a0ff,
    glassOpacity: 0.13,
    wire: 0x7a3fd0,
    ringA: 0x00ffc8,
    ringB: 0xff2fa0,
    finish: 0xffe600,
    star: 0xd8c0ff,
    starCount: 1500,
    marbleSat: 0.9,
    marbleLight: 0.58,
    keyLight: 0xffffff,
    fillLight: 0xb070ff,
    groundLight: 0x0a0418,
  },

  // ---------------------------------------------------------- surface worlds
  //
  // Three rules learned tuning these:
  //   1. `background` is the HORIZON, not the sky. Fog blends into it, so if it
  //      disagrees with the terrain the ground ends in a visible seam.
  //   2. Fog has to close in much harder than in orbit. With ground and props
  //      there is real geometry at distance, and without fog you see the edge
  //      of the world.
  //   3. Props must be DARKER than the horizon or they read as cut-outs. Real
  //      distant scenery loses contrast, it does not gain it.

  jungla: {
    ...SURFACE,
    name: 'jungla',
    trackColor: 0x5f7a63,
    label: 'Jungla',
    // The SKY IS BLUE, even in a jungle. The first attempt made sky, fog and
    // terrain all green, and since fog and sky cover most of the frame the
    // result was monochrome soup with the race invisible inside it. Contrast
    // between the world's dome and the world's ground is what gives a biome
    // shape; the greens belong on the ground.
    background: 0xa9c3ad,
    skyHigh: 0x4a86bd,
    // Far looser than the orbit worlds. In space, fog only has to hide the end
    // of the star field; here it has to sit BEHIND real terrain and scenery,
    // and a tight fog just paints the whole frame one colour.
    fogNear: 95,
    fogFar: 430,
    glass: 0xa8ffcf,
    glassOpacity: 0.17,
    wire: 0x2f6b45,
    ringA: 0xffe36b,
    ringB: 0x4fffb0,
    finish: 0xfff3a8,
    star: 0xd8ffe8,
    marbleSat: 0.82,
    marbleLight: 0.57,
    keyLight: 0xfff4d8,
    // Desaturated on purpose: the hemisphere light runs at 1.6, and a saturated
    // tint at that strength dyes the marbles the colour of the world. Eight
    // marbles staying tellable apart is a functional requirement.
    fillLight: 0xb4cdb8,
    groundLight: 0x2c4a30,
    ground: 0x24491f,
    groundRelief: 7,
    props: 'trees',
    propColor: 0x1b3a22,
    propCount: 150,
    motes: 'spores',
    moteColor: 0xffe9a0,
    moteCount: 420,
    // A monkey and a toucan: one on the ground, one that should be in a tree,
    // both instantly readable as "jungle" at the size they appear on screen.
    characters: ['mono', 'tucan'],
  },

  desierto: {
    ...SURFACE,
    name: 'desierto',
    trackColor: 0xa8845a,
    label: 'Desierto',
    background: 0xe3c493,
    skyHigh: 0x3b7fc4,
    fogNear: 120,
    fogFar: 520,
    glass: 0xffe3b8,
    glassOpacity: 0.13,
    wire: 0xa8703a,
    ringA: 0xff9a3d,
    ringB: 0xffe07a,
    finish: 0xfff6d8,
    star: 0xffe8c0,
    marbleSat: 0.84,
    marbleLight: 0.55,
    keyLight: 0xfff0d0,
    fillLight: 0xf0dcc0,
    groundLight: 0x9a7548,
    ground: 0xc99a5e,
    groundRelief: 5,
    props: 'dunes',
    propColor: 0xb08048,
    propCount: 90,
    motes: 'sand',
    moteColor: 0xe8c894,
    moteCount: 520,
    // The snake is drawn as a friend, not a threat — see `Characters.ts`. A
    // coil, a big smile and a tongue that is far too small to be menacing.
    characters: ['serpiente', 'cactus'],
  },

  glaciar: {
    ...SURFACE,
    name: 'glaciar',
    trackColor: 0x8fb2c8,
    label: 'Glaciar',
    background: 0xdce9f2,
    skyHigh: 0x5a8cc0,
    fogNear: 90,
    fogFar: 400,
    glass: 0xdcf4ff,
    glassOpacity: 0.19,
    wire: 0x6f9ec0,
    ringA: 0xffffff,
    ringB: 0x8fe8ff,
    finish: 0xffd166,
    star: 0xffffff,
    marbleSat: 0.78,
    marbleLight: 0.58,
    keyLight: 0xf4fbff,
    fillLight: 0xd8e8f2,
    groundLight: 0x9fbccc,
    ground: 0xa8cade,
    groundRelief: 9,
    props: 'shards',
    propColor: 0x9cc4dc,
    propCount: 120,
    motes: 'snow',
    moteColor: 0xffffff,
    moteCount: 600,
    characters: ['pinguino', 'foca'],
  },
};

export const PALETTE_NAMES = Object.keys(PALETTES) as PaletteName[];

/**
 * Marble names. Short on purpose: they have to fit a narrow timing tower and be
 * readable on a phone. Spanish, because the audience is.
 */
export const MARBLE_NAMES: readonly string[] = [
  'Rayo', 'Luna', 'Fuego', 'Jade', 'Cometa', 'Ámbar',
  'Turbo', 'Bruma', 'Chispa', 'Trueno', 'Perla', 'Vega',
  'Nieve', 'Tinta', 'Coral', 'Zafiro', 'Menta', 'Cobre',
  'Nube', 'Sombra', 'Lima', 'Ónix', 'Ceniza', 'Ola',
];

/** HSL -> #rrggbb, so every consumer agrees on what a marble looks like. */
export function hslToHex(h: number, s: number, l: number): string {
  const f = (n: number): number => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(Math.min(k - 3, 9 - k), 1));
  };
  const to255 = (x: number) =>
    Math.round(Math.max(0, Math.min(1, x)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to255(f(0))}${to255(f(8))}${to255(f(4))}`;
}




