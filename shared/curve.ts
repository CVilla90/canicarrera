/**
 * Centripetal Catmull-Rom spline + arc-length parameterisation.
 *
 * The renderer builds the visible tube from this exact curve (see
 * `client/scene/SharedCurve.ts`), so the geometry a viewer sees and the geometry
 * the marbles roll on cannot drift apart.
 *
 * Centripetal (alpha = 0.5) rather than uniform: uniform Catmull-Rom overshoots
 * into cusps when control points are unevenly spaced, which on a race track
 * looks like the tube briefly turning inside out. Centripetal provably cannot.
 *
 * Written allocation-free in the hot path — the curator builds ~20 of these per
 * request on a 1 vCPU box.
 */
import { Vec3, DOWN, clamp } from './vec3.ts';

const ALPHA = 0.5;

/**
 * Arc-table resolution. THIS IS PART OF THE PHYSICS CONTRACT: the sim reads
 * slope from this table, so changing it changes race outcomes. Same value for
 * curation and for playback, always. Bump SIM_VERSION if you touch it.
 */
export const ARC_SAMPLES = 2000;

export class Spline {
  readonly points: Vec3[];

  constructor(points: Vec3[]) {
    if (points.length < 2) throw new Error('Spline needs at least 2 control points');
    this.points = points;
  }

  /** t in [0, 1] over the whole spline. */
  getPoint(t: number, out = new Vec3()): Vec3 {
    const pts = this.points;
    const last = pts.length - 1;
    const scaled = clamp(t, 0, 1) * last;
    let i = Math.floor(scaled);
    if (i >= last) i = last - 1;
    const u = scaled - i;

    const p1 = pts[i];
    const p2 = pts[i + 1];
    // Phantom end points, extrapolated so the curve reaches its first and last
    // control point with a sane tangent.
    const p0x = i > 0 ? pts[i - 1].x : 2 * p1.x - p2.x;
    const p0y = i > 0 ? pts[i - 1].y : 2 * p1.y - p2.y;
    const p0z = i > 0 ? pts[i - 1].z : 2 * p1.z - p2.z;
    const hasNext = i + 2 <= last;
    const p3x = hasNext ? pts[i + 2].x : 2 * p2.x - p1.x;
    const p3y = hasNext ? pts[i + 2].y : 2 * p2.y - p1.y;
    const p3z = hasNext ? pts[i + 2].z : 2 * p2.z - p1.z;

    return barryGoldman(p0x, p0y, p0z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3x, p3y, p3z, u, out);
  }

  /** Unit tangent at t, by central difference. */
  getTangent(t: number, out = new Vec3()): Vec3 {
    const h = 1e-4;
    const a = this.getPoint(clamp(t - h, 0, 1), scratchA);
    const ax = a.x;
    const ay = a.y;
    const az = a.z;
    const b = this.getPoint(clamp(t + h, 0, 1), scratchB);
    return out.set(b.x - ax, b.y - ay, b.z - az).normalize();
  }
}

const scratchA = new Vec3();
const scratchB = new Vec3();

/**
 * Barry-Goldman pyramidal evaluation of one Catmull-Rom segment p1 -> p2.
 * Scalar maths on purpose: this runs ~2000 times per track, ~20 tracks per
 * request, and every allocation here is a GC pause on a shared vCPU.
 */
function barryGoldman(
  p0x: number, p0y: number, p0z: number,
  p1x: number, p1y: number, p1z: number,
  p2x: number, p2y: number, p2z: number,
  p3x: number, p3y: number, p3z: number,
  u: number,
  out: Vec3,
): Vec3 {
  const t0 = 0;
  const t1 = t0 + knot(p0x - p1x, p0y - p1y, p0z - p1z);
  const t2 = t1 + knot(p1x - p2x, p1y - p2y, p1z - p2z);
  const t3 = t2 + knot(p2x - p3x, p2y - p3y, p2z - p3z);
  const t = t1 + (t2 - t1) * u;

  const w01 = (t1 - t) / (t1 - t0);
  const w01b = (t - t0) / (t1 - t0);
  const w12 = (t2 - t) / (t2 - t1);
  const w12b = (t - t1) / (t2 - t1);
  const w23 = (t3 - t) / (t3 - t2);
  const w23b = (t - t2) / (t3 - t2);

  const a1x = p0x * w01 + p1x * w01b;
  const a1y = p0y * w01 + p1y * w01b;
  const a1z = p0z * w01 + p1z * w01b;
  const a2x = p1x * w12 + p2x * w12b;
  const a2y = p1y * w12 + p2y * w12b;
  const a2z = p1z * w12 + p2z * w12b;
  const a3x = p2x * w23 + p3x * w23b;
  const a3y = p2y * w23 + p3y * w23b;
  const a3z = p2z * w23 + p3z * w23b;

  const w02 = (t2 - t) / (t2 - t0);
  const w02b = (t - t0) / (t2 - t0);
  const w13 = (t3 - t) / (t3 - t1);
  const w13b = (t - t1) / (t3 - t1);

  const b1x = a1x * w02 + a2x * w02b;
  const b1y = a1y * w02 + a2y * w02b;
  const b1z = a1z * w02 + a2z * w02b;
  const b2x = a2x * w13 + a3x * w13b;
  const b2y = a2y * w13 + a3y * w13b;
  const b2z = a2z * w13 + a3z * w13b;

  return out.set(b1x * w12 + b2x * w12b, b1y * w12 + b2y * w12b, b1z * w12 + b2z * w12b);
}

