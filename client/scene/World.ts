/**
 * Surface worlds: sky, terrain, scenery, atmosphere.
 *
 * The original six palettes hang the chute in space with a star field behind
 * it, which is beautiful and costs almost nothing — but it is one location, not
 * a set of them. A biome is a bigger idea than a colour scheme: a jungle needs
 * a canopy under the track and pollen in the light, and recolouring a void
 * green just gives you a green void.
 *
 * Everything here is **cosmetic and deterministic**. Placement comes from
 * `COSMETIC.props` / `COSMETIC.motes`, which are their own RNG streams, so
 * adding a tree cannot shift a marble's luck by a single value — the rule
 * `shared/rng.ts` exists to protect. Nothing in this file is ever read by the
 * simulator.
 *
 * ## Cost
 *
 * Scenery is a single `InstancedMesh` per world (one draw call for 150 trees)
 * and motes are one `Points`. Terrain is one displaced plane. The whole world
 * is therefore roughly three extra draw calls, which is what makes it
 * affordable on the phone tier as well as on a desktop.
 */
import {
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  PointLight,
  Points,
  PointsMaterial,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type BufferGeometry as Geometry,
} from 'three';

import type { Palette } from '@shared/palette.ts';
import type { Track } from '@shared/track.ts';
import { COSMETIC, stream } from '@shared/rng.ts';
import { buildPropLayout } from './WorldLayout.ts';
import { buildTerrainHeightfield } from './TerrainLayout.ts';
import {
  buildAttributionLayout,
  type AttributionLayout,
} from './AttributionLayout.ts';
import {
  buildDesertMineTunnelLayout,
  buildGlacierIceCaveLayout,
  buildJungleRuinLayout,
  type DesertMineTunnelLayout,
  type GlacierIceCaveLayout,
  type JungleRuinLayout,
  type LayoutVec3,
  type TunnelSetPieceLayout,
} from './SetPieceLayout.ts';

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Horizon-weighted, not a linear top-to-bottom ramp.
 *
 * A linear gradient puts the colour change in the middle of the frame, where
 * the camera spends most of its time looking, and it reads as a painted
 * backdrop. Weighting it towards the horizon keeps the transition where the sky
 * actually changes.
 */
const SKY_FRAGMENT = /* glsl */ `
  varying vec3 vDir;
  uniform vec3 uHigh;
  uniform vec3 uHorizon;
  void main() {
    float h = clamp(normalize(vDir).y, 0.0, 1.0);
    gl_FragColor = vec4(mix(uHorizon, uHigh, pow(h, 0.6)), 1.0);
  }
`;

export interface WorldParts {
  group: Group;
  motes: { points: Points; drift: Vector3; span: number; base: Vector3 } | null;
  setPiece: TunnelSetPieceLayout | null;
  attribution: AttributionLayout;
}

/**
 * How far around the barrel the open channel wraps, each side of the bottom.
 *
 * The simulator puts a marble at `lane * 0.55 + sin(t) * swayAmp` radians, so
 * the extreme is a little over 1 rad — about 60°. 1.95 rad (112°) each side
 * therefore leaves a comfortable margin of wall above the highest a marble ever
 * rides, while still opening 136° of roof. Narrow this below ~1.2 and marbles
 * will start appearing outside the geometry on the banked sections.
 */
const CHANNEL_ARC = 1.95;

/**
 * An open U-channel instead of a sealed tube.
 *
 * Built by hand rather than with `TubeGeometry` because that always closes the
 * ring. Walking the track's own frames (`p`, `d`, `side`) and emitting only the
 * lower arc gives a running surface with a real edge — which is what kerbs need
 * to sit on, and what makes the thing read as a track rather than a pipe.
 */
