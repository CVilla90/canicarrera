/**
 * Renderer-free placement for the attribution signs that must survive export.
 *
 * The trackside signs deliberately use segment landmarks: they arrive at
 * authored beats in the course rather than at arbitrary metres. Every visible
 * bound is declared here before Three.js draws it, which lets node tests prove
 * that a sign clears the chase camera, other course sections, set pieces,
 * ordinary scenery, and spectators.
 */
import { COSMETIC, stream } from '@shared/rng.ts';
import type { Track } from '@shared/track.ts';
import type { PropExclusionZone } from './WorldLayout.ts';

export const ATTRIBUTION_BILLBOARD_COUNT = 3;
export const ATTRIBUTION_BILLBOARD_WIDTH = 6.8;
export const ATTRIBUTION_BILLBOARD_HEIGHT = 3.4;
export const ATTRIBUTION_BILLBOARD_DEPTH = 0.18;
export const ATTRIBUTION_BILLBOARD_SIDE_OFFSET = 10;
export const ATTRIBUTION_BILLBOARD_LIFT = 2.8;
export const ATTRIBUTION_CAMERA_ENVELOPE = 5.5;
export const ATTRIBUTION_CAMERA_MARGIN = 0.75;
export const ATTRIBUTION_GRID_BUFFER = 24;
export const ATTRIBUTION_FINISH_BUFFER = 18;
export const ATTRIBUTION_MIN_ARC_SPACING = 24;
export const ATTRIBUTION_LOCAL_ARC_GAP = 14;
export const ATTRIBUTION_OTHER_TRACK_MARGIN = 0.5;
export const ATTRIBUTION_SPECTATOR_HALF_ARC = 6;
export const ATTRIBUTION_TRACK_SAMPLE_SPACING = 1.5;

/** Complete half-diagonal used for conservative track and prop clearance. */
export const ATTRIBUTION_BILLBOARD_RADIUS = Math.hypot(
  ATTRIBUTION_BILLBOARD_WIDTH * 0.5,
  ATTRIBUTION_BILLBOARD_HEIGHT * 0.5,
  ATTRIBUTION_BILLBOARD_DEPTH * 0.5,
);

export interface AttributionVec3 {
  x: number;
  y: number;
  z: number;
}

/** Structural match for an authored set-piece spectator exclusion. */
export interface AttributionArcExclusion {
  startS: number;
  endS: number;
}

export interface AttributionBillboardPlacement {
  s: number;
  side: -1 | 1;
  position: AttributionVec3;
  /** Local +X for the plane. */
  right: AttributionVec3;
  /** Local +Y for the plane. */
  up: AttributionVec3;
  /** Local +Z, facing upstream towards the chase camera. */
  normal: AttributionVec3;
  width: number;
  height: number;
  depth: number;
  radius: number;
  /** Narrowest gap between the board edge and the chase-camera envelope. */
  cameraClearance: number;
  /** Complete 3-D clearance to every non-local track sample. */
  nonLocalTrackClearance: number;
}

export interface AttributionLayout {
  billboards: AttributionBillboardPlacement[];
  /** Keeps surface-world props outside the complete board geometry. */
  propExclusions: PropExclusionZone[];
  /** Keeps the deterministic cast out from under each sign. */
  spectatorExclusions: AttributionArcExclusion[];
}

export interface AttributionLayoutOptions {
  /** Set-piece intervals are selected before signs and always take priority. */
  exclusions?: readonly AttributionArcExclusion[];
}

interface TrackSample {
  s: number;
  p: AttributionVec3;
}

const overlapsArc = (
  startS: number,
  endS: number,
  exclusion: AttributionArcExclusion,
): boolean => startS < exclusion.endS && endS > exclusion.startS;

function sampleTrack(track: Track): TrackSample[] {
  const count = Math.max(1, Math.ceil(track.total / ATTRIBUTION_TRACK_SAMPLE_SPACING));
  const samples: TrackSample[] = [];
  for (let i = 0; i <= count; i++) {
    const s = (i / count) * track.total;
    const p = track.table.frameAt(s).p;
    samples.push({ s, p: { x: p.x, y: p.y, z: p.z } });
  }
  return samples;
}

