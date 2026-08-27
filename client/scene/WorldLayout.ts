/**
 * Deterministic, renderer-free placement for ordinary world scenery.
 *
 * This module knows about the track and conservative prop footprints, but not
 * about Three.js. Keeping the maths pure lets `npm test` prove the guarantee we
 * actually care about: a tree, dune or ice shard may be near the race, but its
 * geometry can never occupy the chute/camera corridor by accident.
 *
 * Intentional intersections (mine tunnels, ice caves, planet interiors) do not
 * belong here. They will be explicit set-piece intervals with authored portals
 * and a larger camera envelope. This layout is for scenery that must move out
 * of the way.
 */
import type { Palette, PropKind } from '@shared/palette.ts';
import { COSMETIC, stream, type Rng } from '@shared/rng.ts';
import type { Track } from '@shared/track.ts';

/** Fine enough that the chord of the tightest generated turn misses by <3 cm. */
export const TRACK_PLAN_SAMPLE_SPACING = 1.5;
/** Covers spline curvature between plan samples with ample numerical margin. */
export const TRACK_PLAN_SAFETY_MARGIN = 0.15;

/**
 * Empty plan-view space around the centreline before a prop's own footprint.
 *
 * The chute itself is ~1 m in radius. The remaining space protects the chase
 * camera, which rides several metres along local-up and cuts slightly across a
 * bend while smoothing. Projecting this whole envelope onto X/Z is deliberately
 * conservative: a prop does not get to pierce an overhead spiral merely because
 * its base is eleven metres below it.
 */
export const ORDINARY_PROP_TRACK_CLEARANCE = 7.5;

// Authored set-piece reservations remove more candidate area than the ordinary
// track corridor. Keep enough deterministic redraws to preserve each biome's
// visual density even when a mine and its portal approaches occupy a long run.
const MAX_ATTEMPTS_PER_PROP = 96;

export interface PlanPoint {
  x: number;
  z: number;
}

export interface PropPlacement {
  x: number;
  y: number;
  z: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  /** Axis-angle rotation, kept renderer-neutral. */
  axisX: number;
  axisY: number;
  axisZ: number;
  angle: number;
  /** Conservative X/Z footprint used by the clearance query. */
  radius: number;
}

/** A plan-view envelope reserved by an intentional set piece. */
export interface PropExclusionZone {
  points: readonly PlanPoint[];
  radius: number;
}

export interface PropLayoutOptions {
  /** Checked before placement so ordinary scenery cannot invade authored geometry. */
  exclusions?: readonly PropExclusionZone[];
}

export type GroundHeightAt = (x: number, z: number) => number;

/** Samples the whole centreline, including both endpoints. */
export function sampleTrackPlan(
  track: Track,
  spacing = TRACK_PLAN_SAMPLE_SPACING,
): PlanPoint[] {
  const count = Math.max(1, Math.ceil(track.total / Math.max(spacing, 0.1)));
  const points: PlanPoint[] = [];
  for (let i = 0; i <= count; i++) {
    const p = track.table.frameAt((i / count) * track.total).p;
    points.push({ x: p.x, z: p.z });
  }
  return points;
}

/** Exact point-to-polyline distance in plan view (X/Z). */
export function distanceToTrackPlan(x: number, z: number, points: readonly PlanPoint[]): number {
  if (points.length === 0) return Infinity;
  if (points.length === 1) return Math.hypot(x - points[0].x, z - points[0].z);

  let bestSquared = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lengthSquared = dx * dx + dz * dz;
    const along =
      lengthSquared > 1e-12
        ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / lengthSquared))
        : 0;
    const nearestX = a.x + dx * along;
    const nearestZ = a.z + dz * along;
    const ex = x - nearestX;
    const ez = z - nearestZ;
    bestSquared = Math.min(bestSquared, ex * ex + ez * ez);
  }
  return Math.sqrt(bestSquared);
}

export function clearsTrackPlan(
  x: number,
  z: number,
  propRadius: number,
  points: readonly PlanPoint[],
  corridor = ORDINARY_PROP_TRACK_CLEARANCE,
): boolean {
  return (
    distanceToTrackPlan(x, z, points) >=
    corridor + Math.max(0, propRadius) + TRACK_PLAN_SAFETY_MARGIN
  );
}

/** True when a prop's complete footprint clears every authored exclusion zone. */
export function clearsPropExclusions(
  x: number,
  z: number,
  propRadius: number,
  exclusions: readonly PropExclusionZone[],
): boolean {
  return exclusions.every(
    (zone) =>
      distanceToTrackPlan(x, z, zone.points) >=
      Math.max(0, zone.radius) + Math.max(0, propRadius) + TRACK_PLAN_SAFETY_MARGIN,
  );
}

interface Shape {
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  axisX: number;
  axisY: number;
  axisZ: number;
  angle: number;
  radius: number;
}