export function buildChannelGeometry(track: Track, radius: number, tubular: number): BufferGeometry {
  const radial = 14;
  const vertices = new Float32Array((tubular + 1) * (radial + 1) * 3);
  const normals = new Float32Array((tubular + 1) * (radial + 1) * 3);
  const uvs = new Float32Array((tubular + 1) * (radial + 1) * 2);
  const indices: number[] = [];

  let v = 0;
  let n = 0;
  let t = 0;
  for (let i = 0; i <= tubular; i++) {
    const s = (i / tubular) * track.total;
    const frame = track.table.frameAt(s);
    for (let j = 0; j <= radial; j++) {
      const theta = -CHANNEL_ARC + (j / radial) * (2 * CHANNEL_ARC);
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      // Outward from the axis: down-vector component plus side component.
      const ox = frame.d.x * cos + frame.side.x * sin;
      const oy = frame.d.y * cos + frame.side.y * sin;
      const oz = frame.d.z * cos + frame.side.z * sin;

      vertices[v++] = frame.p.x + ox * radius;
      vertices[v++] = frame.p.y + oy * radius;
      vertices[v++] = frame.p.z + oz * radius;
      // Facing INTO the channel, where the camera and the marbles are.
      normals[n++] = -ox;
      normals[n++] = -oy;
      normals[n++] = -oz;
      uvs[t++] = i / tubular;
      uvs[t++] = j / radial;
    }
  }

  const stride = radial + 1;
  for (let i = 0; i < tubular; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * stride + j;
      const b = a + stride;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

/**
 * Kerbs — the F1 "pianos" — down both edges of the channel.
 *
 * Two instanced meshes, one per stripe colour, alternating along the run. They
 * do more than decorate: they give the eye a hard, regularly-spaced edge to
 * read speed against, which a smooth tube never had. Returned as a group so the
 * caller can add or skip the whole thing.
 */
export function buildKerbs(track: Track, radius: number, colorA: number, colorB: number): Group {
  const group = new Group();
  group.name = 'kerbs';

  const spacing = 1.15;
  const perEdge = Math.max(8, Math.floor(track.total / spacing));
  const total = perEdge * 2;
  const half = Math.ceil(total / 2);

  const geometry = new BoxGeometry(0.42, 0.07, spacing * 0.82);
  const meshes = [colorA, colorB].map(
    (color) =>
      new InstancedMesh(
        geometry,
        new MeshStandardMaterial({ color, roughness: 0.75, metalness: 0 }),
        half,
      ),
  );
  const counts = [0, 0];

  const matrix = new Matrix4();
  const position = new Vector3();
  const forward = new Vector3();
  const up = new Vector3();
  const rightAxis = new Vector3();
  const rotation = new Matrix4();

  for (let i = 0; i < perEdge; i++) {
    const s = ((i + 0.5) / perEdge) * track.total;
    const frame = track.table.frameAt(s);
    for (const edge of [-1, 1]) {
      // Just inside the rim, so the kerb sits on the running surface rather
      // than floating off the open edge.
      const theta = edge * (CHANNEL_ARC - 0.16);
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      const ox = frame.d.x * cos + frame.side.x * sin;
      const oy = frame.d.y * cos + frame.side.y * sin;
      const oz = frame.d.z * cos + frame.side.z * sin;

      position.set(
        frame.p.x + ox * (radius - 0.03),
        frame.p.y + oy * (radius - 0.03),
        frame.p.z + oz * (radius - 0.03),
      );
      forward.set(frame.t.x, frame.t.y, frame.t.z).normalize();
      up.set(-ox, -oy, -oz).normalize();
      rightAxis.crossVectors(up, forward).normalize();
      // Re-orthogonalise: the track frame is not guaranteed square after the
      // arc table's interpolation, and a skewed basis shears every kerb.
      forward.crossVectors(rightAxis, up).normalize();
      rotation.makeBasis(rightAxis, up, forward);

      matrix.copy(rotation).setPosition(position);
      // Alternate the stripe on every step, both edges in phase, so the two
      // sides read as one pattern rather than as noise.
      const which = i % 2;
      if (counts[which] < half) meshes[which].setMatrixAt(counts[which]++, matrix);
    }
  }

  for (let i = 0; i < meshes.length; i++) {
    meshes[i].count = counts[i];
    meshes[i].instanceMatrix.needsUpdate = true;
    group.add(meshes[i]);
  }
  return group;
}

/** Geometry per scenery kind. Kept deliberately crude — these are silhouettes. */
function propGeometry(palette: Palette): Geometry | null {
  switch (palette.props) {
    case 'trees':
      // A cone reads as a conifer/palm canopy at distance, which is all these
      // ever are — the camera is inside a tube looking along it.
      return new ConeGeometry(1, 3.4, 7);
    case 'dunes':
      // A squashed hemisphere. Real dunes are long and low; a sphere scaled
      // hard on Y and rotated gives that for one geometry.
      return new SphereGeometry(1, 10, 6);
    case 'shards':
      return new OctahedronGeometry(1, 0);
    default:
      return null;
  }
}

function moteSize(palette: Palette): number {
  switch (palette.motes) {
    case 'snow':
      return 0.16;
    case 'sand':
      return 0.09;
    case 'spores':
      return 0.11;
    default:
      return 0.1;
  }
}

/** Where the motes go, per second. Sand blows sideways; snow falls. */
function moteDrift(palette: Palette): Vector3 {
  switch (palette.motes) {
    case 'snow':
      return new Vector3(0.6, -1.5, 0.2);
    case 'sand':
      return new Vector3(6.5, -0.4, 1.2);
    case 'spores':
      return new Vector3(0.3, 0.55, 0.2);
    default:
      return new Vector3();
  }
}

const vector = (value: LayoutVec3): Vector3 => new Vector3(value.x, value.y, value.z);

/**
 * Turns the pure mine contract into a deliberately simple vertical slice.
 *
 * Two open faceted cylinders provide separate outside and inside surfaces. This
 * gives the tunnel real thickness without CSG, while the portals and timber
 * frames explain the opening from both directions. Everything is static except
 * for ordinary Three.js lights, so preview and offline export see identical
 * geometry at every simulation time.
 */
function buildDesertMineTunnel(layout: DesertMineTunnelLayout): Group {
  const group = new Group();
  group.name = 'desert-mine-tunnel';

  const axis = vector(layout.axis).normalize();
  const centre = vector(layout.centre);
  const shellLength = vector(layout.exit.p).distanceTo(vector(layout.entrance.p));
  const cylinderRotation = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), axis);

  const outer = new Mesh(
    new CylinderGeometry(
      layout.outerRadius * 0.98,
      layout.outerRadius * 1.04,
      shellLength,
      11,
      1,
      true,
    ),
    new MeshStandardMaterial({ color: 0x4a2d1d, roughness: 1, metalness: 0 }),
  );
  outer.name = 'mine-rock-shell';
  outer.position.copy(centre);
  outer.quaternion.copy(cylinderRotation);
  group.add(outer);

  const lining = new Mesh(
    new CylinderGeometry(
      layout.interiorRadius,
      layout.interiorRadius,
      shellLength + 0.12,
      11,
      1,
      true,
    ),
    new MeshStandardMaterial({
      color: 0x241813,
      roughness: 0.96,
      metalness: 0,
      side: BackSide,
    }),
  );
  lining.name = 'mine-interior-lining';
  lining.position.copy(centre);
  lining.quaternion.copy(cylinderRotation);
  group.add(lining);

  // A pair of heavy iron rims makes both transitions legible at race speed.
  const portalGeometry = new TorusGeometry(layout.interiorRadius + 0.02, 0.42, 8, 28);
  const portalMaterial = new MeshStandardMaterial({
    color: 0x6c4227,
    roughness: 0.86,
    metalness: 0.12,
  });
  const portalForward = new Vector3(0, 0, 1);
  for (const [name, portal] of [
    ['mine-entrance', layout.entrance],
    ['mine-exit', layout.exit],
  ] as const) {
    const rim = new Mesh(portalGeometry, portalMaterial);
    rim.name = name;
    rim.position.copy(vector(portal.p));
    rim.quaternion.setFromUnitVectors(portalForward, vector(portal.t).normalize());
    group.add(rim);
  }

  // Wall-hugging ribs instead of square roof beams. A chase camera rides as
  // high as 4.4 m above the chute; a rectangular cross-beam at that height
  // slices the entire broadcast frame in half. The inner edge of these ribs is
  // outside the explicit 5.5 m camera envelope.
  const timberGeometry = new TorusGeometry(layout.interiorRadius - 0.35, 0.22, 6, 20);
  const timbers = new InstancedMesh(
    timberGeometry,
    new MeshStandardMaterial({ color: 0x5b351f, roughness: 0.93, metalness: 0 }),
    layout.supports.length,
  );
  timbers.name = 'mine-timber-supports';
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const portalAxis = new Vector3(0, 0, 1);
  for (let i = 0; i < layout.supports.length; i++) {
    const support = layout.supports[i];
    quaternion.setFromUnitVectors(portalAxis, vector(support.t).normalize());
    timbers.setMatrixAt(
      i,
      matrix.compose(vector(support.p), quaternion, new Vector3(1, 1, 1)),
    );
  }
  timbers.count = layout.supports.length;
  timbers.instanceMatrix.needsUpdate = true;
  group.add(timbers);

  for (let i = 0; i < layout.lamps.length; i++) {
    const lamp = layout.lamps[i];
    const bulb = new Mesh(
      new SphereGeometry(0.18, 8, 6),
      new MeshBasicMaterial({ color: lamp.color }),
    );
    bulb.name = `mine-lamp-${i + 1}`;
    bulb.position.copy(vector(lamp.position));
    group.add(bulb);

    const light = new PointLight(lamp.color, lamp.intensity, lamp.distance, 2);
    light.position.copy(bulb.position);
    group.add(light);
  }

  return group;
}

