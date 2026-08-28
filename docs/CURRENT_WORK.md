# Current work checkpoint

**Date:** 2026-08-27
**Objective:** Extend the intentional set-piece contract with a deterministic
glacier ice cave, including bounded interior dressing and safe spectators.
**Status:** Implementation, regression coverage, real foreground playback, and
an actual downloaded MP4 with audio are verified. Real-device QA remains.

## Version-control checkpoint

- Branch: `feature/glacier-ice-cave`, based on the completed and pushed
  `feature/desert-mine-tunnel` checkpoint.
- Remote: Carlos's personal repository through
  `git@github-personal:CVilla90/canicarrera.git`.
- The GitHub CLI tokens stored on this machine are stale; normal Git operations
  use the repo's personal SSH identity instead.
- No deployment or pull request was created.

## Completed in this checkpoint

### Reusable set-piece selector

- `client/scene/SetPieceLayout.ts` now has one profile-driven candidate search
  for intentional tunnel-like crossings. The desert mine still rebuilds to the
  same contract while the glacier uses its own cosmetic stream,
  `${COSMETIC.setPieces}:glacier`.
- The glacier selector prefers a 30 m declared straight and may fall back to a
  safe interval no shorter than 14 m. It stays at least 45 m from the grid and
  10 m before the finish.
- Every chosen interval independently verifies tangent, slope, full chute,
  chase-camera envelope, and non-local-track clearance before returning data.
  An unsafe course gets `null`, never forced geometry.
- The cave contract declares a 7.35 m interior, 9.5 m outer shell, 5.5 m camera
  envelope, portal/prop reservations, crystalline ridges, seeded cyan glows,
  and every icicle's root, tip, length, radius, and measured camera clearance.
- Icicles anchor to the authored straight axis rather than the slightly
  wandering spline. Their conservative bounds keep at least 0.35 m outside the
  complete camera envelope.

### Renderer, scenery, and spectators

- Glacier worlds select and reserve their cave before ordinary ice shards are
  scattered. Desert worlds continue selecting the mine through the same path;
  jungle and orbit worlds are unchanged.
- `client/scene/World.ts` renders a faceted outer ice shell, separate blue inner
  lining, portal rims, wall-hugging crystalline rings, instanced cone icicles,
  and deterministic emissive crystals/point lights. Preview and export both use
  this static `RaceScene` group.
- Each intentional set piece now exposes a spectator-exclusion arc covering the
  shell and both approaches. Character placement deterministically relocates a
  spectator to the nearest safe side, or skips it if neither side fits, without
  drawing new RNG values.
- The first headless visual pass found a seal standing inside the new cave. The
  exclusion/relocation contract fixed that before the foreground gate; the
  verified seed places the seal beside the approach as a greeting instead.

## Files intentionally touched

- `client/scene/SetPieceLayout.ts` — reusable profiles, glacier selection,
  bounded icicles/glows/ridges, and spectator reservations.
- `client/scene/World.ts` — cave rendering and set-piece propagation.
- `client/scene/Characters.ts` — deterministic exclusion-aware relocation.
- `client/scene/RaceScene.ts` — passes the active set-piece reservation to the
  character layout.
- `tools/run-tests.ts` — 60-track glacier contract, scenery, spectator, and
  unchanged-outcome regression coverage.
- `docs/CURRENT_WORK.md`, `docs/DEVELOPMENT.md`, `HANDOFF.md`, and `PLAN.md` —
  checkpoint and next restart point.

## Automated verification

- `npm.cmd run check` — pass.
- `npm.cmd test` — pass, **93/93 checks**.
- `npm.cmd run build` — pass for the production client and server when run with
  normal filesystem access. The restricted sandbox cannot create Vite's
  temporary config under `node_modules/.vite-temp`.
- `git diff --check` — pass.

The suite covers **60 glacier tracks**, twelve from each generator grammar.
Fifty-nine select a safe cave and all 59 rebuild byte-identically while remaining
distinct across seeds. `ICE_CAVE_helice_6` honestly returns `null` because no
candidate clears the wider shell; the explicit coverage floor is 95%.

Across selected layouts, all **7,080/7,080** requested ice shards remain. The
sparsest layout retains 100%, every shard clears the reserved cave/approaches,
the tightest prop margin is 0.15 m, and the tightest authored icicle margin is
0.36 m. Set-piece construction leaves race outcomes unchanged.

Expected non-fatal build warnings remain: Tailwind sourcemap quality and the
large Three.js chunk.

## Foreground and encoded-video verification

A production build was served locally and loaded in a dedicated, visible,
focused Edge window with seed `ICEVIEW5` (`glaciar`, `acantilado`). Normal
real-time playback traversed the 30 m cave from S=217.332 to S=247.332 with ten
authored icicles. Five foreground frames captured approach, entrance, interior,
exit, and departure while `document.visibilityState === "visible"`, the page
had focus, and `RaceScene.isRunning` was true.

The sequence shows a bright readable entrance, faceted cyan lining, clear
wall-hugging ridges, high icicles outside the sightline, a readable daylight
exit, and the relocated seal safely outside the approach. No cave element
obstructs the marbles or chase camera.

The actual UI export and browser download then produced:

- file `canicarrera-ICEVIEW5-720p30-estandar.mp4`;
- 44,512,875 bytes; SHA-256
  `AD24DA7AB195C15BC8CE93294202181AA8B9343E5C5D155BDB60633322C2F508`;
- H.264 High, YUV 4:2:0 BT.709, 1280x720 at 30 fps;
- exactly 2,104 video frames and 70.133 s video duration;
- AAC-LC, 48 kHz stereo, 70.144 s duration, mean -12.6 dB and max -0.5 dB;
- 10.7 ms audio/video duration difference; and
- fast-start atom order: `ftyp`, then `moov`, then `mdat`.

FFmpeg decoded both complete streams without errors. Frames extracted from the
encoded file at approach/interior/exit match the foreground composition and
correctly omit the live HTML HUD. Unlike the earlier DevTools-intercepted mine
artifact, this run reached Edge's `completed` download state and persisted the
full file to disk.

## Manual verification still required

- Watch several additional glacier seeds, cave lengths, slopes, and generator
  grammars on real hardware.
- Repeat the 320/390 px, phone landscape, fullscreen/iPhone fallback,
  auto-next, and multi-race WebGL-memory matrix from `docs/DEVELOPMENT.md`.
- Run a sustained export on the iPhone that originally reported memory pressure.
- Inspect lower-power hardware for cave exposure and point-light cost.

## Known risks and assumptions

- The cave is an intentional low-poly shell, not CSG-carved terrain. Its portals
  sit among generated glacier terrain and shards.
- One representative compact helix has no honest cave interval. Returning
  `null` is the expected safety behavior, not a coverage failure.
- The spectator contract is an arc reservation. Future large or animated cast
  props need their own footprint if their geometry extends beyond the current
  plinth-scale assumption.
- New interior geometry must declare a camera-envelope bound before rendering;
  the icicle test does not automatically protect a future unbounded asset.

## Next safe stage

The glacier vertical slice passed the same pure-contract, scenery, foreground,
encoded-output, audio, decode, and real-download gate as the desert mine. The
next intentional set piece is a jungle ruin. Reuse the profile-driven selector,
reserve the interval before foliage and spectators, and explicitly bound arches,
fallen stone, roots, and vines against the chase-camera envelope. Do not turn a
random ordinary prop overlap into a ruin after placement.

No development or production server should be left running after session
closure.
