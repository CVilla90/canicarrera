/**
 * Track geometry: a list of named segments -> control points -> spline ->
 * arc-length table.
 *
 * Segments are the unit of design, not raw control points. A spec that says
 * "spiral, 2.5 turns, radius 7, drop 11" is compact enough for a URL, readable
 * by a human, editable by a future track editor, and — the point — a stable
 * contract: as long as the builders below keep their meaning, a race shared
 * today replays identically forever.
 */
import { Spline, ArcTable, ARC_SAMPLES } from './curve.ts';
import { Vec3 } from './vec3.ts';
import type { Segment, TrackSpec } from './spec.ts';

export interface Landmark {
  /** Arc length where this segment begins, metres. */
  s: number;
  kind: Segment['k'];
}

export interface Track {
  spec: TrackSpec;
  spline: Spline;
  table: ArcTable;
  /** Total tube length, metres. */
  total: number;
  /** Arc length of the finish line. */
  finishS: number;
  controlPoints: Vec3[];
  landmarks: Landmark[];
  tubeRadius: number;
}

interface Cursor {
  pos: Vec3;
  heading: number;
}

const fwdX = (h: number) => Math.cos(h);
const fwdZ = (h: number) => Math.sin(h);
/** 90 degrees to the left of the heading. */
const leftX = (h: number) => -Math.sin(h);
const leftZ = (h: number) => Math.cos(h);

/**
 * Appends one segment's control points to `out`, advancing the cursor.
 * Pure and side-effect-free apart from those two — no randomness lives here,
 * which is what makes a spec replayable without the generator.
 */
function buildSegment(seg: Segment, cur: Cursor, out: Vec3[]): void {
  switch (seg.k) {
    case 'ramp':
    case 'runout': {
      const n = Math.max(1, Math.round(seg.len / 8));
      emitStraight(cur, out, seg.len, seg.drop, n);
      break;
    }
    case 'plunge': {
      // Finer subdivision: a steep segment with few control points reads as a
      // crease rather than a dive.
      const n = Math.max(2, Math.round(seg.len / 5));
      emitStraight(cur, out, seg.len, seg.drop, n);
      break;
    }
    case 'sweep': {
      emitArc(cur, out, seg.len / Math.max(Math.abs(seg.turn), 1e-3), seg.turn, seg.drop);
      break;
    }
    case 'hairpin': {
      emitArc(cur, out, seg.radius, seg.dir * Math.PI, seg.drop);
      break;
    }
    case 'chicane': {
      const n = Math.max(6, Math.round(seg.len / 4));
      const h = cur.heading;
      const baseX = cur.pos.x;
      const baseY = cur.pos.y;
      const baseZ = cur.pos.z;
      for (let i = 1; i <= n; i++) {
        const u = i / n;
        const lateral = seg.swing * Math.sin(2 * Math.PI * seg.beats * u);
        cur.pos.set(
          baseX + fwdX(h) * seg.len * u + leftX(h) * lateral,
          baseY - seg.drop * u,
          baseZ + fwdZ(h) * seg.len * u + leftZ(h) * lateral,
        );
        out.push(cur.pos.clone());
      }
      // `beats` is an integer, so the swing returns to the centre line and the
      // heading is unchanged.
      break;
    }
    case 'roller': {
      const n = Math.max(8, Math.round(seg.len / 3));
      const h = cur.heading;
      const baseX = cur.pos.x;
      const baseY = cur.pos.y;
      const baseZ = cur.pos.z;
      // Cap the ripple so the floor never actually tilts uphill: a marble that
      // stalls on a roller is a broken race, not a dramatic one.
      const maxAmp = (0.9 * seg.drop) / (2 * Math.PI * seg.waves);
      const amp = Math.min(seg.amp, maxAmp);
      for (let i = 1; i <= n; i++) {
        const u = i / n;
        const ripple = amp * Math.sin(2 * Math.PI * seg.waves * u);
        cur.pos.set(
          baseX + fwdX(h) * seg.len * u,
          baseY - seg.drop * u + ripple,
          baseZ + fwdZ(h) * seg.len * u,
        );
        out.push(cur.pos.clone());
      }
      break;
    }
    case 'spiral': {
      const cx = cur.pos.x + leftX(cur.heading) * seg.dir * seg.radius;
      const cz = cur.pos.z + leftZ(cur.heading) * seg.dir * seg.radius;
      const startAngle = Math.atan2(cur.pos.z - cz, cur.pos.x - cx);
      const sweep = seg.dir * seg.turns * Math.PI * 2;
      const n = Math.max(8, Math.ceil(Math.abs(sweep) / 0.28));
      const baseY = cur.pos.y;
      for (let i = 1; i <= n; i++) {
        const u = i / n;
        const ang = startAngle + sweep * u;
        cur.pos.set(
          cx + Math.cos(ang) * seg.radius,
          baseY - seg.drop * u,
          cz + Math.sin(ang) * seg.radius,
        );
        out.push(cur.pos.clone());
      }
      cur.heading = startAngle + sweep + (seg.dir * Math.PI) / 2;
      break;
    }
  }
}

