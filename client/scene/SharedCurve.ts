import { Curve, Vector3 } from 'three';
import type { Spline } from '@shared/curve.ts';
import { Vec3 } from '@shared/vec3.ts';

const scratch = new Vec3();

/**
 * Adapts the simulator's spline to three.js.
 *
 * This exists so `TubeGeometry` is built from the exact curve the marbles roll
 * along. Rebuilding "the same" curve with `THREE.CatmullRomCurve3` would look
 * right and be subtly wrong — the tube would drift a few centimetres from the
 * physics, which shows up as marbles clipping the glass on tight bends.
 */
export class SharedCurve extends Curve<Vector3> {
  constructor(private readonly spline: Spline) {
    super();
  }

  override getPoint(t: number, target = new Vector3()): Vector3 {
    const p = this.spline.getPoint(t, scratch);
    return target.set(p.x, p.y, p.z);
  }
}
