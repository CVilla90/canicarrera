/**
 * Renderer-free contracts for intentional world set pieces.
 *
 * Ordinary scenery has to move away from the race. A tunnel is the opposite:
 * it deliberately surrounds the chute and chase camera, so it needs explicit
 * entrances, an interior envelope, non-local track clearance and a reserved
 * prop corridor. Keeping selection here lets Node verify those promises before
 * Three.js turns the result into rock and timber.
 */
import { COSMETIC, stream } from '@shared/rng.ts';
import type { Track } from '@shared/track.ts';
import type { TrackFrame } from '@shared/curve.ts';
import type { PropExclusionZone } from './WorldLayout.ts';

export const MINE_TUNNEL_PREFERRED_LENGTH = 30;
export const MINE_TUNNEL_MIN_LENGTH = 14;
export const MINE_GRID_BUFFER = 45;
export const MINE_FINISH_BUFFER = 10;
export const MINE_TUNNEL_INTERIOR_RADIUS = 6.4;
export const MINE_TUNNEL_OUTER_RADIUS = 8.25;
export const MINE_CAMERA_ENVELOPE_RADIUS = 5.5;
// Outer rock is 8.25 m from the axis. The remaining 0.75 m is a dressing and
// spline-sampling buffer before each dune's own conservative footprint.
export const MINE_PROP_EXCLUSION_RADIUS = 9;

const MINE_SAMPLE_SPACING = 1;
const MINE_CANDIDATE_STEP = 2;
const MINE_SEGMENT_INSET = 2;
const MINE_APPROACH_LENGTH = 7;
const MINE_NON_LOCAL_ARC_GAP = 11;
export const MINE_MAX_TANGENT_ANGLE = (9 * Math.PI) / 180;
export const MINE_MAX_SLOPE = 0.66;
const MINE_TRACK_WALL_MARGIN = 0.45;
const MINE_CAMERA_WALL_MARGIN = 0.55;
const MINE_OTHER_TRACK_MARGIN = 0.65;
const CHASE_CAMERA_HEIGHT = 4.4;
const CHASE_CAMERA_TRAIL = 1.6;

export interface LayoutVec3 {
  x: number;
  y: number;
  z: number;
}

export interface SetPieceFrame {
  s: number;
  p: LayoutVec3;
  t: LayoutVec3;
  /** Track-local up. (`TrackFrame.d` points down.) */
  up: LayoutVec3;
  side: LayoutVec3;
}

export interface MineLamp {
  position: LayoutVec3;
  color: number;
  intensity: number;
  distance: number;
}

export interface DesertMineTunnelLayout {
  kind: 'desert-mine';
  startS: number;
  endS: number;
  length: number;
  entrance: SetPieceFrame;
  exit: SetPieceFrame;
  centre: LayoutVec3;
  axis: LayoutVec3;
  interiorRadius: number;
  outerRadius: number;
  cameraEnvelopeRadius: number;
  propExclusion: PropExclusionZone;
  supports: readonly SetPieceFrame[];
  lamps: readonly MineLamp[];
  /** Measured against the straight authored shell, retained for regression tests. */
  metrics: {
    minTangentDot: number;
    maxSlope: number;
    maxTrackAxisOffset: number;
    maxCameraAxisOffset: number;
    nearestOtherTrack: number;
  };
}

interface Candidate {
  startS: number;
  endS: number;
  length: number;
  entrance: SetPieceFrame;
  exit: SetPieceFrame;
  centre: LayoutVec3;
  axis: LayoutVec3;
  metrics: DesertMineTunnelLayout['metrics'];
}

const cloneVec = (v: LayoutVec3): LayoutVec3 => ({ x: v.x, y: v.y, z: v.z });

function frameData(s: number, frame: TrackFrame): SetPieceFrame {
  return {
    s,
    p: cloneVec(frame.p),
    t: cloneVec(frame.t),
    up: { x: -frame.d.x, y: -frame.d.y, z: -frame.d.z },
    side: cloneVec(frame.side),
  };
}

function subtract(a: LayoutVec3, b: LayoutVec3): LayoutVec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function addScaled(a: LayoutVec3, b: LayoutVec3, scale: number): LayoutVec3 {
  return { x: a.x + b.x * scale, y: a.y + b.y * scale, z: a.z + b.z * scale };
}