function emitStraight(cur: Cursor, out: Vec3[], len: number, drop: number, n: number): void {
  const h = cur.heading;
  for (let i = 0; i < n; i++) {
    cur.pos.set(
      cur.pos.x + (fwdX(h) * len) / n,
      cur.pos.y - drop / n,
      cur.pos.z + (fwdZ(h) * len) / n,
    );
    out.push(cur.pos.clone());
  }
}

/** `turn` is signed total heading change; positive turns left. */
function emitArc(cur: Cursor, out: Vec3[], radius: number, turn: number, drop: number): void {
  const n = Math.max(4, Math.ceil(Math.abs(turn) / 0.26));
  const dir = turn >= 0 ? 1 : -1;
  const cx = cur.pos.x + leftX(cur.heading) * dir * radius;
  const cz = cur.pos.z + leftZ(cur.heading) * dir * radius;
  const startAngle = Math.atan2(cur.pos.z - cz, cur.pos.x - cx);
  const baseY = cur.pos.y;
  for (let i = 1; i <= n; i++) {
    const u = i / n;
    const ang = startAngle + turn * u;
    cur.pos.set(cx + Math.cos(ang) * radius, baseY - drop * u, cz + Math.sin(ang) * radius);
    out.push(cur.pos.clone());
  }
  cur.heading = startAngle + turn + (dir * Math.PI) / 2;
}

/** Turns a track spec into geometry. Deterministic; no RNG. */
export function buildTrack(spec: TrackSpec, samples = ARC_SAMPLES): Track {
  const cur: Cursor = { pos: new Vec3(0, 0, 0), heading: spec.heading };
  const points: Vec3[] = [cur.pos.clone()];
  const boundaries: number[] = [];

  for (const seg of spec.segments) {
    boundaries.push(points.length - 1);
    buildSegment(seg, cur, points);
  }

  const spline = new Spline(points);
  const table = new ArcTable(spline, samples);

  // Control point index -> arc length, so the HUD can name the section the
  // leader is in.
  const lastIndex = points.length - 1;
  const landmarks: Landmark[] = spec.segments.map((seg, i) => ({
    s: table.cum[Math.round((boundaries[i] / lastIndex) * samples)],
    kind: seg.k,
  }));

  return {
    spec,
    spline,
    table,
    total: table.total,
    finishS: Math.max(table.total - spec.finishOffset, 1),
    controlPoints: points,
    landmarks,
    tubeRadius: spec.tubeRadius,
  };
}

/**
 * Does the tube pass through itself?
 *
 * The track always descends, so distant sections usually clear each other on
 * height alone — but a tight spiral with too little drop per turn will fold into
 * itself, and that reads as a bug to anyone watching. Checked coarsely (every
 * ~2 m) because it runs on every curation candidate.
 */
export function selfIntersects(track: Track): boolean {
  const step = 2;
  const table = track.table;
  const count = Math.floor(table.total / step);
  if (count < 4) return false;
  const clearance = track.tubeRadius * 2 + 0.3;
  const minArcGap = 14;

  const pts: Vec3[] = [];
  const p = new Vec3();
  const t = new Vec3();
  for (let i = 0; i <= count; i++) {
    table.at(i * step, p, t);
    pts.push(p.clone());
  }

  const skip = Math.ceil(minArcGap / step);
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + skip; j < pts.length; j++) {
      if (pts[i].distanceTo(pts[j]) < clearance) return true;
    }
  }
  return false;
}
