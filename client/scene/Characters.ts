/**
 * The cast: friendly trackside characters.
 *
 * ## Why they exist
 *
 * The audience for the finished videos is largely children, and a marble race
 * is an event with nobody at it. Scenery gives a world a *place*; characters
 * give it *inhabitants*, and something to look at between overtakes. They are
 * spectators, not obstacles — nothing here is ever read by the simulator, so a
 * penguin cannot slow a marble down or change who wins.
 *
 * ## The rule about the snake
 *
 * Every character is drawn to be liked. A snake in a desert could easily be
 * menacing, and that would be the wrong thing to put in front of a six-year-old
 * watching a marble race: the point of the cast is warmth, not tension. So every
 * species gets the same treatment — round shapes, oversized eyes, an actual
 * smile, and an idle animation that reads as friendly. A snake here is a
 * character who happens to be a snake.
 *
 * ## How they are built
 *
 * Primitives only: spheres, cones, cylinders, a torus for the smile. No models,
 * no textures, no downloads, nothing that can 404 — the same discipline the
 * environment map and the soundtrack already follow, and it keeps the whole cast
 * at a few kilobytes of arithmetic.
 *
 * Geometry and materials are shared across every instance of a species, so eight
 * penguins cost one sphere. They are separate `Group`s rather than instanced
 * meshes because they animate independently, and three's frustum culling means
 * the ones behind the camera cost nothing.
 *
 * ## Determinism
 *
 * Placement and idle phase come from `COSMETIC.characters`, keyed on the race
 * seed. Two people opening the same link see the same penguin on the same rock.
 * Cosmetic stream, so adding a character can never shift a marble's luck.
 */
