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

export interface Palette {
  name: PaletteName;
  /** Shown in the UI. Spanish. */
  label: string;
  /** Sky / clear colour. */
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
}

export const PALETTES: Record<PaletteName, Palette> = {
  neon: {
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