function dot(a: LayoutVec3, b: LayoutVec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function length(v: LayoutVec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

function normalise(v: LayoutVec3): LayoutVec3 {
  const magnitude = length(v) || 1;
  return { x: v.x / magnitude, y: v.y / magnitude, z: v.z / magnitude };
}

/** Perpendicular distance to the infinite tunnel axis. */
export function distanceToMineAxis(
  point: LayoutVec3,
  origin: LayoutVec3,
  axis: LayoutVec3,
): number {
  const relative = subtract(point, origin);
  const along = dot(relative, axis);
  const radial = addScaled(relative, axis, -along);
  return length(radial);
}

/** Distance to the finite shell axis, used to reject non-local track crossings. */
function distanceToAxisSegment(
  point: LayoutVec3,
  start: LayoutVec3,
  end: LayoutVec3,
): number {
  const delta = subtract(end, start);
  const lengthSquared = dot(delta, delta);
  const along =
    lengthSquared > 1e-12
      ? Math.max(0, Math.min(1, dot(subtract(point, start), delta) / lengthSquared))
      : 0;
  return length(subtract(point, addScaled(start, delta, along)));
}

function evaluateCandidate(track: Track, startS: number, endS: number): Candidate | null {
  const entranceFrame = track.table.frameAt(startS);
  const exitFrame = track.table.frameAt(endS);
  const chord = subtract(exitFrame.p, entranceFrame.p);
  const chordLength = length(chord);
  if (chordLength < (endS - startS) * 0.965) return null;

  const axis = normalise(chord);
  let minTangentDot = 1;
  let maxSlope = 0;
  let maxTrackAxisOffset = 0;
  let maxCameraAxisOffset = 0;
  const samples = Math.max(2, Math.ceil((endS - startS) / MINE_SAMPLE_SPACING));

  for (let i = 0; i <= samples; i++) {
    const s = startS + ((endS - startS) * i) / samples;
    const frame = track.table.frameAt(s);
    minTangentDot = Math.min(minTangentDot, dot(frame.t, axis));
    maxSlope = Math.max(maxSlope, Math.abs(frame.t.y));
    maxTrackAxisOffset = Math.max(
      maxTrackAxisOffset,
      distanceToMineAxis(frame.p, entranceFrame.p, axis),
    );

    // This is the outermost normal chase-camera position in RaceScene. Its
    // along-track trail does not cost radial room on a straight axis, but does
    // expose curvature, which is exactly what this measurement is meant to do.
    const camera = addScaled(addScaled(frame.p, frame.d, -CHASE_CAMERA_HEIGHT), frame.t, -CHASE_CAMERA_TRAIL);
    maxCameraAxisOffset = Math.max(
      maxCameraAxisOffset,
      distanceToMineAxis(camera, entranceFrame.p, axis),
    );
  }

  if (minTangentDot < Math.cos(MINE_MAX_TANGENT_ANGLE)) return null;
  if (maxSlope > MINE_MAX_SLOPE) return null;
  if (maxTrackAxisOffset + track.tubeRadius + MINE_TRACK_WALL_MARGIN > MINE_TUNNEL_INTERIOR_RADIUS) {
    return null;
  }
  if (maxCameraAxisOffset > MINE_CAMERA_ENVELOPE_RADIUS) return null;
  if (maxCameraAxisOffset + MINE_CAMERA_WALL_MARGIN > MINE_TUNNEL_INTERIOR_RADIUS) return null;

  let nearestOtherTrack = Infinity;
  for (let s = 0; s <= track.total; s += 2) {
    if (s >= startS - MINE_NON_LOCAL_ARC_GAP && s <= endS + MINE_NON_LOCAL_ARC_GAP) continue;
    const distance = distanceToAxisSegment(
      track.table.frameAt(s).p,
      entranceFrame.p,
      exitFrame.p,
    );
    nearestOtherTrack = Math.min(nearestOtherTrack, distance);
  }
  const otherTrackClearance = MINE_TUNNEL_OUTER_RADIUS + track.tubeRadius + MINE_OTHER_TRACK_MARGIN;
  if (nearestOtherTrack < otherTrackClearance) return null;

  return {
    startS,
    endS,
    length: endS - startS,
    entrance: frameData(startS, entranceFrame),
    exit: frameData(endS, exitFrame),
    centre: {
      x: (entranceFrame.p.x + exitFrame.p.x) * 0.5,
      y: (entranceFrame.p.y + exitFrame.p.y) * 0.5,
      z: (entranceFrame.p.z + exitFrame.p.z) * 0.5,
    },
    axis,
    metrics: {
      minTangentDot,
      maxSlope,
      maxTrackAxisOffset,
      maxCameraAxisOffset,
      nearestOtherTrack,
    },
  };
}

/** Candidate starts from declared straight segments, not accidental short chords on a bend. */
function straightSegmentRanges(track: Track): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < track.landmarks.length; i++) {
    const landmark = track.landmarks[i];
    if (landmark.kind !== 'ramp' && landmark.kind !== 'plunge' && landmark.kind !== 'runout') continue;
    ranges.push({
      start: landmark.s + MINE_SEGMENT_INSET,
      end: (track.landmarks[i + 1]?.s ?? track.total) - MINE_SEGMENT_INSET,
    });
  }
  return ranges;
}