function distance3(a: AttributionVec3, b: AttributionVec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function nonLocalTrackClearance(
  position: AttributionVec3,
  s: number,
  track: Track,
  samples: readonly TrackSample[],
): number {
  let nearest = Infinity;
  for (const sample of samples) {
    if (Math.abs(sample.s - s) < ATTRIBUTION_LOCAL_ARC_GAP) continue;
    nearest = Math.min(nearest, distance3(position, sample.p));
  }
  return nearest - ATTRIBUTION_BILLBOARD_RADIUS - track.tubeRadius;
}

function placementAt(
  track: Track,
  samples: readonly TrackSample[],
  s: number,
  side: -1 | 1,
): AttributionBillboardPlacement | null {
  const frame = track.table.frameAt(s);
  const position = {
    x:
      frame.p.x +
      frame.side.x * side * ATTRIBUTION_BILLBOARD_SIDE_OFFSET -
      frame.d.x * ATTRIBUTION_BILLBOARD_LIFT,
    y:
      frame.p.y +
      frame.side.y * side * ATTRIBUTION_BILLBOARD_SIDE_OFFSET -
      frame.d.y * ATTRIBUTION_BILLBOARD_LIFT,
    z:
      frame.p.z +
      frame.side.z * side * ATTRIBUTION_BILLBOARD_SIDE_OFFSET -
      frame.d.z * ATTRIBUTION_BILLBOARD_LIFT,
  };
  const cameraClearance =
    ATTRIBUTION_BILLBOARD_SIDE_OFFSET -
    ATTRIBUTION_BILLBOARD_WIDTH * 0.5 -
    ATTRIBUTION_CAMERA_ENVELOPE;
  const otherTrackClearance = nonLocalTrackClearance(position, s, track, samples);
  if (
    cameraClearance < ATTRIBUTION_CAMERA_MARGIN ||
    otherTrackClearance < ATTRIBUTION_OTHER_TRACK_MARGIN
  ) {
    return null;
  }

  return {
    s,
    side,
    position,
    // right × up = normal, so the serialised basis is a valid rotation matrix.
    right: { x: -frame.side.x, y: -frame.side.y, z: -frame.side.z },
    up: { x: -frame.d.x, y: -frame.d.y, z: -frame.d.z },
    normal: { x: -frame.t.x, y: -frame.t.y, z: -frame.t.z },
    width: ATTRIBUTION_BILLBOARD_WIDTH,
    height: ATTRIBUTION_BILLBOARD_HEIGHT,
    depth: ATTRIBUTION_BILLBOARD_DEPTH,
    radius: ATTRIBUTION_BILLBOARD_RADIUS,
    cameraClearance,
    nonLocalTrackClearance: otherTrackClearance,
  };
}

function clearsOtherBillboards(
  candidate: AttributionBillboardPlacement,
  placed: readonly AttributionBillboardPlacement[],
): boolean {
  return placed.every(
    (other) =>
      Math.abs(candidate.s - other.s) >= ATTRIBUTION_MIN_ARC_SPACING &&
      distance3(candidate.position, other.position) >= candidate.radius + other.radius + 0.5,
  );
}

/**
 * Selects at most three safe landmark positions. Returning fewer is honest: a
 * future compact or tightly folded grammar should not have a sign forced into
 * the shot simply to satisfy a visual quota.
 */
export function buildAttributionLayout(
  track: Track,
  seed: string,
  options: AttributionLayoutOptions = {},
): AttributionLayout {
  const rng = stream(seed, COSMETIC.billboards);
  const exclusions = options.exclusions ?? [];
  const candidates = track.landmarks
    .map((landmark) => landmark.s)
    .filter(
      (s) =>
        s >= ATTRIBUTION_GRID_BUFFER &&
        s <= track.finishS - ATTRIBUTION_FINISH_BUFFER &&
        exclusions.every(
          (exclusion) =>
            !overlapsArc(
              s - ATTRIBUTION_SPECTATOR_HALF_ARC,
              s + ATTRIBUTION_SPECTATOR_HALF_ARC,
              exclusion,
            ),
        ),
    );
  rng.shuffle(candidates);

  const samples = sampleTrack(track);
  const billboards: AttributionBillboardPlacement[] = [];
  for (const s of candidates) {
    const firstSide: -1 | 1 = rng.chance(0.5) ? 1 : -1;
    const attempts: readonly (-1 | 1)[] = [firstSide, firstSide === 1 ? -1 : 1];
    for (const side of attempts) {
      const candidate = placementAt(track, samples, s, side);
      if (!candidate || !clearsOtherBillboards(candidate, billboards)) continue;
      billboards.push(candidate);
      break;
    }
    if (billboards.length >= ATTRIBUTION_BILLBOARD_COUNT) break;
  }
  billboards.sort((a, b) => a.s - b.s);

  return {
    billboards,
    propExclusions: billboards.map((billboard) => ({
      points: [{ x: billboard.position.x, z: billboard.position.z }],
      radius: billboard.radius,
    })),
    spectatorExclusions: billboards.map((billboard) => ({
      startS: Math.max(0, billboard.s - ATTRIBUTION_SPECTATOR_HALF_ARC),
      endS: Math.min(track.finishS, billboard.s + ATTRIBUTION_SPECTATOR_HALF_ARC),
    })),
  };
}

export const OUTRO_CARD_DELAY = 0.9;
export const OUTRO_CARD_FADE = 0.65;

/** Pure timing shared by realtime preview and frame-indexed export. */
export function outroCardOpacity(time: number, endTime: number, finished: boolean): number {
  if (!finished || endTime <= 0) return 0;
  return Math.max(0, Math.min(1, (time - endTime - OUTRO_CARD_DELAY) / OUTRO_CARD_FADE));
}
