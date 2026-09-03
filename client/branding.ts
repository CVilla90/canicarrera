/**
 * Copy rendered inside the Three.js scene and therefore into exported videos.
 *
 * Keep this deliberately small and boring: changing the public name, credit,
 * or destination later should be a one-file edit rather than a hunt through
 * canvas drawing and renderer code.
 */
export const VIDEO_ATTRIBUTION = {
  billboardTitle: 'Rolling Rivals',
  brand: 'CANICARRERA',
  credit: 'Rolling Rivals',
  url: 'github.com/CVilla90/canicarrera',
} as const;
