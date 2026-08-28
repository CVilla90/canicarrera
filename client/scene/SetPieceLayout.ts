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
export const MINE_MAX_TANGENT_ANGLE = (9 * Math.PI) / 180;
export const MINE_MAX_SLOPE = 0.66;
// Outer rock is 8.25 m from the axis. The remaining 0.75 m is a dressing and
// spline-sampling buffer before each dune's own conservative footprint.
export const MINE_PROP_EXCLUSION_RADIUS = 9;

export const ICE_CAVE_PREFERRED_LENGTH = 30;
export const ICE_CAVE_MIN_LENGTH = 14;
export const ICE_CAVE_GRID_BUFFER = 45;
export const ICE_CAVE_FINISH_BUFFER = 10;
export const ICE_CAVE_INTERIOR_RADIUS = 7.35;
export const ICE_CAVE_OUTER_RADIUS = 9.5;
export const ICE_CAVE_CAMERA_ENVELOPE_RADIUS = 5.5;
export const ICE_CAVE_PROP_EXCLUSION_RADIUS = 10.25;
export const ICE_CAVE_ICICLE_CAMERA_MARGIN = 0.35;
export const ICE_CAVE_MAX_TANGENT_ANGLE = MINE_MAX_TANGENT_ANGLE;
export const ICE_CAVE_MAX_SLOPE = MINE_MAX_SLOPE;

export const JUNGLE_RUIN_PREFERRED_LENGTH = 30;
export const JUNGLE_RUIN_MIN_LENGTH = 14;
export const JUNGLE_RUIN_GRID_BUFFER = 45;
export const JUNGLE_RUIN_FINISH_BUFFER = 10;
export const JUNGLE_RUIN_INTERIOR_RADIUS = 7;
export const JUNGLE_RUIN_OUTER_RADIUS = 9.15;
export const JUNGLE_RUIN_CAMERA_ENVELOPE_RADIUS = 5.5;
export const JUNGLE_RUIN_PROP_EXCLUSION_RADIUS = 9.9;
export const JUNGLE_RUIN_DRESSING_CAMERA_MARGIN = 0.35;
export const JUNGLE_RUIN_MAX_TANGENT_ANGLE = MINE_MAX_TANGENT_ANGLE;
export const JUNGLE_RUIN_MAX_SLOPE = MINE_MAX_SLOPE;

const MINE_SAMPLE_SPACING = 1;
const MINE_CANDIDATE_STEP = 2;
const MINE_SEGMENT_INSET = 2;
const MINE_APPROACH_LENGTH = 7;
const MINE_NON_LOCAL_ARC_GAP = 11;
const MINE_TRACK_WALL_MARGIN = 0.45;
const MINE_CAMERA_WALL_MARGIN = 0.55;
const MINE_OTHER_TRACK_MARGIN = 0.65;
const CHASE_CAMERA_HEIGHT = 4.4;
const CHASE_CAMERA_TRAIL = 1.6;

interface TunnelProfile {
  preferredLength: number;
  minLength: number;
  gridBuffer: number;
  finishBuffer: number;
  interiorRadius: number;
  outerRadius: number;
  cameraEnvelopeRadius: number;
  propExclusionRadius: number;
  maxTangentAngle: number;
  maxSlope: number;
}

const MINE_PROFILE: TunnelProfile = {
  preferredLength: MINE_TUNNEL_PREFERRED_LENGTH,
  minLength: MINE_TUNNEL_MIN_LENGTH,
  gridBuffer: MINE_GRID_BUFFER,
  finishBuffer: MINE_FINISH_BUFFER,
  interiorRadius: MINE_TUNNEL_INTERIOR_RADIUS,
  outerRadius: MINE_TUNNEL_OUTER_RADIUS,
  cameraEnvelopeRadius: MINE_CAMERA_ENVELOPE_RADIUS,
  propExclusionRadius: MINE_PROP_EXCLUSION_RADIUS,
  maxTangentAngle: MINE_MAX_TANGENT_ANGLE,
  maxSlope: MINE_MAX_SLOPE,
};

const ICE_CAVE_PROFILE: TunnelProfile = {
  preferredLength: ICE_CAVE_PREFERRED_LENGTH,
  minLength: ICE_CAVE_MIN_LENGTH,
  gridBuffer: ICE_CAVE_GRID_BUFFER,
  finishBuffer: ICE_CAVE_FINISH_BUFFER,
  interiorRadius: ICE_CAVE_INTERIOR_RADIUS,
  outerRadius: ICE_CAVE_OUTER_RADIUS,
  cameraEnvelopeRadius: ICE_CAVE_CAMERA_ENVELOPE_RADIUS,
  propExclusionRadius: ICE_CAVE_PROP_EXCLUSION_RADIUS,
  maxTangentAngle: ICE_CAVE_MAX_TANGENT_ANGLE,
  maxSlope: ICE_CAVE_MAX_SLOPE,
};

