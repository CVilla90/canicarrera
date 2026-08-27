/**
 * Yielding to the event loop without being throttled.
 *
 * `setTimeout(fn, 0)` looks like the obvious way to let the browser breathe
 * between chunks of work. It is a trap in exactly the situation this app cares
 * about:
 *
 *   - Nested `setTimeout` calls are clamped to **4 ms** after a few levels.
 *   - In a **background tab** the clamp becomes **one second**. A loop that
 *     yields three thousand times then takes fifty minutes.
 *
 * An export is precisely the thing a user starts and then switches away from, so
 * a background tab is the normal case, not the edge case. `MessageChannel` is
 * not throttled: a message posted to the other port is delivered on the next
 * turn of the event loop whether the tab is visible or not.
 *
 * This was learned twice. The video loop got it right from the start; the audio
 * encoder was written with `setTimeout` and hung a hidden-tab export in the
 * `audio` phase for over a minute before finishing. One helper, both callers.
 */
export function makeYield(): () => Promise<void> {
  if (typeof MessageChannel === 'undefined') {
    return () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  const channel = new MessageChannel();
  let resolveNext: (() => void) | null = null;
  channel.port1.onmessage = () => {
    const resolve = resolveNext;
    resolveNext = null;
    resolve?.();
  };
  return () =>
    new Promise<void>((resolve) => {
      resolveNext = resolve;
      channel.port2.postMessage(null);
    });
}