import {
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';

import type { CharacterKind, Palette } from '@shared/palette.ts';
import type { Track } from '@shared/track.ts';
import { COSMETIC, stream, type Rng } from '@shared/rng.ts';
import { clamp } from '@shared/vec3.ts';

/**
 * How close the leader has to be before a character starts celebrating, metres
 * of arc length. Roughly two seconds of racing at full speed, so the reaction
 * begins before the pack arrives rather than after it has gone.
 */
const EXCITEMENT_RANGE = 26;

interface CharacterInstance {
  group: Group;
  /** Arc length it stands beside, so it can react as the pack arrives. */
  s: number;
  /** Idle offset, so a row of characters does not bob in unison. */
  phase: number;
  speed: number;
  baseY: number;
  head: Object3D | null;
  armL: Object3D | null;
  armR: Object3D | null;
  /** Emissive part that brightens with excitement. The robot's antenna. */
  glow: MeshBasicMaterial | null;
  /** How this species idles and celebrates. */
  style: 'bob' | 'sway' | 'hover';
}

export interface CharacterCast {
  group: Group;
  instances: CharacterInstance[];
  dispose(): void;
}

/**
 * Owns every geometry and material for one world's cast, so instances can share
 * them and teardown is a single pass rather than a traversal that disposes the
 * same sphere eight times.
 */
class Workshop {
  private readonly geometries = new Map<string, BufferGeometry>();
  private readonly materials = new Map<string, Material>();

  geo<T extends BufferGeometry>(key: string, make: () => T): T {
    const existing = this.geometries.get(key);
    if (existing) return existing as T;
    const created = make();
    this.geometries.set(key, created);
    return created;
  }

  /**
   * A body material.
   *
   * The small emissive term is load-bearing rather than decorative: the six
   * orbit worlds are near-black voids lit by a single key, and a matte character
   * in one reads as a silhouette. A little self-illumination keeps the cast
   * legible everywhere without making them glow on a sunlit desert.
   */
  mat(color: number, options: { rough?: number; emissive?: number } = {}): MeshStandardMaterial {
    const key = `s:${color}:${options.rough ?? 0.62}:${options.emissive ?? 0.1}`;
    const existing = this.materials.get(key);
    if (existing) return existing as MeshStandardMaterial;
    const base = new Color(color);
    const created = new MeshStandardMaterial({
      color: base,
      roughness: options.rough ?? 0.62,
      metalness: 0,
      emissive: base.clone().multiplyScalar(options.emissive ?? 0.1),
    });
    this.materials.set(key, created);
    return created;
  }

  flat(color: number): MeshBasicMaterial {
    const key = `b:${color}`;
    const existing = this.materials.get(key);
    if (existing) return existing as MeshBasicMaterial;
    const created = new MeshBasicMaterial({ color });
    this.materials.set(key, created);
    return created;
  }

  dispose(): void {
    for (const geometry of this.geometries.values()) geometry.dispose();
    for (const material of this.materials.values()) material.dispose();
    this.geometries.clear();
    this.materials.clear();
  }
}

// ---------------------------------------------------------------- face

/**
 * Two big eyes and a smile, facing +Z.
 *
 * Every species gets exactly this. Oversized eyes with a visible highlight are
 * the whole of cartoon friendliness — it is why every mascot ever drawn has
 * them — and reusing one function means no character can accidentally end up
 * looking cold.
 */
function face(shop: Workshop, radius: number, options: { smile?: boolean } = {}): Group {
  const group = new Group();
  const eyeR = radius * 0.3;

  const white = shop.geo(`eye:${eyeR.toFixed(3)}`, () => new SphereGeometry(eyeR, 12, 10));
  const pupilR = eyeR * 0.52;
  const pupil = shop.geo(`pupil:${pupilR.toFixed(3)}`, () => new SphereGeometry(pupilR, 10, 8));
  const glintR = pupilR * 0.42;
  const glint = shop.geo(`glint:${glintR.toFixed(3)}`, () => new SphereGeometry(glintR, 6, 6));

  for (const side of [-1, 1]) {
    const eye = new Mesh(white, shop.flat(0xffffff));
    eye.position.set(side * radius * 0.42, radius * 0.12, radius * 0.82);
    group.add(eye);

    const iris = new Mesh(pupil, shop.flat(0x14161f));
    iris.position.set(side * radius * 0.44, radius * 0.12, radius * 0.99);
    group.add(iris);

    // The highlight. Without it the eyes read as buttons.
    const spark = new Mesh(glint, shop.flat(0xffffff));
    spark.position.set(side * radius * 0.49, radius * 0.2, radius * 1.04);
    group.add(spark);
  }

  if (options.smile !== false) {
    const smileR = radius * 0.34;
    const mouth = new Mesh(
      shop.geo(`smile:${smileR.toFixed(3)}`, () => new TorusGeometry(smileR, radius * 0.055, 6, 14, Math.PI)),
      shop.flat(0x2a1c1c),
    );
    // Half a torus, flipped so the open side faces up. That is a smile; the
    // unflipped half is a frown, and getting this backwards is the single
    // easiest way to make a friendly character look miserable.
    mouth.rotation.z = Math.PI;
    mouth.position.set(0, -radius * 0.3, radius * 0.86);
    group.add(mouth);
  }

  return group;
}

// ---------------------------------------------------------------- species

interface Built {
  group: Group;
  head: Object3D | null;
  armL: Object3D | null;
  armR: Object3D | null;
  glow: MeshBasicMaterial | null;
  style: CharacterInstance['style'];
}

/**
 * Every species is modelled standing on the origin, facing +Z, roughly 2.4 m
 * tall. The caller scales and turns them.
 */
function buildSpecies(kind: CharacterKind, shop: Workshop): Built {
  switch (kind) {
    case 'serpiente':
      return buildSnake(shop);
    case 'pinguino':
      return buildPenguin(shop);
    case 'mono':
      return buildMonkey(shop);
    case 'cactus':
      return buildCactus(shop);
    case 'tucan':
      return buildToucan(shop);
    case 'foca':
      return buildSeal(shop);
    case 'robot':
      return buildRobot(shop);
  }
}

/**
 * A coiled snake, wearing a smile.
 *
 * Three flattened rings stacked into a coil, a neck, and a head that is bigger
 * than a real snake's would be — cartoon proportions, deliberately. The tongue
 * is the only sharp shape on it and it is comically small.
 */
function buildSnake(shop: Workshop): Built {
  const group = new Group();
  const body = shop.mat(0x62b354);
  const belly = shop.mat(0xd8e88a);

  const ring = shop.geo('snake:ring', () => new TorusGeometry(1, 0.3, 8, 20));
  const coils: Array<[number, number]> = [
    [0.9, 0.16],
    [0.66, 0.5],
    [0.46, 0.8],
  ];
  for (const [radius, y] of coils) {
    const mesh = new Mesh(ring, body);
    mesh.rotation.x = -Math.PI / 2;
    mesh.scale.set(radius, radius, 0.8);
    mesh.position.y = y;
    group.add(mesh);
  }

  const head = new Group();
  head.position.set(0, 1.35, 0.1);
  const skull = new Mesh(shop.geo('snake:head', () => new SphereGeometry(0.46, 16, 12)), body);
  skull.scale.set(1, 0.86, 1.15);
  head.add(skull);

  const chin = new Mesh(shop.geo('snake:chin', () => new SphereGeometry(0.3, 14, 10)), belly);
  chin.scale.set(1, 0.46, 0.82);
  chin.position.set(0, -0.27, 0.14);
  head.add(chin);

  head.add(face(shop, 0.46));

  const tongue = new Mesh(
    shop.geo('snake:tongue', () => new ConeGeometry(0.045, 0.34, 5)),
    shop.flat(0xe8506a),
  );
  // Below the mouth, not through it. At the size these appear on screen the
  // tongue and the smile are only a few pixels apart, and overlapping them
  // turns both into one unreadable smudge.
  tongue.rotation.x = Math.PI / 2.2;
  tongue.position.set(0, -0.32, 0.56);
  head.add(tongue);

  group.add(head);
  return { group, head, armL: null, armR: null, glow: null, style: 'sway' };
}

/** A penguin. Flippers are the arms, and they flap. */
function buildPenguin(shop: Workshop): Built {
  const group = new Group();
  const dark = shop.mat(0x2c3446);
  const white = shop.mat(0xf4f2ea, { emissive: 0.06 });
  const orange = shop.mat(0xf0913a, { emissive: 0.12 });

  const torso = new Mesh(shop.geo('peng:body', () => new SphereGeometry(0.72, 16, 14)), dark);
  torso.scale.set(1, 1.32, 0.92);
  torso.position.y = 1;
  group.add(torso);

  // Two spheres meeting at a shallow angle produce a ragged silhouette where
  // their low-poly hulls cross. A smaller, rounder belly pushed further forward
  // crosses the body steeply instead, and the seam reads as a bib.
  const front = new Mesh(shop.geo('peng:belly', () => new SphereGeometry(0.54, 18, 14)), white);
  front.scale.set(0.9, 1.12, 0.62);
  front.position.set(0, 0.88, 0.36);
  group.add(front);

  const head = new Group();
  head.position.y = 2.02;
  const skull = new Mesh(shop.geo('peng:head', () => new SphereGeometry(0.5, 16, 12)), dark);
  head.add(skull);
  const cheeks = new Mesh(shop.geo('peng:cheeks', () => new SphereGeometry(0.4, 14, 10)), white);
  cheeks.scale.set(1, 0.95, 0.65);
  cheeks.position.z = 0.22;
  head.add(cheeks);
  const beak = new Mesh(shop.geo('peng:beak', () => new ConeGeometry(0.15, 0.4, 8)), orange);
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, -0.06, 0.55);
  head.add(beak);
  head.add(face(shop, 0.5, { smile: false }));
  group.add(head);

  const flipper = shop.geo('peng:flipper', () => new SphereGeometry(0.3, 10, 8));
  const arms: Object3D[] = [];
  for (const side of [-1, 1]) {
    // A pivot at the shoulder, so rotating the pivot swings the flipper from
    // the body rather than spinning it about its own middle.
    const pivot = new Group();
    pivot.position.set(side * 0.62, 1.28, 0);
    const mesh = new Mesh(flipper, dark);
    mesh.scale.set(0.42, 1.5, 0.8);
    mesh.position.y = -0.34;
    pivot.add(mesh);
    group.add(pivot);
    arms.push(pivot);
  }

  const foot = shop.geo('peng:foot', () => new SphereGeometry(0.24, 10, 8));
  for (const side of [-1, 1]) {
    const mesh = new Mesh(foot, orange);
    mesh.scale.set(0.9, 0.35, 1.4);
    mesh.position.set(side * 0.26, 0.08, 0.2);
    group.add(mesh);
  }

  return { group, head, armL: arms[0], armR: arms[1], glow: null, style: 'bob' };
}

