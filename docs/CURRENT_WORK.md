# Current work checkpoint

**Date:** 2026-08-26  
**Objective:** Ship the quickest race-view improvements, then establish safe,
deterministic scenery placement before richer map work.  
**Status:** Quick wins and ordinary-scenery clearance foundation complete;
manual browser/device and visual QA remain.

## Completed in this checkpoint

### Stage 1 — race view and mobile HUD

- Removed live numeric completion percentages from every timing-tower row.
  Exact finish times remain, and the thin deterministic progress bar remains.
- Narrowed the timing tower on phones and desktop. Expanded lists are capped at
  `min(46vh, 260px)` and scroll instead of covering the race.
- Compacted the mobile action row to icons/short labels while retaining full
  labels and tooltips on larger screens.
- Added a bilingual fullscreen control.
- Fullscreen always provides an immersive in-app view. On capable browsers it
  also requests native fullscreen; denial or lack of support falls back without
  trapping the viewer.
- Leaving native fullscreen with browser controls restores the ordinary HUD.
- Immersive mode hides the safe frame, wordmark, timing/audio panels, seed plate,
  ordinary race actions, results/export panels, and offline notice. Its exit
  control remains available.

### Stage 2 — automatic next race

- Added an enabled-by-default, remembered auto-next preference using
  `localStorage` key `canicarrera.autoNext`.
- A finished race pre-generates the next curated race and switches after six
  seconds of visible-tab time.
- The podium and bottom HUD show the state/countdown and allow toggling it.
- Hiding the tab pauses the countdown, matching the existing paused playback.
- Replay, export, and manual race creation cancel the pending transition for the
  current result without turning off auto-next for future races.
- Re-enabling auto-next at a podium intentionally starts a new six-second count.
- Prefetch failures are observed immediately, stale prefetched results are
  ignored, and failures leave the completed race available instead of showing a
  permanent loading overlay.

### Stage 3 — deterministic scenery clearance

- Added `client/scene/WorldLayout.ts`, a renderer-free layout module that can be
  exercised directly by the Node test suite.
- Samples the complete track in plan view every 1.5 metres and computes exact
  point-to-polyline distance for each candidate prop.
- Reserves 7.5 metres around the track centreline **in addition to each prop's
  own conservative footprint**, plus 0.15 metres for spline approximation.
  This projected corridor also protects the chase camera and rejects props
  beneath overhead spirals instead of trusting vertical separation.
- Replaced midpoint-annulus scenery with candidates anchored along the entire
  race. Candidates that approach any other part of a loop are deterministically
  rejected and relocated.
- Ordinary props also receive conservative mutual spacing. Dunes may merge
  softly; solid trees and ice shards keep distinct silhouettes.
- Scenery and atmospheric motes now use the actual race seed. The previous code
  accidentally seeded both with the literal strings `"props"` and `"motes"`, so
  different races shared the same cosmetic random sequence.
- World/terrain reach now measures the complete course rather than only the
  start and finish, preventing spiral extrema from falling outside the intended
  terrain area.
- Unused `InstancedMesh` slots are explicitly excluded if relocation ever
  cannot fill a biome's budget, so default matrices cannot draw props at the
  starting grid.
- No race specification or physics input changed. `SIM_VERSION` and
  `GENERATOR_VERSION` remain unchanged; winners and finish times are unaffected.

## Files intentionally touched

- `client/App.tsx` — immersive/fullscreen state and auto-next lifecycle.
- `client/i18n.ts` — Spanish and English labels.
- `client/ui/TimingTower.tsx` — compact layout and percentage removal.
- `client/ui/ResultsCard.tsx` — auto-next status/toggle at the podium.
- `client/scene/WorldLayout.ts` — pure seeded placement and clearance queries.
- `client/scene/World.ts` — consumes safe transforms, seeds motes, sizes the
  world from the complete course.
- `client/scene/RaceScene.ts` — passes the immutable race seed into world layout.
- `tools/run-tests.ts` — multi-world determinism and clearance regression tests.
- `AGENTS.md` — project-local, vendor-neutral contributor routing.
- `docs/DEVELOPMENT.md` — durable architecture, behavior, and QA contracts.
- `docs/CURRENT_WORK.md` — this restart point.
- `README.md` and `HANDOFF.md` — links and checkpoint summary.

The repository already contained substantial uncommitted audio, character,
mobile, rendering, simulator, documentation, and export work before this
checkpoint began. Several files above overlap that work. Do not use a broad
checkout/reset to isolate this feature; inspect focused diffs and preserve all
pre-existing changes.

## Verification completed

- `npm.cmd run check` — pass.
- `npm.cmd test` — pass, **75/75 checks**.
- `npm.cmd run build` — pass for client and server.
- `git diff --check` — pass.

The new layout checks cover all three surface worlds over 36 race/world
combinations: **4,320/4,320 props placed**, every layout byte-identical when
rebuilt with the same seed, every tested layout distinct across different races,
and **zero corridor violations**. The tightest measured clearance retains 0.16 m
beyond the base corridor and prop footprint, exceeding the 0.15 m approximation
margin.

The first sandboxed build attempt could not create Vite's temporary file under
`node_modules/.vite-temp` (`EPERM`). Re-running the same production build with
normal filesystem access passed. This was an execution-environment restriction,
not a source or build defect.

Expected non-fatal build warnings remain: Tailwind sourcemap quality and the
large Three.js chunk.

## Manual verification still required

- True fullscreen enter/exit on Chrome/Edge/Safari desktop and iPad.
- Immersive fallback on an actual iPhone.
- 320px and 390px portrait layout, phone landscape, and expanded tower scrolling.
- The entire auto-next interaction matrix from `docs/DEVELOPMENT.md`.
- A multi-race soak test for timer cleanup, GPU disposal, and WebGL memory.
- Visual inspection of representative jungle, desert, and glacier seeds after
  the new placement distribution. Automated tests prove bounds, not taste,
  occlusion, composition, lighting, or camera readability.

No manual browser or real-device result is claimed by this checkpoint.

## Next safe stage

Build one intentional tunnel vertical slice using an explicit set-piece
contract. The recommended first slice is a **desert mine tunnel** because it
exercises terrain, portals, interior lighting, prop exclusion, and chase-camera
clearance without the shader work of a planet or ice cave:

1. Select only a sufficiently straight, low-curvature interval away from the
   grid and finish.
2. Reserve the interval before ordinary prop placement.
3. Define entrance, exit, interior radius, and a camera-safe envelope as data.
4. Build an outer rock/mine silhouette, two portals, interior lining/supports,
   and deterministic lights without CSG.
5. Add pure tests for interval validity and camera clearance, then visually
   inspect preview and export before generalising the contract to ice caves,
   mountain tunnels, jungle ruins, and planet interiors.

## Session closure

- Work is intentionally paused after the ordinary-scenery clearance foundation;
  the repository is in a resumable state and no follow-on tunnel work has begun.
- The final automated state is `check` passing, **75/75 tests** passing, the
  production build passing, and `git diff --check` passing.
- Headless Edge could load the application shell but remained in the device
  capability probe, so it did not provide meaningful 3D visual verification.
  Do not reinterpret that attempt as either a scene pass or a scene failure.
- Start the next session by reading `AGENTS.md`, this file, and the deterministic
  visual contracts in `docs/DEVELOPMENT.md`; then begin with the desert mine
  tunnel vertical slice described above.

No commit or deployment was created in this checkpoint, and no development or
production server was left running.