/**
 * Glacier dressing for the shared tunnel contract.
 *
 * The shell, lining and ridges stay outside the same authored camera envelope
 * as the mine. Icicle transforms come entirely from the pure layout, including
 * a conservative radius around each cone, so this renderer never gets to
 * invent an untested obstruction.
 */
function buildGlacierIceCave(layout: GlacierIceCaveLayout): Group {
  const group = new Group();
  group.name = 'glacier-ice-cave';

  const axis = vector(layout.axis).normalize();
  const centre = vector(layout.centre);
  const shellLength = vector(layout.exit.p).distanceTo(vector(layout.entrance.p));
  const cylinderRotation = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), axis);

  const outer = new Mesh(
    new CylinderGeometry(
      layout.outerRadius * 1.02,
      layout.outerRadius * 0.98,
      shellLength,
      12,
      2,
      true,
    ),
    new MeshStandardMaterial({
      color: 0x759eb8,
      roughness: 0.72,
      metalness: 0.06,
      flatShading: true,
    }),
  );
  outer.name = 'ice-cave-outer-shell';
  outer.position.copy(centre);
  outer.quaternion.copy(cylinderRotation);
  group.add(outer);

  const lining = new Mesh(
    new CylinderGeometry(
      layout.interiorRadius,
      layout.interiorRadius,
      shellLength + 0.12,
      12,
      2,
      true,
    ),
    new MeshStandardMaterial({
      color: 0x7fc7e4,
      emissive: 0x163f5b,
      emissiveIntensity: 0.42,
      roughness: 0.34,
      metalness: 0.08,
      flatShading: true,
      side: BackSide,
    }),
  );
  lining.name = 'ice-cave-inner-lining';
  lining.position.copy(centre);
  lining.quaternion.copy(cylinderRotation);
  group.add(lining);

  const portalGeometry = new TorusGeometry(layout.interiorRadius + 0.04, 0.5, 7, 28);
  const portalMaterial = new MeshStandardMaterial({
    color: 0xd5f8ff,
    emissive: 0x2a718e,
    emissiveIntensity: 0.5,
    roughness: 0.27,
    metalness: 0.08,
  });
  const portalForward = new Vector3(0, 0, 1);
  for (const [name, portal] of [
    ['ice-cave-entrance', layout.entrance],
    ['ice-cave-exit', layout.exit],
  ] as const) {
    const rim = new Mesh(portalGeometry, portalMaterial);
    rim.name = name;
    rim.position.copy(vector(portal.p));
    rim.quaternion.setFromUnitVectors(portalForward, vector(portal.t).normalize());
    group.add(rim);
  }

  const ridgeGeometry = new TorusGeometry(layout.interiorRadius - 0.34, 0.2, 6, 20);
  const ridges = new InstancedMesh(
    ridgeGeometry,
    new MeshStandardMaterial({
      color: 0xb8eaff,
      emissive: 0x245a73,
      emissiveIntensity: 0.35,
      roughness: 0.38,
      metalness: 0.06,
      flatShading: true,
    }),
    layout.ridges.length,
  );
  ridges.name = 'ice-cave-crystal-ridges';
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  for (let i = 0; i < layout.ridges.length; i++) {
    const ridge = layout.ridges[i];
    quaternion.setFromUnitVectors(portalForward, vector(ridge.t).normalize());
    ridges.setMatrixAt(
      i,
      matrix.compose(vector(ridge.p), quaternion, new Vector3(1, 1, 1)),
    );
  }
  ridges.count = layout.ridges.length;
  ridges.instanceMatrix.needsUpdate = true;
  group.add(ridges);

  const icicleGeometry = new ConeGeometry(1, 1, 7);
  const icicles = new InstancedMesh(
    icicleGeometry,
    new MeshStandardMaterial({
      color: 0xd9f7ff,
      emissive: 0x245d78,
      emissiveIntensity: 0.34,
      roughness: 0.24,
      metalness: 0.04,
      flatShading: true,
    }),
    layout.icicles.length,
  );
  icicles.name = 'ice-cave-icicles';
  const coneAxis = new Vector3(0, 1, 0);
  const root = new Vector3();
  const tip = new Vector3();
  const direction = new Vector3();
  const midpoint = new Vector3();
  for (let i = 0; i < layout.icicles.length; i++) {
    const icicle = layout.icicles[i];
    root.copy(vector(icicle.root));
    tip.copy(vector(icicle.tip));
    direction.subVectors(tip, root).normalize();
    midpoint.addVectors(root, tip).multiplyScalar(0.5);
    quaternion.setFromUnitVectors(coneAxis, direction);
    icicles.setMatrixAt(
      i,
      matrix.compose(
        midpoint,
        quaternion,
        new Vector3(icicle.radius, icicle.length, icicle.radius),
      ),
    );
  }
  icicles.count = layout.icicles.length;
  icicles.instanceMatrix.needsUpdate = true;
  group.add(icicles);

  for (let i = 0; i < layout.glows.length; i++) {
    const glow = layout.glows[i];
    const crystal = new Mesh(
      new OctahedronGeometry(0.24, 0),
      new MeshBasicMaterial({ color: glow.color }),
    );
    crystal.name = `ice-cave-glow-${i + 1}`;
    crystal.position.copy(vector(glow.position));
    group.add(crystal);

    const light = new PointLight(glow.color, glow.intensity, glow.distance, 2);
    light.position.copy(crystal.position);
    group.add(light);
  }

  return group;
}

