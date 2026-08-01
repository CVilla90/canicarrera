/**
 * The export cost model. Pure arithmetic, no DOM, no three.js, no WebCodecs.
 *
 * It lives on its own for two reasons. The obvious one is that `npm test` can
 * import it in node, and the ETA printed on the export button is a promise —
 * the last time it was wrong it was wrong by 15x, and nothing in the test suite
 * would have caught that. The second is that the *planner* and the *panel* both
 * need it, and routing the planner through `capabilities.ts` would drag the
 * whole encoder into a module that only wants to multiply four numbers.
 *
 * ## The model
 *
 * A frame costs a draw plus an encode, and the two scale differently:
 *
 *     seconds = frames * (drawSeconds * pixels * drawCost + encodeSeconds * pixels)
 *
 * `drawCost` carries supersampling and motion blur. Both multiply the DRAW and
 * neither touches the ENCODE, because however many sub-frames were averaged to
 * produce it, the encoder still receives exactly one frame per output frame.
 * Charging preset cost to the whole pipeline would badly over-estimate Ultra on
 * a machine with a slow software encoder — which is precisely the machine whose
 * user most needs the number to be right.
 */

export interface Throughput {
  /** Draw-only frames per second at the reference resolution and baseline preset. */
  rasterFps: number;
  /** Draw + encode + mux frames per second, same reference. */
  pipelineFps: number;
}

/**
 * Seconds for one frame.
 *
 * `pixels` is the resolution relative to the reference (1 at 1080p), `drawCost`
 * the preset's multiplier on the draw alone.
 */
export function frameSeconds(
  throughput: Throughput,
  pixels: number,
  drawCost: number,
): number | null {
  const { rasterFps, pipelineFps } = throughput;
  if (!(rasterFps > 0) || !(pipelineFps > 0)) return null;

  const draw = 1 / rasterFps;
  const pipeline = 1 / pipelineFps;
  // Clamped at zero: where the encoder runs fully parallel to the draw, the
  // measured pipeline can come out a hair faster than the raster loop, and a
  // negative encode cost would make 4K come out cheaper than 1080p.
  const encode = Math.max(0, pipeline - draw);

  return draw * pixels * drawCost + encode * pixels;
}

/** Seconds for a whole export. Null when there is no usable measurement. */
export function exportSeconds(
  throughput: Throughput | null,
  pixels: number,
  drawCost: number,
  frames: number,
): number | null {
  if (!throughput) return null;
  const per = frameSeconds(throughput, pixels, drawCost);
  return per === null ? null : per * frames;
}