/** A monkey, mid-cheer. */
function buildMonkey(shop: Workshop): Built {
  const group = new Group();
  const fur = shop.mat(0x8a5a3b);
  const skin = shop.mat(0xd8a273, { emissive: 0.08 });

  const torso = new Mesh(shop.geo('mono:body', () => new SphereGeometry(0.6, 14, 12)), fur);
  torso.scale.set(1, 1.15, 0.9);
  torso.position.y = 0.95;
  group.add(torso);

  const tummy = new Mesh(shop.geo('mono:tummy', () => new SphereGeometry(0.42, 12, 10)), skin);
  tummy.scale.set(1, 1.1, 0.6);
  tummy.position.set(0, 0.9, 0.34);
  group.add(tummy);

  const head = new Group();
  head.position.y = 1.85;
  head.add(new Mesh(shop.geo('mono:head', () => new SphereGeometry(0.52, 16, 12)), fur));
  const muzzle = new Mesh(shop.geo('mono:muzzle', () => new SphereGeometry(0.36, 12, 10)), skin);
  muzzle.scale.set(1.05, 0.85, 0.7);
  muzzle.position.z = 0.28;
  head.add(muzzle);
  const ear = shop.geo('mono:ear', () => new SphereGeometry(0.19, 10, 8));
  for (const side of [-1, 1]) {
    const mesh = new Mesh(ear, skin);
    mesh.scale.set(0.5, 1, 1);
    mesh.position.set(side * 0.52, 0.06, 0);
    head.add(mesh);
  }
  head.add(face(shop, 0.5));
  group.add(head);

  const limb = shop.geo('mono:limb', () => new CylinderGeometry(0.13, 0.11, 0.85, 8));
  const arms: Object3D[] = [];
  for (const side of [-1, 1]) {
    const pivot = new Group();
    pivot.position.set(side * 0.55, 1.32, 0.05);
    const mesh = new Mesh(limb, fur);
    mesh.position.y = -0.42;
    pivot.add(mesh);
    const hand = new Mesh(shop.geo('mono:hand', () => new SphereGeometry(0.17, 10, 8)), skin);
    hand.position.y = -0.85;
    pivot.add(hand);
    pivot.rotation.z = side * -0.4;
    group.add(pivot);
    arms.push(pivot);
  }

  // The tail: a three-quarter torus, which is exactly the shape of a happy tail
  // and costs one primitive.
  const tail = new Mesh(
    shop.geo('mono:tail', () => new TorusGeometry(0.44, 0.075, 6, 16, Math.PI * 1.4)),
    fur,
  );
  tail.rotation.y = Math.PI / 2;
  tail.position.set(0, 0.82, -0.5);
  group.add(tail);

  for (const side of [-1, 1]) {
    const leg = new Mesh(limb, fur);
    leg.scale.set(1, 0.62, 1);
    leg.position.set(side * 0.26, 0.29, 0);
    group.add(leg);
  }

  return { group, head, armL: arms[0], armR: arms[1], glow: null, style: 'bob' };
}