/**
 * Ancient jungle passage built only from the pure ruin contract.
 *
 * The open arches hug the outside of the camera envelope and leave jungle sun
 * between them, so the structure reads as a ruin rather than a third tunnel.
 * Loose blocks and vines use the contract's conservative radii, so this
 * function is deliberately just a transform consumer and cannot invent a new
 * obstruction.
 */
function buildJungleRuin(layout: JungleRuinLayout): Group {
  const group = new Group();
  group.name = 'jungle-ruin';

  const portalGeometry = new TorusGeometry(layout.interiorRadius + 0.02, 0.62, 5, 20);
  const portalMaterial = new MeshStandardMaterial({
    color: 0x9b8a68,
    roughness: 0.96,
    metalness: 0,
    flatShading: true,
  });
  const mossMaterial = new MeshStandardMaterial({
    color: 0x476b35,
    roughness: 1,
    metalness: 0,
  });
  const portalForward = new Vector3(0, 0, 1);
  for (const [name, portal] of [
    ['jungle-ruin-entrance', layout.entrance],
    ['jungle-ruin-exit', layout.exit],
  ] as const) {
    const rotation = new Quaternion().setFromUnitVectors(portalForward, vector(portal.t).normalize());
    const rim = new Mesh(portalGeometry, portalMaterial);
    rim.name = name;
    rim.position.copy(vector(portal.p));
    rim.quaternion.copy(rotation);
    group.add(rim);

    const moss = new Mesh(
      new TorusGeometry(layout.interiorRadius + 0.08, 0.16, 5, 20),
      mossMaterial,
    );
    moss.name = `${name}-moss`;
    moss.position.copy(rim.position);
    moss.quaternion.copy(rotation);
    group.add(moss);
  }

  const archGeometry = new TorusGeometry(layout.interiorRadius - 0.38, 0.34, 4, 18);
  const arches = new InstancedMesh(
    archGeometry,
    new MeshStandardMaterial({
      color: 0x8d8264,
      roughness: 0.98,
      metalness: 0,
      flatShading: true,
    }),
    layout.arches.length,
  );
  arches.name = 'jungle-ruin-arches';
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  for (let i = 0; i < layout.arches.length; i++) {
    const arch = layout.arches[i];
    quaternion.setFromUnitVectors(portalForward, vector(arch.t).normalize());
    arches.setMatrixAt(i, matrix.compose(vector(arch.p), quaternion, new Vector3(1, 1, 1)));
  }
  arches.count = layout.arches.length;
  arches.instanceMatrix.needsUpdate = true;
  group.add(arches);

  const stoneGeometry = new BoxGeometry(1, 1, 1);
  const stones = new InstancedMesh(
    stoneGeometry,
    new MeshStandardMaterial({ color: 0x75694f, roughness: 1, metalness: 0, flatShading: true }),
    layout.stones.length,
  );
  stones.name = 'jungle-ruin-wall-stones';
  const rotation = new Quaternion();
  const euler = new Euler();
  for (let i = 0; i < layout.stones.length; i++) {
    const stone = layout.stones[i];
    euler.set(stone.rotation.x, stone.rotation.y, stone.rotation.z, 'XYZ');
    rotation.setFromEuler(euler);
    stones.setMatrixAt(
      i,
      matrix.compose(
        vector(stone.position),
        rotation,
        new Vector3(stone.radius * 1.2, stone.radius * 0.85, stone.radius * 1.1),
      ),
    );
  }
  stones.count = layout.stones.length;
  stones.instanceMatrix.needsUpdate = true;
  group.add(stones);

  const vineGeometry = new CylinderGeometry(1, 0.72, 1, 6);
  const vines = new InstancedMesh(
    vineGeometry,
    new MeshStandardMaterial({ color: 0x386d32, roughness: 0.9, metalness: 0 }),
    layout.vines.length,
  );
  vines.name = 'jungle-ruin-vines';
  const root = new Vector3();
  const tip = new Vector3();
  const direction = new Vector3();
  const midpoint = new Vector3();
  const vineAxis = new Vector3(0, 1, 0);
  for (let i = 0; i < layout.vines.length; i++) {
    const vine = layout.vines[i];
    root.copy(vector(vine.root));
    tip.copy(vector(vine.tip));
    direction.subVectors(tip, root).normalize();
    midpoint.addVectors(root, tip).multiplyScalar(0.5);
    quaternion.setFromUnitVectors(vineAxis, direction);
    vines.setMatrixAt(
      i,
      matrix.compose(
        midpoint,
        quaternion,
        new Vector3(vine.radius, vine.length, vine.radius),
      ),
    );
  }
  vines.count = layout.vines.length;
  vines.instanceMatrix.needsUpdate = true;
  group.add(vines);

  for (let i = 0; i < layout.glyphs.length; i++) {
    const glyph = layout.glyphs[i];
    const marker = new Mesh(
      new OctahedronGeometry(0.22, 0),
      new MeshBasicMaterial({ color: glyph.color }),
    );
    marker.name = `jungle-ruin-glyph-${i + 1}`;
    marker.position.copy(vector(glyph.position));
    group.add(marker);

    const light = new PointLight(glyph.color, glyph.intensity, glyph.distance, 2);
    light.position.copy(marker.position);
    group.add(light);
  }

  return group;
}

