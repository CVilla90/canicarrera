# Current work checkpoint

**Date:** 2026-08-27
**Objective:** Preserve the completed mobile/audio/scenery work, then build the
first intentional set-piece vertical slice: a deterministic desert mine tunnel.
**Status:** Tunnel implementation, real foreground desktop playback, and an
actual encoded MP4 with audio are verified. Real-device QA remains.

## Version-control checkpoint

- Branch: `feature/desert-mine-tunnel`, tracking the same branch on
  `github.com/CVilla90/canicarrera` through the personal SSH remote.
- Commit `b4a31e8` preserves all work that existed at the start of this session:
  audio, characters, rendering/export work, mobile HUD/fullscreen, auto-next,
  and deterministic ordinary-scenery clearance.
- Commit `b28a5d1` adds the deterministic desert mine implementation and its
  renderer-free regression coverage.
- The GitHub CLI has stale tokens for both stored accounts, but this repository
  pushes through `git@github-personal:CVilla90/canicarrera.git`; the successful
  push used Carlos's personal SSH identity and repository.
- No deployment or pull request was created.

## Completed in this checkpoint

### Pure set-piece contract

- Added `client/scene/SetPieceLayout.ts`, which selects a tunnel only from a
  declared straight track segment and then independently verifies its geometry.
- Selection stays at least 45 m from the grid and 10 m before the finish. It
  prefers a 30 m tunnel and deterministically falls back as short as 14 m only
  when a course has no longer honest interval.
- Every candidate is rejected unless:
  - its tangent changes by at most 9 degrees from the authored tunnel axis;
  - its slope remains within the set-piece limit;
  - the complete chute clears the 6.4 m interior;
  - the outer chase-camera path clears a 5.5 m envelope with wall margin; and
  - no non-local section of track enters the 8.25 m rock shell.
- Entrance, exit, centre/axis, interior and exterior radii, camera envelope,
  support frames, seeded lamp positions, and the prop-exclusion corridor are
  ordinary serialisable data. The module has no Three.js or DOM dependency.
- Set-piece choice and dressing use `COSMETIC.setPieces`; no simulation stream,
  `RaceSpec` physics field, `SIM_VERSION`, or `GENERATOR_VERSION` changed.

### Reserved scenery and renderer

- `WorldLayout.ts` now accepts explicit prop-exclusion zones before ordinary
  placement. Each dune's own conservative radius is added to the mine/portal
  reservation, including the existing spline-sampling safety margin.
- Desert worlds build the mine contract before scattering dunes. Other worlds
  follow the previous layout path unchanged.
- `World.ts` renders a low-poly outer rock shell, separate inner lining, two
  portal rims, wall-hugging timber ribs, and deterministic warm point lights.
  It uses open cylinders and instancing rather than CSG.
- The first visual pass used rectangular supports. Headless approach/interior
  frames showed their roof beams bisecting the chase-camera view even though the
  walls cleared the camera point. They were replaced with ribs whose inner edge
  stays outside the camera envelope, and the practical inverse-square lamp
  intensity was raised so the interior wall remains readable.
- Everything is static scene geometry or seeded light data. Preview and offline
  export therefore consume the same tunnel through the same `RaceScene`.

## Files intentionally touched

- `client/scene/SetPieceLayout.ts` — pure interval selection, clearance metrics,
  support/lamp data, and the prop reservation.
- `client/scene/WorldLayout.ts` — authored exclusion zones and deterministic
  relocation allowance.
- `client/scene/World.ts` — desert mine geometry, portals, ribs, and lights.
- `shared/rng.ts` — independent cosmetic set-piece stream label.
- `tools/run-tests.ts` — 60-track mine contract and dune exclusion regressions.
- `docs/CURRENT_WORK.md`, `docs/DEVELOPMENT.md`, `HANDOFF.md`, and `PLAN.md` —
  restart point, durable contract, and roadmap status.

## Verification completed

- `npm.cmd run check` — pass.
- `npm.cmd test` — pass, **84/84 checks**.
- `npm.cmd run build` — pass for client and server after rerunning with normal
  filesystem access; the sandbox cannot create Vite's temporary config under
  `node_modules/.vite-temp`.
- `git diff --check` — pass after documentation closure.