/** A saguaro with a face. The desert's other resident. */
function buildCactus(shop: Workshop): Built {
  const group = new Group();
  const green = shop.mat(0x4f9b52, { rough: 0.8 });

  const trunk = new Mesh(
    shop.geo('cactus:trunk', () => new CylinderGeometry(0.44, 0.52, 2.1, 12)),
    green,
  );
  trunk.position.y = 1.05;
  group.add(trunk);
  const cap = new Mesh(shop.geo('cactus:cap', () => new SphereGeometry(0.44, 12, 10)), green);
  cap.position.y = 2.1;
  group.add(cap);

  const arms: Object3D[] = [];
  const armGeo = shop.geo('cactus:arm', () => new CylinderGeometry(0.2, 0.22, 0.8, 10));
  const elbowGeo = shop.geo('cactus:elbow', () => new SphereGeometry(0.21, 10, 8));
  for (const side of [-1, 1]) {
    const pivot = new Group();
    pivot.position.set(side * 0.44, 1.15 + side * 0.12, 0);
    const out = new Mesh(armGeo, green);
    out.rotation.z = Math.PI / 2;
    out.position.x = side * 0.36;
    pivot.add(out);
    const elbow = new Mesh(elbowGeo, green);
    elbow.position.x = side * 0.7;
    pivot.add(elbow);
    const up = new Mesh(armGeo, green);
    up.position.set(side * 0.7, 0.4, 0);
    pivot.add(up);
    const tip = new Mesh(elbowGeo, green);
    tip.position.set(side * 0.7, 0.78, 0);
    pivot.add(tip);
    group.add(pivot);
    arms.push(pivot);
  }

  // A flower, because a cactus with a hat is friendlier than a cactus.
  const flower = new Mesh(
    shop.geo('cactus:flower', () => new SphereGeometry(0.19, 10, 8)),
    shop.mat(0xff6f9c, { emissive: 0.25 }),
  );
  flower.scale.set(1, 0.6, 1);
  flower.position.y = 2.44;
  group.add(flower);

  const head = new Group();
  head.position.y = 1.62;
  head.add(face(shop, 0.44));
  group.add(head);

  return { group, head, armL: arms[0], armR: arms[1], glow: null, style: 'sway' };
}