const JUNGLE_RUIN_PROFILE: TunnelProfile = {
  preferredLength: JUNGLE_RUIN_PREFERRED_LENGTH,
  minLength: JUNGLE_RUIN_MIN_LENGTH,
  gridBuffer: JUNGLE_RUIN_GRID_BUFFER,
  finishBuffer: JUNGLE_RUIN_FINISH_BUFFER,
  interiorRadius: JUNGLE_RUIN_INTERIOR_RADIUS,
  outerRadius: JUNGLE_RUIN_OUTER_RADIUS,
  cameraEnvelopeRadius: JUNGLE_RUIN_CAMERA_ENVELOPE_RADIUS,
  propExclusionRadius: JUNGLE_RUIN_PROP_EXCLUSION_RADIUS,
  maxTangentAngle: JUNGLE_RUIN_MAX_TANGENT_ANGLE,
  maxSlope: JUNGLE_RUIN_MAX_SLOPE,
};

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

export interface SetPieceArcExclusion {
  startS: number;
  endS: number;
}

export interface MineLamp {
  position: LayoutVec3;
  color: number;
  intensity: number;
  distance: number;
}

interface TunnelSetPieceBase {
  kind: 'desert-mine' | 'glacier-ice-cave' | 'jungle-ruin';
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
  spectatorExclusion: SetPieceArcExclusion;
  /** Measured against the straight authored shell, retained for regression tests. */
  metrics: {
    minTangentDot: number;
    maxSlope: number;
    maxTrackAxisOffset: number;
    maxCameraAxisOffset: number;
    nearestOtherTrack: number;
  };
}

export interface DesertMineTunnelLayout extends TunnelSetPieceBase {
  kind: 'desert-mine';
  supports: readonly SetPieceFrame[];
  lamps: readonly MineLamp[];
}

export interface IceCaveIcicle {
  s: number;
  root: LayoutVec3;
  tip: LayoutVec3;
  radius: number;
  length: number;
  /** Conservative gap between the complete cone and the camera envelope. */
  cameraClearance: number;
}

export interface GlacierIceCaveLayout extends TunnelSetPieceBase {
  kind: 'glacier-ice-cave';
  ridges: readonly SetPieceFrame[];
  icicles: readonly IceCaveIcicle[];
  glows: readonly MineLamp[];
}

export interface JungleRuinStone {
  s: number;
  position: LayoutVec3;
  radius: number;
  rotation: LayoutVec3;
  /** Conservative gap between the complete stone and camera envelope. */
  cameraClearance: number;
}

export interface JungleRuinVine {
  s: number;
  root: LayoutVec3;
  tip: LayoutVec3;
  radius: number;
  length: number;
  /** Conservative gap between the hanging vine and camera envelope. */
  cameraClearance: number;
}

export interface JungleRuinLayout extends TunnelSetPieceBase {
  kind: 'jungle-ruin';
  arches: readonly SetPieceFrame[];
  stones: readonly JungleRuinStone[];
  vines: readonly JungleRuinVine[];
  glyphs: readonly MineLamp[];
}

export type IntentionalSetPieceLayout =
  | DesertMineTunnelLayout
  | GlacierIceCaveLayout
  | JungleRuinLayout;

/** Compatibility name retained for the two earlier tunnel-shaped slices. */
export type TunnelSetPieceLayout = IntentionalSetPieceLayout;

