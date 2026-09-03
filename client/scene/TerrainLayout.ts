/**
 * Deterministic, renderer-free terrain shaping for surface worlds.
 *
 * Terrain is ordinary scenery: it may approach the course, but it may never
 * cover the chute, marbles, or chase-camera corridor. Intentional crossings
 * belong to SetPieceLayout, where portals, interior clearance, and lighting
 * are explicit.
 */
import type { Track } from '@shared/track.ts';

export const TERRAIN_SEGMENTS = 64;
export const TERRAIN_TRACK_CORRIDOR = 7.5;
export const TERRAIN_VERTICAL_CLEARANCE = 5.5;
export const TERRAIN_SPINE_SPACING = 1.25;

const TERRAIN_DEPTH = 11;
const TERRAIN_HORIZON_DROP = 6;

interface TerrainSpinePoint {
  x: number;
  y: number;
  z: number;
}

export interface TerrainHeightfield {
  centre: TerrainSpinePoint;
  reach: number;
  size: number;
  segments: number;
  cellSize: number;
  /** Complete world-space terrain height, including relief and clearance. */
  heightAt: (x: number, z: number) => number;
}

/**
 * Builds the exact height function consumed by the Three.js terrain mesh.
 *
 * The clearance search is deliberately wider than the visible corridor by a
 * complete grid-cell diagonal. Therefore all corners of the triangle beneath
 * any track point are clamped, not just a theoretical height sample at the
 * centreline. Selecting the lowest nearby spine sample also keeps a folded or
 * overlapping lower branch from being buried beneath terrain shaped for the
 * higher branch.
 */
export function buildTerrainHeightfield(
  track: Track,
  reliefScale: number,
  segments = TERRAIN_SEGMENTS,
): TerrainHeightfield {
  const centreFrame = track.table.frameAt(track.total * 0.5).p;
  const centre = { x: centreFrame.x, y: centreFrame.y, z: centreFrame.z };

  const sampleCount = Math.max(1, Math.ceil(track.total / TERRAIN_SPINE_SPACING));
  const spine: TerrainSpinePoint[] = [];
  let lowest = Infinity;
  let courseReach = 0;
  for (let i = 0; i <= sampleCount; i++) {
    const p = track.table.frameAt((i / sampleCount) * track.total).p;
    spine.push({ x: p.x, y: p.y, z: p.z });
    lowest = Math.min(lowest, p.y);
    courseReach = Math.max(courseReach, Math.hypot(p.x - centre.x, p.z - centre.z));
  }

  const reach = courseReach + 90;
  const size = reach * 4;
  const safeSegments = Math.max(1, Math.floor(segments));
  const cellSize = size / safeSegments;
  const gridCellDiagonal = cellSize * Math.SQRT2;
  const carveRadius = TERRAIN_TRACK_CORRIDOR + gridCellDiagonal + TERRAIN_SPINE_SPACING;
  const carveRadiusSquared = carveRadius * carveRadius;
  // A spine sample may sit this much higher than the exact point between
  // samples. Subtracting the spacing retains the promised clearance there.
  const clearanceBelowSample = TERRAIN_VERTICAL_CLEARANCE + TERRAIN_SPINE_SPACING;

  const heightAt = (x: number, z: number): number => {
    let nearestDistanceSquared = Infinity;
    let nearestY = lowest;
    let clearanceCeiling = Infinity;

    for (const point of spine) {
      const dx = point.x - x;
      const dz = point.z - z;
      const distanceSquared = dx * dx + dz * dz;
      if (distanceSquared < nearestDistanceSquared) {
        nearestDistanceSquared = distanceSquared;
        nearestY = point.y;
      }
      if (distanceSquared <= carveRadiusSquared) {
        clearanceCeiling = Math.min(clearanceCeiling, point.y - clearanceBelowSample);
      }
    }

    const distance = Math.sqrt(nearestDistanceSquared);
    const blend = Math.min(1, distance / 140);
    const trackFollowing =
      (nearestY - TERRAIN_DEPTH) * (1 - blend) +
      (lowest - TERRAIN_DEPTH - TERRAIN_HORIZON_DROP) * blend;
    const relief =
      (Math.sin(x * 0.031) * 0.6 +
        Math.sin(z * 0.027) * 0.5 +
        Math.sin((x + z) * 0.013) * 0.7) *
      reliefScale;

    return Math.min(trackFollowing + relief, clearanceCeiling);
  };

  return {
    centre,
    reach,
    size,
    segments: safeSegments,
    cellSize,
    heightAt,
  };
}