function candidateLengths(): number[] {
  const lengths: number[] = [];
  for (let value = MINE_TUNNEL_PREFERRED_LENGTH; value >= MINE_TUNNEL_MIN_LENGTH; value -= 2) {
    lengths.push(value);
  }
  return lengths;
}

/**
 * Selects and fully describes one mine tunnel. `null` means this generated
 * course has no honest interval for it; drawing no tunnel is preferable to
 * intersecting a bend, the grid, the finish or another part of the track.
 */
export function buildDesertMineTunnelLayout(
  track: Track,
  seed: string,
): DesertMineTunnelLayout | null {
  const finishLimit = track.finishS - MINE_FINISH_BUFFER;
  const rng = stream(seed, COSMETIC.setPieces);
  let candidates: Candidate[] = [];

  for (const tunnelLength of candidateLengths()) {
    for (const range of straightSegmentRanges(track)) {
      const first = Math.max(range.start, MINE_GRID_BUFFER);
      const last = Math.min(range.end, finishLimit) - tunnelLength;
      if (last < first) continue;

      const starts = new Set<number>([first, last, (first + last) * 0.5]);
      for (let start = first; start <= last + 1e-9; start += MINE_CANDIDATE_STEP) starts.add(start);
      for (const startS of starts) {
        const candidate = evaluateCandidate(track, startS, startS + tunnelLength);
        if (candidate) candidates.push(candidate);
      }
    }
    // Prefer a real, longer set piece. Only fall back to a short mine when the
    // course genuinely has no safe long straight.
    if (candidates.length > 0) break;
  }

  if (candidates.length === 0) return null;
  candidates = candidates.sort((a, b) => a.startS - b.startS);
  const chosen = candidates[rng.int(candidates.length)];

  const supports: SetPieceFrame[] = [];
  const supportCount = Math.max(3, Math.floor(chosen.length / 4));
  for (let i = 0; i < supportCount; i++) {
    const s = chosen.startS + ((i + 1) / (supportCount + 1)) * chosen.length;
    supports.push(frameData(s, track.table.frameAt(s)));
  }

  const lampColors = [0xffb35c, 0xffcf78, 0xff9b45] as const;
  const lamps: MineLamp[] = [];
  for (let i = 0; i < supports.length; i += 2) {
    const support = supports[i];
    const sideOffset = i % 4 === 0 ? -1.35 : 1.35;
    let position = addScaled(support.p, support.up, MINE_TUNNEL_INTERIOR_RADIUS - 0.75);
    position = addScaled(position, support.side, sideOffset);
    lamps.push({
      position,
      color: lampColors[rng.int(lampColors.length)],
      // Point lights use inverse-square falloff. Mine-scale values around one
      // illuminate only the bulb itself; this range reveals the wall and chute
      // several metres below without flattening the daylight outside.
      intensity: rng.range(32, 46),
      distance: rng.range(14, 18),
    });
  }

  const exclusionPoints: Array<{ x: number; z: number }> = [];
  const exclusionStart = Math.max(0, chosen.startS - MINE_APPROACH_LENGTH);
  const exclusionEnd = Math.min(track.total, chosen.endS + MINE_APPROACH_LENGTH);
  const exclusionSamples = Math.max(2, Math.ceil((exclusionEnd - exclusionStart) / 1.5));
  for (let i = 0; i <= exclusionSamples; i++) {
    const s = exclusionStart + ((exclusionEnd - exclusionStart) * i) / exclusionSamples;
    const p = track.table.frameAt(s).p;
    exclusionPoints.push({ x: p.x, z: p.z });
  }

  return {
    kind: 'desert-mine',
    ...chosen,
    interiorRadius: MINE_TUNNEL_INTERIOR_RADIUS,
    outerRadius: MINE_TUNNEL_OUTER_RADIUS,
    cameraEnvelopeRadius: MINE_CAMERA_ENVELOPE_RADIUS,
    propExclusion: { points: exclusionPoints, radius: MINE_PROP_EXCLUSION_RADIUS },
    supports,
    lamps,
  };
}