/** A toucan. The beak is the whole character, so it is enormous. */
function buildToucan(shop: Workshop): Built {
  const group = new Group();
  const black = shop.mat(0x1f2430);
  const cream = shop.mat(0xfff3d0, { emissive: 0.08 });
  const beakMat = shop.mat(0xffa32e, { emissive: 0.2 });

  const legGeo = shop.geo('tucan:leg', () => new CylinderGeometry(0.07, 0.07, 0.5, 6));
  for (const side of [-1, 1]) {
    const leg = new Mesh(legGeo, beakMat);
    leg.position.set(side * 0.18, 0.25, 0);
    group.add(leg);
  }

  const torso = new Mesh(shop.geo('tucan:body', () => new SphereGeometry(0.6, 14, 12)), black);
  torso.scale.set(0.92, 1.1, 1);
  torso.position.y = 1.05;
  group.add(torso);
  const chest = new Mesh(shop.geo('tucan:chest', () => new SphereGeometry(0.42, 18, 14)), cream);
  chest.scale.set(0.86, 0.98, 0.56);
  chest.position.set(0, 1.04, 0.42);
  group.add(chest);

  const head = new Group();
  head.position.y = 1.92;
  head.add(new Mesh(shop.geo('tucan:head', () => new SphereGeometry(0.44, 14, 12)), black));
  const beak = new Mesh(shop.geo('tucan:beak', () => new ConeGeometry(0.26, 1.05, 10)), beakMat);
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, -0.04, 0.72);
  head.add(beak);
  head.add(face(shop, 0.44, { smile: false }));
  group.add(head);

  const wingGeo = shop.geo('tucan:wing', () => new SphereGeometry(0.3, 10, 8));
  const arms: Object3D[] = [];
  for (const side of [-1, 1]) {
    const pivot = new Group();
    pivot.position.set(side * 0.5, 1.24, -0.05);
    const mesh = new Mesh(wingGeo, black);
    mesh.scale.set(0.4, 1.3, 1.1);
    mesh.position.y = -0.28;
    pivot.add(mesh);
    group.add(pivot);
    arms.push(pivot);
  }

  return { group, head, armL: arms[0], armR: arms[1], glow: null, style: 'bob' };
}

