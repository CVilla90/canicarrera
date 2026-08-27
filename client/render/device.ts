/**
 * What this device can be trusted with, in bytes.
 *
 * ## Why this file exists
 *
 * A tester on an iPhone reported the page "getting stuck" and "restarting".
 * Both symptoms have the same cause and it is not a bug in any one function —
 * it is that nothing in the render path had a memory budget.
 *
 *   - **"Stuck"** is a lost WebGL context. iOS Safari drops the context when the
 *     system is short of GPU memory, and the canvas then holds its last frame
 *     forever. Handled in `RaceScene` (`webglcontextlost`); this file exists so
 *     it happens less often.
 *   - **"Restarting"** is the tab being reloaded. Safari kills and reloads a tab
 *     that grows past roughly a gigabyte, and the page comes back at the start
 *     of a new race — which is exactly what a user would describe as restarting.
 *
 * The arithmetic that got us there: `PostFX` allocates six half-float render
 * targets. At 1080p with 2x supersampling the scene buffer and the accumulator
 * are each 3840x2160 RGBA16F — **63 MiB apiece**, 127 MiB for the pair, and
 * **166 MiB once the bloom chain is counted** — on top of the drawing buffer,
 * the environment cubemap and whatever the encoder is holding. At 4K that same
 * preset asks for 664 MiB. `PostFX.isSupported` only ever checked for the
 * *extension*, never for whether there was room. On a desktop that is fine. On a
 * phone the preset probe alone would allocate all of it at boot, before the user
 * had watched a single race.
 *
 * Everything here is a **budget**, not a device test. No user-agent sniffing:
 * `deviceMemory` where it exists, screen size and touch as a fallback, and a
 * conservative default when nothing is knowable. The worst case of being wrong
 * is a slightly softer image, which is a far better failure than a reload.
 */

/** Bytes per pixel in an RGBA16F render target. */
const HALF_FLOAT_BPP = 8;

/**
 * How much the bloom chain adds on top of the two full-size buffers.
 *
 * Half-resolution is a quarter of the area, quarter-resolution a sixteenth, and
 * there are two targets at each level: 2*(1/4) + 2*(1/16) = 0.625.
 */
const BLOOM_OVERHEAD = 0.625;

export interface DeviceProfile {
  /**
   * Bytes `PostFX` may spend on render targets.
   *
   * Not the device's total memory — the slice this one subsystem is allowed,
   * leaving room for the drawing buffer, three.js geometry, the encoder queue
   * and the page itself.
   */
  postFXBudget: number;
  /**
   * Ceiling on `devicePixelRatio`.
   *
   * A modern iPhone reports 3. Rendering a full-screen WebGL canvas at 3x on a
   * phone costs nine times the pixels of 1x for a difference nobody can see at
   * arm's length, and `preserveDrawingBuffer` means we pay for that buffer
   * twice.
   */
  maxPixelRatio: number;
  /**
   * Resolution the capability probe measures at.
   *
   * The probe used to benchmark every preset at 1080p, which on a phone meant
   * allocating the full 4K supersampled chain during boot — the most expensive
   * thing the app ever does, done before the first race is even watched. Phones
   * measure at 720p and the cost model normalises the result.
   */
  benchmarkQualityId: string;
  /** True when we believe this is a phone or tablet. Used for defaults, never gates. */
  constrained: boolean;
}

const DESKTOP: DeviceProfile = {
  // 768 MiB, chosen against the real numbers rather than picked as a round
  // one: 4K at 2x supersampling needs 664 MiB, and this guard exists to stop a
  // PHONE reloading, not to quietly downgrade a workstation that asked for
  // Ultra. At 512 MiB the top rung of the ladder would have been clamped on
  // every desktop without anyone being told.
  postFXBudget: 768 * 1024 * 1024,
  maxPixelRatio: 2,
  benchmarkQualityId: '1080p30',
  constrained: false,
};

const MOBILE: DeviceProfile = {
  postFXBudget: 96 * 1024 * 1024,
  maxPixelRatio: 2,
  benchmarkQualityId: '720p30',
  constrained: true,
};

/** Phones with very little to spare. Still fully functional, just modest. */
const SMALL: DeviceProfile = {
  postFXBudget: 48 * 1024 * 1024,
  maxPixelRatio: 1.5,
  benchmarkQualityId: '720p30',
  constrained: true,
};

/**
 * Best guess at what this machine can afford.
 *
 * Read once and cached: the answer cannot change during a session, and every
 * caller asking `matchMedia` again would be pure noise.
 */
let cached: DeviceProfile | null = null;

export function deviceProfile(): DeviceProfile {
  if (cached) return cached;
  cached = detect();
  return cached;
}

function detect(): DeviceProfile {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return DESKTOP;

  // `deviceMemory` is the only direct signal, and it is Chromium-only — Safari,
  // the browser this exists for, never reports it. So it can lower the verdict
  // but is never the whole verdict.
  const memory = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  if (typeof memory === 'number' && memory > 0 && memory <= 2) return SMALL;

  // Touch plus no hover is the honest definition of a phone or tablet: it
  // describes the input, which is what we can actually observe, rather than
  // trying to recognise a device from a string it is free to lie about.
  const coarse =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: none) and (pointer: coarse)').matches;

  if (!coarse) {
    if (typeof memory === 'number' && memory > 0 && memory <= 4) return MOBILE;
    return DESKTOP;
  }

  // A small phone screen is the case that actually bites — an iPhone SE has
  // both the least memory and the highest pixel ratio relative to its size.
  const shortSide = Math.min(window.screen?.width ?? 0, window.screen?.height ?? 0);
  if (shortSide > 0 && shortSide <= 400) return SMALL;
  return MOBILE;
}

/** Bytes `PostFX` needs at this output size and supersample factor. */
export function postFXBytes(width: number, height: number, supersample: number): number {
  const pixels = width * supersample * height * supersample;
  // Two full-size targets (scene + accumulator) plus the bloom chain.
  return pixels * HALF_FLOAT_BPP * (2 + BLOOM_OVERHEAD);
}

/**
 * The largest supersample factor that fits the budget at this size.
 *
 * Rounded DOWN to a whole number and never below 1, because a fractional
 * supersample is not a thing and refusing to render is not an option. This is
 * the function that turns "Alto at 1080p on a phone" from a tab reload into a
 * slightly softer picture — the user still gets their video.
 */
export function affordableSupersample(
  width: number,
  height: number,
  wanted: number,
  budget: number = deviceProfile().postFXBudget,
): number {
  let factor = Math.max(1, Math.floor(wanted));
  while (factor > 1 && postFXBytes(width, height, factor) > budget) factor--;
  return factor;
}

/**
 * Can this device run the post pipeline at all at this size?
 *
 * Separate from `PostFX.isSupported`, which answers a different question — that
 * one is about the GPU's *capability*, this one about its *capacity*. Both have
 * to be true, and only one of them used to be checked.
 */
export function canAffordPostFX(
  width: number,
  height: number,
  budget: number = deviceProfile().postFXBudget,
): boolean {
  return postFXBytes(width, height, 1) <= budget;
}
