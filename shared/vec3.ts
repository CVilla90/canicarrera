/**
 * Minimal 3-D vector maths.
 *
 * This exists instead of `THREE.Vector3` on purpose: `shared/` must run in Node
 * (the curator simulates ~20 races per request) and in whatever renders frames
 * later. Pulling three.js in here would drag a renderer into the simulator.
 *
 * Only `+ - * / sqrt` are used, which IEEE-754 guarantees bit-identically
 * across engines — see PLAN.md §3.4.
 */
export class Vec3 {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
  ) {}

  static of(x: number, y: number, z: number): Vec3 {
    return new Vec3(x, y, z);
  }

  clone(): Vec3 {
    return new Vec3(this.x, this.y, this.z);
  }

  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  copy(v: Vec3): this {
    return this.set(v.x, v.y, v.z);
  }

  add(v: Vec3): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  sub(v: Vec3): this {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }

  scale(k: number): this {
    this.x *= k;
    this.y *= k;
    this.z *= k;
    return this;
  }

  addScaled(v: Vec3, k: number): this {
    this.x += v.x * k;
    this.y += v.y * k;
    this.z += v.z * k;
    return this;
  }

  dot(v: Vec3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  cross(v: Vec3): this {
    const { x, y, z } = this;
    this.x = y * v.z - z * v.y;
    this.y = z * v.x - x * v.z;
    this.z = x * v.y - y * v.x;
    return this;
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  length(): number {
    return Math.sqrt(this.lengthSq());
  }

  normalize(): this {
    const len = this.length();
    return len > 1e-12 ? this.scale(1 / len) : this.set(0, 0, 0);
  }

  distanceTo(v: Vec3): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  lerpVectors(a: Vec3, b: Vec3, t: number): this {
    return this.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
  }

  toArray(): [number, number, number] {
    return [this.x, this.y, this.z];
  }
}

export const UP = Object.freeze(new Vec3(0, 1, 0));
export const DOWN = Object.freeze(new Vec3(0, -1, 0));

export const clamp = (x: number, lo: number, hi: number): number =>
  x < lo ? lo : x > hi ? hi : x;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Maps x from [inLo, inHi] to [outLo, outHi], clamped at both ends. */
export const remap = (
  x: number,
  inLo: number,
  inHi: number,
  outLo: number,
  outHi: number,
): number => {
  const t = clamp((x - inLo) / (inHi - inLo || 1e-9), 0, 1);
  return outLo + (outHi - outLo) * t;
};