function shapeFor(kind: PropKind, rng: Rng): Shape | null {
  if (kind === 'none') return null;

  if (kind === 'dunes') {
    const s = rng.range(9, 26);
    const scaleX = s;
    const scaleY = s * rng.range(0.16, 0.3);
    const scaleZ = s * rng.range(0.5, 0.9);
    return {
      scaleX,
      scaleY,
      scaleZ,
      axisX: 0,
      axisY: 1,
      axisZ: 0,
      angle: rng.next() * Math.PI,
      radius: Math.max(scaleX, scaleZ),
    };
  }

  if (kind === 'shards') {
    const s = rng.range(2.5, 9);
    const axisX = rng.signed();
    const axisY = 1;
    const axisZ = rng.signed();
    const axisLength = Math.hypot(axisX, axisY, axisZ) || 1;
    const scaleX = s * rng.range(0.4, 0.8);
    const scaleY = s * rng.range(1.4, 3);
    const scaleZ = s * rng.range(0.4, 0.8);
    return {
      scaleX,
      scaleY,
      scaleZ,
      axisX: axisX / axisLength,
      axisY: axisY / axisLength,
      axisZ: axisZ / axisLength,
      angle: rng.signed() * 0.4,
      radius: Math.max(scaleX, scaleZ),
    };
  }

  const s = rng.range(2.2, 5.5);
  const scaleX = s * rng.range(0.7, 1.1);
  const scaleY = s * rng.range(1.4, 2.6);
  const scaleZ = s * rng.range(0.7, 1.1);
  return {
    scaleX,
    scaleY,
    scaleZ,
    axisX: 0,
    axisY: 1,
    axisZ: 0,
    angle: rng.next() * Math.PI * 2,
    radius: Math.max(scaleX, scaleZ),
  };
}

/** Dunes may merge softly; solid trees and shards need more distinct silhouettes. */
function propSpacingFactor(kind: PropKind): number {
  return kind === 'dunes' ? 0.5 : 0.9;
}

function clearsOtherProps(candidate: PropPlacement, placed: readonly PropPlacement[], kind: PropKind): boolean {
  const factor = propSpacingFactor(kind);
  return placed.every((other) => {
    const minimum = (candidate.radius + other.radius) * factor;
    return Math.hypot(candidate.x - other.x, candidate.z - other.z) >= minimum;
  });
}

/**
 * Builds every instance transform for one surface world.
 *
 * Candidates are anchored all along the course instead of around one global
 * midpoint. A candidate that approaches any other part of a looping track is
 * rejected and redrawn from the same cosmetic stream. This is deterministic:
 * same race seed + same world + same track produces byte-identical transforms.
 */
export function buildPropLayout(
  palette: Palette,
  track: Track,
  seed: string,
  groundHeightAt: GroundHeightAt,
  options: PropLayoutOptions = {},
): PropPlacement[] {
  if (palette.kind !== 'surface' || palette.props === 'none' || palette.propCount <= 0) return [];

  const points = sampleTrackPlan(track);
  const rng = stream(seed, COSMETIC.props);
  const placed: PropPlacement[] = [];
  const attemptLimit = palette.propCount * MAX_ATTEMPTS_PER_PROP;

  for (let attempt = 0; attempt < attemptLimit && placed.length < palette.propCount; attempt++) {
    const shape = shapeFor(palette.props, rng);
    if (!shape) break;

    const anchorS = rng.range(0, track.finishS);
    const frame = track.table.frameAt(anchorS);
    // Prefer either side of the course so scenery reads from the chase camera,
    // with enough angular jitter to avoid two ruler-straight prop bands.
    let sideX = frame.side.x;
    let sideZ = frame.side.z;
    const sideLength = Math.hypot(sideX, sideZ);
    if (sideLength > 1e-8) {
      sideX /= sideLength;
      sideZ /= sideLength;
    } else {
      sideX = -frame.t.z;
      sideZ = frame.t.x;
    }
    const side = rng.chance(0.5) ? 1 : -1;
    const baseAngle = Math.atan2(sideZ * side, sideX * side);
    const angle = baseAngle + rng.range(-0.72, 0.72);
    const distance = ORDINARY_PROP_TRACK_CLEARANCE + shape.radius + rng.range(4, 54);
    const x = frame.p.x + Math.cos(angle) * distance;
    const z = frame.p.z + Math.sin(angle) * distance;

    if (!clearsTrackPlan(x, z, shape.radius, points)) continue;
    if (!clearsPropExclusions(x, z, shape.radius, options.exclusions ?? [])) continue;

    const candidate: PropPlacement = {
      x,
      // Preserve the established silhouette: existing primitives intentionally
      // sit partly in the procedural terrain instead of balancing on a point.
      y: groundHeightAt(x, z) + shape.scaleY * 0.5,
      z,
      ...shape,
    };
    if (!clearsOtherProps(candidate, placed, palette.props)) continue;
    placed.push(candidate);
  }

  return placed;
}