function knot(dx: number, dy: number, dz: number): number {
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  // Guard against coincident control points, which would divide by zero.
  return Math.max(Math.pow(d, ALPHA), 1e-4);
}

/** A local reference frame on the track at some arc length. */
export interface TrackFrame {
  /** Centre of the tube. */
  p: Vec3;
  /** Unit tangent, pointing downhill along the race direction. */
  t: Vec3;
  /** Unit "down" inside the tube — where a marble rests. Perpendicular to t. */
  d: Vec3;
  /** Unit lateral axis, t x d. */
  side: Vec3;
}

/**
 * Arc-length lookup table over a spline. Everything downstream — the sim, the
 * camera, the rings — asks questions in metres, never in spline-t.
 */
export class ArcTable {
  readonly spline: Spline;
  readonly pos: Vec3[] = [];
  readonly tan: Vec3[] = [];
  readonly cum: Float64Array;
  readonly total: number;
  readonly samples: number;

  constructor(spline: Spline, samples = ARC_SAMPLES) {
    this.spline = spline;
    this.samples = samples;
    const cum = new Float64Array(samples + 1);
    for (let i = 0; i <= samples; i++) {
      const p = spline.getPoint(i / samples);
      this.pos.push(p);
      if (i > 0) cum[i] = cum[i - 1] + p.distanceTo(this.pos[i - 1]);
    }
    // Tangents by central difference on the samples we already have — three
    // times cheaper than asking the spline, and consistent with the cumulative
    // lengths, which is what the sim actually integrates against.
    for (let i = 0; i <= samples; i++) {
      const a = this.pos[Math.max(i - 1, 0)];
      const b = this.pos[Math.min(i + 1, samples)];
      this.tan.push(new Vec3(b.x - a.x, b.y - a.y, b.z - a.z).normalize());
    }
    this.cum = cum;
    this.total = cum[samples];
  }

  /** Index of the sample at or before arc length s. */
  private indexAt(s: number): number {
    let lo = 0;
    let hi = this.samples;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /** Position + tangent at arc length s, linearly interpolated between samples. */
  at(s: number, outP = new Vec3(), outT = new Vec3()): void {
    const clamped = clamp(s, 0, this.total);
    const i = this.indexAt(clamped);
    const j = Math.min(i + 1, this.samples);
    const span = this.cum[j] - this.cum[i] || 1e-9;
    const f = (clamped - this.cum[i]) / span;
    outP.lerpVectors(this.pos[i], this.pos[j], f);
    outT.lerpVectors(this.tan[i], this.tan[j], f).normalize();
  }

  /** Just the tangent's vertical component — the only thing the sim needs per step. */
  slopeAt(s: number): number {
    const clamped = clamp(s, 0, this.total);
    const i = this.indexAt(clamped);
    const j = Math.min(i + 1, this.samples);
    const span = this.cum[j] - this.cum[i] || 1e-9;
    const f = (clamped - this.cum[i]) / span;
    const a = this.tan[i];
    const b = this.tan[j];
    // Interpolate then normalise, matching `at()` exactly.
    const x = a.x + (b.x - a.x) * f;
    const y = a.y + (b.y - a.y) * f;
    const z = a.z + (b.z - a.z) * f;
    const len = Math.sqrt(x * x + y * y + z * z);
    return len > 1e-12 ? y / len : 0;
  }

  /** Spline parameter t for arc length s — needed to place geometry on the curve. */
  tAt(s: number): number {
    const clamped = clamp(s, 0, this.total);
    const i = this.indexAt(clamped);
    const j = Math.min(i + 1, this.samples);
    const span = this.cum[j] - this.cum[i] || 1e-9;
    const f = (clamped - this.cum[i]) / span;
    return (i + f) / this.samples;
  }

  /** Full local frame at arc length s. */
  frameAt(s: number, out?: TrackFrame): TrackFrame {
    const frame = out ?? { p: new Vec3(), t: new Vec3(), d: new Vec3(), side: new Vec3() };
    this.at(s, frame.p, frame.t);
    // "Down" is gravity's direction projected onto the plane perpendicular to t.
    const t = frame.t;
    const dot = DOWN.dot(t);
    frame.d.set(DOWN.x - t.x * dot, DOWN.y - t.y * dot, DOWN.z - t.z * dot);
    if (frame.d.lengthSq() < 1e-8) frame.d.set(0, -1, 0);
    else frame.d.normalize();
    frame.side.copy(t).cross(frame.d).normalize();
    return frame;
  }
}