The mine tests cover **60 desert tracks**, twelve from each of all five generator
grammars. All 60 select a safe interval; all contracts rebuild byte-identically;
all are distinct across seeds; chute, camera, wall, and non-local-track checks
pass; and race outcomes remain unchanged.

Reserved layouts place **5,379/5,400 dunes** overall. The sparsest compact helix
layout retains 82/90 (91.1%), above the explicit 90% per-layout floor, and every
tested dune clears the mine/portal reservation. Those compact helix tracks also
miss the nominal budget without a mine (as low as 81/90), so the remaining
shortfall is an existing scenery-saturation limit rather than a tunnel overlap.
Unused instance slots remain hidden by `mesh.count`.

Expected non-fatal build warnings remain: Tailwind sourcemap quality and the
large Three.js chunk.

## Foreground and encoded-video verification completed

A production build was served locally and loaded in a visible, focused Edge
window with seed `MINEVIEW16` (`desierto`, `descenso`). The complete race played
in real time. Foreground frames at simulation times 25.36 s, 27.48 s, and
29.44 s confirmed the approach, interior, and exit with the normal smoothed
camera path. The portal frames the course, wall-hugging ribs leave the sightline
open, warm lamps reveal the faceted lining, and the daylight exit remains
readable.

The fresh foreground capability probe measured **789.5 raster frames/s** and
**83.9 pipeline frames/s**. A real UI export then produced the exact in-memory
MP4 Blob in about 14 seconds:

- 44,039,588 bytes; SHA-256
  `825D817FE0BEAA348E272F7EB3D429EC20D9D59BD1CA74E07C85EE8D421865B6`;
- H.264 High, YUV 4:2:0 BT.709, 1280x720 at 30 fps;
- exactly 2,100 video frames and 70.000 s container duration;
- AAC-LC, 48 kHz stereo, 69.9947 s, with mean -12.6 dB and max -0.2 dB; and
- fast-start atom order: `ftyp`, then `moov`, then `mdat`.

FFmpeg decoded both streams completely without errors. Frames extracted from
the encoded file at the same approach/interior/exit moments match the intended
composition and correctly omit the live HTML HUD. The 5.3 ms audio/video
duration difference is negligible, and the video duration matches the fixed
2,100-frame export contract exactly.

Edge DevTools download interception reported all 44,039,588 bytes received and
then marked its native download as cancelled. The QA harness retained the exact
Blob before that browser-automation boundary; that Blob is the file validated
above. This is evidence for the encoder, muxer, scene, and audio path, but not
for an uninstrumented OS download save. Temporary QA code and screenshots were
not added to the repository.

## Manual verification still required

- Repeat an uninstrumented export click and confirm the browser/OS persists the
  download; DevTools interception cancelled only after receiving the full Blob.
- Watch foreground tunnels from several different seeds, lengths, and slopes;
  this pass exercised the deterministic `MINEVIEW16` slice end-to-end.
- Repeat the 320/390 px, phone landscape, fullscreen/iPhone fallback, auto-next,
  and multi-race WebGL-memory matrix from `docs/DEVELOPMENT.md`.
- Inspect several desert seeds on real hardware for floating shell/terrain
  relationships, overly dark portals, dune composition, and lamp exposure.

## Known risks and assumptions

- The mine is a deliberate low-poly vertical slice, not a terrain-carving
  system. The shell sits among procedural dunes; there is no CSG excavation or
  terrain deformation yet.
- The selector returns `null` rather than drawing unsafe geometry if a future
  generator grammar has no eligible interval. Current coverage found an interval
  on all 60 representative tracks.
- Clearance protects the camera position and wall-hugging ribs. A later prop or
  cross-beam added inside the envelope needs its own bound; wall clearance alone
  cannot prove composition, as the discarded rectangular support showed.

## Next safe stage

The foreground and encoded `MINEVIEW16` gate passed without a transition,
exposure, terrain-integration, A/V, or decode defect. Reuse the same data
contract for a glacier ice-cave slice:
keep the interval/prop/camera tests, replace only the renderer dressing, and add
any icicle footprint to the explicit interior envelope. Do not add a second
set-piece kind by bypassing `SetPieceLayout.ts`.

No development or production server should be left running after session
closure.
