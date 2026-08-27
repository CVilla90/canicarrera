# Current work checkpoint

**Date:** 2026-08-27
**Objective:** Preserve the completed mobile/audio/scenery work, then build the
first intentional set-piece vertical slice: a deterministic desert mine tunnel.
**Status:** Tunnel implementation and automated/headless desktop verification
complete. Interactive browser, real-device, and encoded-MP4 QA remain.

## Version-control checkpoint

- Branch: `feature/desert-mine-tunnel`, tracking the same branch on
  `github.com/CVilla90/canicarrera` through the personal SSH remote.
- Commit `b4a31e8` preserves all work that existed at the start of this session:
  audio, characters, rendering/export work, mobile HUD/fullscreen, auto-next,
  and deterministic ordinary-scenery clearance.
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

## Visual verification completed

A production build was served locally and loaded in headless Edge at 1440x900
with seed `MINEVIEW16` (`desierto`, `descenso`). A valid cached capability was
injected only to bypass the headless browser's known encoder benchmark stall.
Inspection frames at simulation times 25.2 s, 27.3 s, and 29.4 s were rendered
through `RaceScene.renderFrameAt` with a large deterministic step to settle the
camera at the approach, interior, and exit. This exercises the same scene and
offline-render entry point, but it is not a sequentially timed or encoded MP4.

The second capture confirmed that the portal frames the course, the revised
timber ribs no longer occlude the chase-camera sightline, warm lamps reveal the
faceted lining, and the daylight exit remains readable. These temporary QA
screenshots were not added to the repository.

This is honest desktop headless visual evidence, not an interactive-browser,
phone, Safari, or encoded-video result.

## Manual verification still required

- Watch a complete desert race in foreground Chrome/Edge and confirm the
  smoothed camera transition through tunnels of different lengths and slopes.
- Export at least one MP4 with audio and inspect the approach, interior, exit,
  A/V alignment, and portal lighting in the encoded file.
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

First perform one real foreground preview and one encoded MP4 of `MINEVIEW16` or
another deterministic desert seed. Fix any transition, exposure, or terrain
integration issue found there before generalising the contract.

Once that passes, reuse the same data contract for a glacier ice-cave slice:
keep the interval/prop/camera tests, replace only the renderer dressing, and add
any icicle footprint to the explicit interior envelope. Do not add a second
set-piece kind by bypassing `SetPieceLayout.ts`.

No development or production server should be left running after session
closure.