/** A seal, who applauds by clapping both flippers. */
function buildSeal(shop: Workshop): Built {
  const group = new Group();
  const hide = shop.mat(0x8d9aa8);
  const pale = shop.mat(0xd7dee6, { emissive: 0.06 });

  const torso = new Mesh(shop.geo('foca:body', () => new SphereGeometry(0.78, 16, 12)), hide);
  torso.scale.set(0.9, 0.85, 1.35);
  torso.position.set(0, 0.68, -0.2);
  group.add(torso);

  const tail = new Mesh(shop.geo('foca:tail', () => new ConeGeometry(0.42, 0.7, 8)), hide);
  tail.scale.set(1, 1, 0.35);
  tail.rotation.x = -Math.PI / 2.4;
  tail.position.set(0, 0.62, -1.3);
  group.add(tail);

  const head = new Group();
  head.position.set(0, 1.5, 0.2);
  head.add(new Mesh(shop.geo('foca:head', () => new SphereGeometry(0.46, 14, 12)), hide));
  const snout = new Mesh(shop.geo('foca:snout', () => new SphereGeometry(0.28, 12, 10)), pale);
  snout.scale.set(1.1, 0.8, 0.9);
  snout.position.set(0, -0.14, 0.32);
  head.add(snout);
  const nose = new Mesh(shop.geo('foca:nose', () => new SphereGeometry(0.09, 8, 6)), shop.flat(0x22262e));
  nose.position.set(0, -0.06, 0.58);
  head.add(nose);
  head.add(face(shop, 0.46));
  group.add(head);

  const flipperGeo = shop.geo('foca:flipper', () => new SphereGeometry(0.3, 10, 8));
  const arms: Object3D[] = [];
  for (const side of [-1, 1]) {
    const pivot = new Group();
    pivot.position.set(side * 0.6, 0.72, 0.32);
    const mesh = new Mesh(flipperGeo, hide);
    mesh.scale.set(0.45, 0.9, 1.3);
    mesh.position.y = -0.2;
    pivot.add(mesh);
    pivot.rotation.z = side * -0.5;
    group.add(pivot);
    arms.push(pivot);
  }

  return { group, head, armL: arms[0], armR: arms[1], glow: null, style: 'bob' };
}

/**
 * A little hovering robot — the orbit worlds' spectator.
 *
 * The other six species belong to a biome. The orbit worlds are a void with a
 * glowing chute in it, so their resident floats, has a visor instead of eyes,
 * and carries the one part of the cast that emits light: an antenna lamp that
 * brightens when the pack goes past.
 */
function buildRobot(shop: Workshop): Built {
  const group = new Group();
  const shell = shop.mat(0xc9d3e0, { rough: 0.35, emissive: 0.12 });
  const trim = shop.mat(0x39415a, { rough: 0.4, emissive: 0.1 });

  const torso = new Mesh(shop.geo('robot:body', () => new SphereGeometry(0.62, 16, 12)), shell);
  torso.scale.set(1, 1.1, 0.95);
  torso.position.y = 1.15;
  group.add(torso);

  const head = new Group();
  head.position.y = 2;
  head.add(new Mesh(shop.geo('robot:head', () => new SphereGeometry(0.46, 16, 12)), shell));

  // A visor rather than eyes: two glowing dots on a dark band reads as a robot
  // instantly, and it is one more primitive than a blank face.
  // Sized and placed so it actually EMERGES from the skull. The first version
  // sat almost entirely inside a 0.46 head and read as a small dark bowtie
  // rather than a visor.
  const visor = new Mesh(shop.geo('robot:visor', () => new SphereGeometry(0.44, 18, 12)), trim);
  visor.scale.set(1.04, 0.54, 0.9);
  visor.position.set(0, 0.02, 0.14);
  head.add(visor);
  const pupilGeo = shop.geo('robot:pupil', () => new SphereGeometry(0.1, 12, 10));
  for (const side of [-1, 1]) {
    const dot = new Mesh(pupilGeo, shop.flat(0x8ff4ff));
    dot.position.set(side * 0.17, 0.03, 0.52);
    head.add(dot);
  }

  const stalk = new Mesh(
    shop.geo('robot:stalk', () => new CylinderGeometry(0.035, 0.035, 0.42, 6)),
    trim,
  );
  stalk.position.y = 0.6;
  head.add(stalk);
  const lampMaterial = shop.flat(0xffd166);
  const lamp = new Mesh(shop.geo('robot:lamp', () => new SphereGeometry(0.13, 10, 8)), lampMaterial);
  lamp.position.y = 0.86;
  head.add(lamp);
  group.add(head);

  // Detached hands. A robot whose arms are not connected to it is more fun than
  // one whose arms are, and it costs two spheres instead of six.
  const handGeo = shop.geo('robot:hand', () => new SphereGeometry(0.17, 10, 8));
  const arms: Object3D[] = [];
  for (const side of [-1, 1]) {
    const pivot = new Group();
    pivot.position.set(side * 0.85, 1.2, 0.1);
    pivot.add(new Mesh(handGeo, trim));
    group.add(pivot);
    arms.push(pivot);
  }

  return { group, head, armL: arms[0], armR: arms[1], glow: lampMaterial, style: 'hover' };
}