/**
 * Builds everything that is not the track, the marbles or the lights.
 *
 * Returns a group to add to the scene plus a handle on the motes, which are the
 * only part that animates.
 */
export function buildWorld(palette: Palette, track: Track, seed: string): WorldParts {
  const group = new Group();
  group.name = 'world';
  // Authored crossings take priority. Attribution is then selected around
  // those intervals and, in turn, reserves its bounds before props or the cast
  // are placed. That ordering keeps every overlap intentional.
  const setPiece: TunnelSetPieceLayout | null =
    palette.kind !== 'surface'
      ? null
      : palette.name === 'desierto'
        ? buildDesertMineTunnelLayout(track, seed)
        : palette.name === 'glaciar'
          ? buildGlacierIceCaveLayout(track, seed)
          : palette.name === 'jungla'
            ? buildJungleRuinLayout(track, seed)
            : null;
  const attribution = buildAttributionLayout(track, seed, {
    exclusions: setPiece ? [setPiece.spectatorExclusion] : [],
  });
  if (palette.kind !== 'surface') {
    return { group, motes: null, setPiece: null, attribution };
  }

  // TerrainLayout owns both the world extent and the complete height function.
  // Keeping that contract renderer-free lets Node prove the actual mesh grid
  // remains below every branch of the course before Three.js draws it.
  const terrain = buildTerrainHeightfield(track, palette.groundRelief);
  const centre = new Vector3(terrain.centre.x, terrain.centre.y, terrain.centre.z);
  const { reach } = terrain;

  // ---- sky dome
  const sky = new Mesh(
    new SphereGeometry(Math.max(reach * 3, 400), 24, 16),
    new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uHigh: { value: new Color(palette.skyHigh) },
        uHorizon: { value: new Color(palette.background) },
      },
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
    }),
  );
  sky.position.copy(centre);
  // Drawn first and never depth-tested against, so it can never occlude the
  // race no matter how the camera swings.
  sky.renderOrder = -1;
  group.add(sky);

  // ---- terrain
  //
  const groundHeightAt = terrain.heightAt;

  if (palette.ground !== null) {
    const { segments, size } = terrain;
    const groundGeo = new PlaneGeometry(size, size, segments, segments);
    const position = groundGeo.attributes.position as BufferAttribute;
    for (let i = 0; i < position.count; i++) {
      // Plane lies in XY and is rotated -90° about X, so local +Y becomes world
      // -Z and the local Z we write becomes world height.
      const lx = position.getX(i);
      const ly = position.getY(i);
      const wx = centre.x + lx;
      const wz = centre.z - ly;
      position.setZ(i, groundHeightAt(wx, wz) - centre.y);
    }
    groundGeo.computeVertexNormals();

    const ground = new Mesh(
      groundGeo,
      new MeshStandardMaterial({ color: palette.ground, roughness: 0.95, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(centre.x, centre.y, centre.z);
    group.add(ground);

    if (setPiece?.kind === 'desert-mine') group.add(buildDesertMineTunnel(setPiece));
    if (setPiece?.kind === 'glacier-ice-cave') group.add(buildGlacierIceCave(setPiece));
    if (setPiece?.kind === 'jungle-ruin') group.add(buildJungleRuin(setPiece));

    // ---- scenery
    const propGeo = propGeometry(palette);
    if (propGeo && palette.propCount > 0) {
      const placements = buildPropLayout(palette, track, seed, groundHeightAt, {
        exclusions: [
          ...(setPiece ? [setPiece.propExclusion] : []),
          ...attribution.propExclusions,
        ],
      });
      const mesh = new InstancedMesh(
        propGeo,
        new MeshStandardMaterial({ color: palette.propColor, roughness: 0.9, metalness: 0 }),
        palette.propCount,
      );
      const matrix = new Matrix4();
      const pos = new Vector3();
      const quat = new Quaternion();
      const scale = new Vector3();
      const axis = new Vector3();
      for (let i = 0; i < placements.length; i++) {
        const placement = placements[i];
        pos.set(placement.x, placement.y, placement.z);
        scale.set(placement.scaleX, placement.scaleY, placement.scaleZ);
        axis.set(placement.axisX, placement.axisY, placement.axisZ);
        quat.setFromAxisAngle(axis, placement.angle);
        mesh.setMatrixAt(i, matrix.compose(pos, quat, scale));
      }
      // Rejection is allowed to leave fewer instances than the world's budget.
      // Uninitialised matrices must never render at the origin, on the grid.
      mesh.count = placements.length;
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
    }
  }

  // ---- atmosphere
  let motes: WorldParts['motes'] = null;
  if (palette.motes !== 'none' && palette.moteCount > 0) {
    const rng = stream(seed, COSMETIC.motes);
    const span = 90;
    const count = palette.moteCount;
    const array = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      array[3 * i] = rng.range(-span, span);
      array[3 * i + 1] = rng.range(-span, span);
      array[3 * i + 2] = rng.range(-span, span);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(array, 3));
    const points = new Points(
      geo,
      new PointsMaterial({
        color: palette.moteColor,
        size: moteSize(palette),
        transparent: true,
        opacity: palette.motes === 'sand' ? 0.45 : 0.8,
        depthWrite: false,
        // Motes must NOT be fogged out: they are the nearest thing in the
        // frame and the whole point is that they pass the camera.
        fog: false,
      }),
    );
    group.add(points);
    motes = { points, drift: moteDrift(palette), span, base: new Vector3() };
  }

  return { group, motes, setPiece, attribution };
}

/**
 * Drifts the motes and keeps them wrapped around the camera.
 *
 * The field is a box that follows the camera and wraps on all three axes, so a
 * few hundred particles look like weather across a 400-metre course. Wrapping
 * on the *drift* axis is what makes it seamless — snow leaving the bottom
 * re-enters at the top.
 */
export function updateMotes(motes: NonNullable<WorldParts['motes']>, dt: number, camera: Vector3): void {
  const attr = motes.points.geometry.attributes.position as BufferAttribute;
  const array = attr.array as Float32Array;
  const { drift, span } = motes;
  const twice = span * 2;

  for (let i = 0; i < array.length; i += 3) {
    array[i] += drift.x * dt;
    array[i + 1] += drift.y * dt;
    array[i + 2] += drift.z * dt;

    // Wrap into the box centred on the camera. `((v % t) + t) % t` rather than
    // a conditional, so a large dt (a stalled tab, a slow export frame) cannot
    // leave a particle outside the box.
    for (let axis = 0; axis < 3; axis++) {
      const c = axis === 0 ? camera.x : axis === 1 ? camera.y : camera.z;
      const rel = array[i + axis] - c + span;
      array[i + axis] = c - span + ((rel % twice) + twice) % twice;
    }
  }
  attr.needsUpdate = true;
}