interface Candidate {
  startS: number;
  endS: number;
  length: number;
  entrance: SetPieceFrame;
  exit: SetPieceFrame;
  centre: LayoutVec3;
  axis: LayoutVec3;
  metrics: TunnelSetPieceBase['metrics'];
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

/** Biome-neutral name for new set-piece contracts; mine alias stays stable. */
export const distanceToSetPieceAxis = distanceToMineAxis;

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

function evaluateCandidate(
  track: Track,
  startS: number,
  endS: number,
  profile: TunnelProfile,
): Candidate | null {
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

  if (minTangentDot < Math.cos(profile.maxTangentAngle)) return null;
  if (maxSlope > profile.maxSlope) return null;
  if (maxTrackAxisOffset + track.tubeRadius + MINE_TRACK_WALL_MARGIN > profile.interiorRadius) {
    return null;
  }
  if (maxCameraAxisOffset > profile.cameraEnvelopeRadius) return null;
  if (maxCameraAxisOffset + MINE_CAMERA_WALL_MARGIN > profile.interiorRadius) return null;

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
  const otherTrackClearance = profile.outerRadius + track.tubeRadius + MINE_OTHER_TRACK_MARGIN;
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

function candidateLengths(profile: TunnelProfile): number[] {
  const lengths: number[] = [];
  for (let value = profile.preferredLength; value >= profile.minLength; value -= 2) {
    lengths.push(value);
  }
  return lengths;
}

function chooseCandidate(
  track: Track,
  seed: string,
  profile: TunnelProfile,
  streamLabel: string,
): { chosen: Candidate; rng: ReturnType<typeof stream> } | null {
  const finishLimit = track.finishS - profile.finishBuffer;
  const rng = stream(seed, streamLabel);
  let candidates: Candidate[] = [];

  for (const tunnelLength of candidateLengths(profile)) {
    for (const range of straightSegmentRanges(track)) {
      const first = Math.max(range.start, profile.gridBuffer);
      const last = Math.min(range.end, finishLimit) - tunnelLength;
      if (last < first) continue;

      const starts = new Set<number>([first, last, (first + last) * 0.5]);
      for (let start = first; start <= last + 1e-9; start += MINE_CANDIDATE_STEP) starts.add(start);
      for (const startS of starts) {
        const candidate = evaluateCandidate(track, startS, startS + tunnelLength, profile);
        if (candidate) candidates.push(candidate);
      }
    }
    // Prefer a real, longer set piece. Only fall back when the course
    // genuinely has no safe long straight for this profile.
    if (candidates.length > 0) break;
  }

  if (candidates.length === 0) return null;
  candidates = candidates.sort((a, b) => a.startS - b.startS);
  return { chosen: candidates[rng.int(candidates.length)], rng };
}

function buildPropExclusion(
  track: Track,
  chosen: Candidate,
  radius: number,
): PropExclusionZone {
  const points: Array<{ x: number; z: number }> = [];
  const start = Math.max(0, chosen.startS - MINE_APPROACH_LENGTH);
  const end = Math.min(track.total, chosen.endS + MINE_APPROACH_LENGTH);
  const samples = Math.max(2, Math.ceil((end - start) / 1.5));
  for (let i = 0; i <= samples; i++) {
    const s = start + ((end - start) * i) / samples;
    const p = track.table.frameAt(s).p;
    points.push({ x: p.x, z: p.z });
  }
  return { points, radius };
}

function buildSpectatorExclusion(track: Track, chosen: Candidate): SetPieceArcExclusion {
  return {
    startS: Math.max(0, chosen.startS - MINE_APPROACH_LENGTH),
    endS: Math.min(track.finishS, chosen.endS + MINE_APPROACH_LENGTH),
  };
}

function buildInteriorFrames(track: Track, chosen: Candidate, spacing: number): SetPieceFrame[] {
  const frames: SetPieceFrame[] = [];
  const count = Math.max(3, Math.floor(chosen.length / spacing));
  for (let i = 0; i < count; i++) {
    const s = chosen.startS + ((i + 1) / (count + 1)) * chosen.length;
    frames.push(frameData(s, track.table.frameAt(s)));
  }
  return frames;
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
  const selection = chooseCandidate(track, seed, MINE_PROFILE, COSMETIC.setPieces);
  if (!selection) return null;
  const { chosen, rng } = selection;
  const supports = buildInteriorFrames(track, chosen, 4);

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

  return {
    kind: 'desert-mine',
    ...chosen,
    interiorRadius: MINE_TUNNEL_INTERIOR_RADIUS,
    outerRadius: MINE_TUNNEL_OUTER_RADIUS,
    cameraEnvelopeRadius: MINE_CAMERA_ENVELOPE_RADIUS,
    propExclusion: buildPropExclusion(track, chosen, MINE_PROP_EXCLUSION_RADIUS),
    spectatorExclusion: buildSpectatorExclusion(track, chosen),
    supports,
    lamps,
  };
}

/**
 * Selects a glacier interval through the same geometric gate as the mine, then
 * describes crystalline dressing without handing renderer state to the tests.
 * Every icicle is conservatively bounded against the complete camera envelope.
 */
export function buildGlacierIceCaveLayout(
  track: Track,
  seed: string,
): GlacierIceCaveLayout | null {
  const selection = chooseCandidate(
    track,
    seed,
    ICE_CAVE_PROFILE,
    `${COSMETIC.setPieces}:glacier`,
  );
  if (!selection) return null;
  const { chosen, rng } = selection;
  const ridges = buildInteriorFrames(track, chosen, 3.6);

  const icicles: IceCaveIcicle[] = [];
  const icicleCount = Math.max(4, Math.floor(chosen.length / 2.8));
  for (let i = 0; i < icicleCount; i++) {
    const s = chosen.startS + ((i + 0.65) / (icicleCount + 0.3)) * chosen.length;
    const frame = frameData(s, track.table.frameAt(s));
    const angle = rng.range(-0.82, 0.82);
    const authoredRadial = {
      x: frame.up.x * Math.cos(angle) + frame.side.x * Math.sin(angle),
      y: frame.up.y * Math.cos(angle) + frame.side.y * Math.sin(angle),
      z: frame.up.z * Math.cos(angle) + frame.side.z * Math.sin(angle),
    };
    // Anchor to the straight authored shell, not the slightly wandering spline.
    // Projecting out the axis component makes the root radius exact and turns
    // the icicle clearance calculation below into a real geometric guarantee.
    const radial = normalise(addScaled(authoredRadial, chosen.axis, -dot(authoredRadial, chosen.axis)));
    const along = dot(subtract(frame.p, chosen.entrance.p), chosen.axis);
    const axisPoint = addScaled(chosen.entrance.p, chosen.axis, along);
    const radius = rng.range(0.12, 0.27);
    const maxLength =
      ICE_CAVE_INTERIOR_RADIUS -
      0.22 -
      ICE_CAVE_CAMERA_ENVELOPE_RADIUS -
      ICE_CAVE_ICICLE_CAMERA_MARGIN -
      radius;
    const icicleLength = rng.range(0.52, Math.max(0.53, Math.min(1.05, maxLength)));
    const root = addScaled(axisPoint, radial, ICE_CAVE_INTERIOR_RADIUS - 0.22);
    const tip = addScaled(root, radial, -icicleLength);
    const cameraClearance =
      distanceToSetPieceAxis(tip, chosen.entrance.p, chosen.axis) -
      radius -
      ICE_CAVE_CAMERA_ENVELOPE_RADIUS;
    icicles.push({
      s,
      root,
      tip,
      radius,
      length: icicleLength,
      cameraClearance,
    });
  }

  const glowColors = [0x8feaff, 0xc4f6ff, 0x80cfff] as const;
  const glows: MineLamp[] = [];
  for (let i = 0; i < ridges.length; i += 2) {
    const ridge = ridges[i];
    const side = i % 4 === 0 ? -1 : 1;
    let position = addScaled(ridge.p, ridge.up, ICE_CAVE_INTERIOR_RADIUS - 1.2);
    position = addScaled(position, ridge.side, side * 2.1);
    glows.push({
      position,
      color: glowColors[rng.int(glowColors.length)],
      intensity: rng.range(22, 34),
      distance: rng.range(13, 17),
    });
  }

  return {
    kind: 'glacier-ice-cave',
    ...chosen,
    interiorRadius: ICE_CAVE_INTERIOR_RADIUS,
    outerRadius: ICE_CAVE_OUTER_RADIUS,
    cameraEnvelopeRadius: ICE_CAVE_CAMERA_ENVELOPE_RADIUS,
    propExclusion: buildPropExclusion(track, chosen, ICE_CAVE_PROP_EXCLUSION_RADIUS),
    spectatorExclusion: buildSpectatorExclusion(track, chosen),
    ridges,
    icicles,
    glows,
  };
}

/**
 * Selects an ancient jungle passage through the shared safety gate. Weathered
 * stones and hanging vines are authored against the straight shell axis so
 * their stored radii are real camera-clearance guarantees, not renderer guesses.
 */
export function buildJungleRuinLayout(
  track: Track,
  seed: string,
): JungleRuinLayout | null {
  const selection = chooseCandidate(
    track,
    seed,
    JUNGLE_RUIN_PROFILE,
    `${COSMETIC.setPieces}:jungle`,
  );
  if (!selection) return null;
  const { chosen, rng } = selection;
  const arches = buildInteriorFrames(track, chosen, 3.8);

  const stones: JungleRuinStone[] = [];
  const stoneCount = Math.max(4, Math.floor(chosen.length / 3.8));
  for (let i = 0; i < stoneCount; i++) {
    const s = chosen.startS + ((i + 0.75) / (stoneCount + 0.5)) * chosen.length;
    const frame = frameData(s, track.table.frameAt(s));
    const angle = (i % 2 === 0 ? -1 : 1) * rng.range(0.95, 1.35);
    const authoredRadial = {
      x: frame.up.x * Math.cos(angle) + frame.side.x * Math.sin(angle),
      y: frame.up.y * Math.cos(angle) + frame.side.y * Math.sin(angle),
      z: frame.up.z * Math.cos(angle) + frame.side.z * Math.sin(angle),
    };
    const radial = normalise(addScaled(authoredRadial, chosen.axis, -dot(authoredRadial, chosen.axis)));
    const along = dot(subtract(frame.p, chosen.entrance.p), chosen.axis);
    const axisPoint = addScaled(chosen.entrance.p, chosen.axis, along);
    const radius = rng.range(0.36, 0.62);
    const position = addScaled(axisPoint, radial, JUNGLE_RUIN_INTERIOR_RADIUS - 0.34);
    const cameraClearance =
      distanceToSetPieceAxis(position, chosen.entrance.p, chosen.axis) -
      radius -
      JUNGLE_RUIN_CAMERA_ENVELOPE_RADIUS;
    stones.push({
      s,
      position,
      radius,
      rotation: {
        x: rng.range(-0.45, 0.45),
        y: rng.range(-Math.PI, Math.PI),
        z: rng.range(-0.45, 0.45),
      },
      cameraClearance,
    });
  }

  const vines: JungleRuinVine[] = [];
  const vineCount = Math.max(4, Math.floor(chosen.length / 3));
  for (let i = 0; i < vineCount; i++) {
    const s = chosen.startS + ((i + 0.55) / (vineCount + 0.1)) * chosen.length;
    const frame = frameData(s, track.table.frameAt(s));
    const angle = rng.range(-0.72, 0.72);
    const authoredRadial = {
      x: frame.up.x * Math.cos(angle) + frame.side.x * Math.sin(angle),
      y: frame.up.y * Math.cos(angle) + frame.side.y * Math.sin(angle),
      z: frame.up.z * Math.cos(angle) + frame.side.z * Math.sin(angle),
    };
    const radial = normalise(addScaled(authoredRadial, chosen.axis, -dot(authoredRadial, chosen.axis)));
    const along = dot(subtract(frame.p, chosen.entrance.p), chosen.axis);
    const axisPoint = addScaled(chosen.entrance.p, chosen.axis, along);
    const radius = rng.range(0.08, 0.14);
    const rootRadius = JUNGLE_RUIN_INTERIOR_RADIUS - 0.26;
    const maxLength =
      rootRadius -
      JUNGLE_RUIN_CAMERA_ENVELOPE_RADIUS -
      JUNGLE_RUIN_DRESSING_CAMERA_MARGIN -
      radius;
    const vineLength = rng.range(0.38, Math.max(0.39, Math.min(0.8, maxLength)));
    const root = addScaled(axisPoint, radial, rootRadius);
    const tip = addScaled(root, radial, -vineLength);
    const cameraClearance =
      distanceToSetPieceAxis(tip, chosen.entrance.p, chosen.axis) -
      radius -
      JUNGLE_RUIN_CAMERA_ENVELOPE_RADIUS;
    vines.push({ s, root, tip, radius, length: vineLength, cameraClearance });
  }

  const glyphColors = [0xffc768, 0xb9dc75, 0x7fd59a] as const;
  const glyphs: MineLamp[] = [];
  for (let i = 0; i < arches.length; i += 2) {
    const arch = arches[i];
    const side = i % 4 === 0 ? -1 : 1;
    let position = addScaled(arch.p, arch.up, JUNGLE_RUIN_INTERIOR_RADIUS - 1.05);
    position = addScaled(position, arch.side, side * 2.25);
    glyphs.push({
      position,
      color: glyphColors[rng.int(glyphColors.length)],
      intensity: rng.range(18, 28),
      distance: rng.range(12, 16),
    });
  }

  return {
    kind: 'jungle-ruin',
    ...chosen,
    interiorRadius: JUNGLE_RUIN_INTERIOR_RADIUS,
    outerRadius: JUNGLE_RUIN_OUTER_RADIUS,
    cameraEnvelopeRadius: JUNGLE_RUIN_CAMERA_ENVELOPE_RADIUS,
    propExclusion: buildPropExclusion(track, chosen, JUNGLE_RUIN_PROP_EXCLUSION_RADIUS),
    spectatorExclusion: buildSpectatorExclusion(track, chosen),
    arches,
    stones,
    vines,
    glyphs,
  };
}