// ---------------------------------------------------------------- placement

/**
 * The plinth every character stands on.
 *
 * Characters have to be at the height of the *track*, not the height of the
 * ground: surface worlds put the terrain eleven metres below the chute, so a
 * character standing on it would be a speck at the bottom of frame in a shot
 * framed on the marbles. A small platform beside the track puts them in the
 * shot, which is the entire reason they exist.
 *
 * On a surface world it gets a support post disappearing down into the fog, so
 * it reads as a viewing platform. Orbit worlds skip the post — things float
 * there by definition.
 */
function buildPlinth(shop: Workshop, palette: Palette, grounded: boolean): Group {
  const group = new Group();
  // `trackColor`, not `ground`. The jungle's terrain is 0x24491f — near-black —
  // so a plinth painted with it puts a dark green character on a dark green disc
  // in a dark green world. The track colours are the ones already chosen to be
  // LOOKED AT rather than to recede, which is exactly what a platform needs.
  const colour = palette.kind === 'surface' ? palette.trackColor : palette.wire;
  const material = shop.mat(colour, { rough: 0.9, emissive: 0.05 });

  const top = new Mesh(shop.geo('plinth:top', () => new CylinderGeometry(1.25, 1.4, 0.36, 14)), material);
  top.position.y = -0.18;
  group.add(top);

  const rim = new Mesh(shop.geo('plinth:rim', () => new CircleGeometry(1.25, 14)), shop.mat(colour, { rough: 0.75, emissive: 0.12 }));
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.001;
  group.add(rim);

  if (grounded) {
    const post = new Mesh(
      shop.geo('plinth:post', () => new CylinderGeometry(0.36, 0.44, 16, 8)),
      material,
    );
    post.position.y = -8.4;
    group.add(post);
  }

  return group;
}

/**
 * Builds a world's whole cast.
 *
 * Returns an empty cast for a palette with no characters, so the caller never
 * needs a null check.
 */
