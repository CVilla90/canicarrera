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
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type BufferGeometry as Geometry,
} from 'three';

import type { Palette } from '@shared/palette.ts';
import type { Track } from '@shared/track.ts';
import { COSMETIC, stream } from '@shared/rng.ts';
import { buildPropLayout } from './WorldLayout.ts';

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

/**
 * Builds everything that is not the track, the marbles or the lights.
 *
 * Returns a group to add to the scene plus a handle on the motes, which are the
 * only part that animates.
 */
export function buildWorld(palette: Palette, track: Track, seed: string): WorldParts {
  const group = new Group();
  group.name = 'world';
  if (palette.kind !== 'surface') return { group, motes: null };

  // Centre everything on the middle of the run, so a long course does not
  // wander off the edge of its own terrain.
  const mid = track.table.frameAt(track.total * 0.5).p;
  const centre = new Vector3(mid.x, mid.y, mid.z);
  // How far the track wanders, used to size the terrain and the scatter radius.
  // Use the WHOLE course, not only start and finish. A spiral can travel far
  // outside both endpoints, and sizing a world from those two points alone can
  // put legitimate scenery beyond its terrain plate.
  let courseReach = 0;
  for (let i = 0; i <= 96; i++) {
    const p = track.table.frameAt((i / 96) * track.total).p;
    courseReach = Math.max(courseReach, Math.hypot(p.x - centre.x, p.z - centre.z));
  }
  const reach = courseReach + 90;

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
  // The terrain FOLLOWS THE TRACK DOWN. These courses drop 40 m or more, so a
  // flat plate at any single height is wrong everywhere else: put it at the
  // lowest point and the whole first half of the race happens in empty sky;
  // put it at the start and the finish line is buried. A marble run in a jungle
  // is on a hillside, so the ground is a hillside — sampled from the track's
  // own descent and dropped a fixed depth below it.
  const SAMPLES = 72;
  const spine: Array<{ x: number; z: number; y: number }> = [];
  let lowest = Infinity;
  for (let i = 0; i <= SAMPLES; i++) {
    const p = track.table.frameAt((i / SAMPLES) * track.total).p;
    spine.push({ x: p.x, z: p.z, y: p.y });
    if (p.y < lowest) lowest = p.y;
  }
  /** Depth of the chute above the ground. Enough that props never pierce it. */
  const DEPTH = 11;

  /**
   * Ground height under a world position.
   *
   * Nearest point on the spine, then eased out to the lowest level as you get
   * far away — so the hillside reads locally and the distance still flattens
   * into a horizon instead of tilting off to infinity.
   */
  const groundHeightAt = (x: number, z: number): number => {
    let best = Infinity;
    let bestY = lowest;
    for (const s of spine) {
      const d = (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z);
      if (d < best) {
        best = d;
        bestY = s.y;
      }
    }
    const distance = Math.sqrt(best);
    const blend = Math.min(1, distance / 140);
    return (bestY - DEPTH) * (1 - blend) + (lowest - DEPTH - 6) * blend;
  };

  if (palette.ground !== null) {
    const segments = 64;
    const size = reach * 4;
    const groundGeo = new PlaneGeometry(size, size, segments, segments);
    const position = groundGeo.attributes.position as BufferAttribute;
    for (let i = 0; i < position.count; i++) {
      // Plane lies in XY and is rotated -90° about X, so local +Y becomes world
      // -Z and the local Z we write becomes world height.
      const lx = position.getX(i);
      const ly = position.getY(i);
      const wx = centre.x + lx;
      const wz = centre.z - ly;
      const relief =
        Math.sin(wx * 0.031) * 0.6 + Math.sin(wz * 0.027) * 0.5 + Math.sin((wx + wz) * 0.013) * 0.7;
      position.setZ(i, groundHeightAt(wx, wz) - centre.y + relief * palette.groundRelief);
    }
    groundGeo.computeVertexNormals();

    const ground = new Mesh(
      groundGeo,
      new MeshStandardMaterial({ color: palette.ground, roughness: 0.95, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(centre.x, centre.y, centre.z);
    group.add(ground);

    // ---- scenery
    const propGeo = propGeometry(palette);
    if (propGeo && palette.propCount > 0) {
      const placements = buildPropLayout(palette, track, seed, groundHeightAt);
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

  return { group, motes };
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