export function buildCharacters(palette: Palette, track: Track, seed: string): CharacterCast {
  const group = new Group();
  group.name = 'characters';
  const shop = new Workshop();
  const instances: CharacterInstance[] = [];

  const count = Math.min(palette.characterCount, 12);
  if (count <= 0 || palette.characters.length === 0) {
    return { group, instances, dispose: () => shop.dispose() };
  }

  const rng: Rng = stream(seed, COSMETIC.characters);
  const grounded = palette.kind === 'surface';
  const up = new Vector3();
  const forward = new Vector3();

  for (let i = 0; i < count; i++) {
    // Spread evenly along the run with a little jitter, so they punctuate the
    // race rather than clustering. The last one sits close to the finish, where
    // there is a crowd to be part of.
    const along = (i + 0.5) / count;
    const s = clamp(along + rng.range(-0.03, 0.03), 0.05, 0.985) * track.finishS;
    const frame = track.table.frameAt(s);
    const side = rng.chance(0.5) ? 1 : -1;
    const distance = rng.range(5.2, 8.4);

    const stand = new Group();
    stand.position.set(
      frame.p.x + frame.side.x * side * distance,
      frame.p.y + frame.side.y * side * distance - 1.2,
      frame.p.z + frame.side.z * side * distance - 0,
    );

    // Turned to face the track, so a character is never watching the scenery
    // while a race goes past behind it.
    forward.set(-frame.side.x * side, 0, -frame.side.z * side).normalize();
    stand.rotation.y = Math.atan2(forward.x, forward.z);
    // Tilt the plinth with the local up so it does not float at an angle to the
    // chute on a steep section.
    up.set(-frame.d.x, -frame.d.y, -frame.d.z).normalize();

    stand.add(buildPlinth(shop, palette, grounded));

    const kind = rng.pick(palette.characters);
    const built = buildSpecies(kind, shop);
    const scale = rng.range(0.85, 1.15);
    built.group.scale.setScalar(scale);
    stand.add(built.group);
    group.add(stand);

    instances.push({
      group: built.group,
      s,
      phase: rng.range(0, Math.PI * 2),
      speed: rng.range(0.75, 1.35),
      baseY: built.style === 'hover' ? 0.55 : 0,
      head: built.head,
      armL: built.armL,
      armR: built.armR,
      glow: built.glow,
      style: built.style,
    });
  }

  return { group, instances, dispose: () => shop.dispose() };
}

// ---------------------------------------------------------------- animation

/**
 * Idles the cast, and makes it celebrate when the race arrives.
 *
 * `time` is **sim time**, never a wall clock. That is what makes the exported
 * video match the preview: the export loop advances the sim by a fixed step per
 * frame, so a character is in exactly the same pose at video second 12 whether
 * the frame took 3 ms or 300 ms to draw.
 *
 * `leaderS` closes the loop between the race and the world — a character starts
 * waving as the leader comes into range, not on a timer, which is why they feel
 * like spectators rather than decoration.
 */
export function updateCharacters(cast: CharacterCast, time: number, leaderS: number): void {
  for (const instance of cast.instances) {
    const excitement = clamp(1 - Math.abs(leaderS - instance.s) / EXCITEMENT_RANGE, 0, 1);
    const beat = time * instance.speed * (1.4 + excitement * 3.4) + instance.phase;
    const swing = Math.sin(beat);
    const group = instance.group;

    switch (instance.style) {
      case 'hover':
        group.position.y = instance.baseY + swing * (0.14 + excitement * 0.18);
        group.rotation.y = Math.sin(beat * 0.34) * 0.5 + excitement * Math.sin(beat) * 0.3;
        break;
      case 'sway':
        // Coiled things sway rather than jump. Amplitude, not frequency, is what
        // reads as excitement here.
        group.rotation.z = swing * (0.05 + excitement * 0.14);
        group.position.y = instance.baseY + Math.abs(swing) * excitement * 0.16;
        break;
      case 'bob':
        // A little hop, and only when there is something to hop about.
        group.position.y = instance.baseY + Math.abs(swing) * (0.05 + excitement * 0.42);
        group.rotation.z = Math.sin(beat * 0.5) * 0.04;
        break;
    }

    if (instance.head) {
      instance.head.rotation.z = swing * 0.08 * (1 + excitement);
      instance.head.rotation.x = Math.sin(beat * 0.7) * 0.05;
    }

    // Arms go up as the pack arrives. Both together, because that is cheering;
    // alternating would read as walking.
    if (instance.armL && instance.armR) {
      const raise = excitement * (0.9 + swing * 0.55);
      instance.armL.rotation.z = -0.4 - raise;
      instance.armR.rotation.z = 0.4 + raise;
    }

    if (instance.glow) {
      instance.glow.color.setHSL(0.13, 0.9, 0.5 + excitement * 0.35 + swing * 0.05 * excitement);
    }
  }
}
