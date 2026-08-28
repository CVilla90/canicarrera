# Current work checkpoint

**Date:** 2026-08-27
**Objective:** Complete the third intentional set-piece slice: a deterministic
jungle ruin with reserved scenery/spectators and bounded broken dressing.
**Status:** Implementation, regression coverage, real foreground playback, and
an actual downloaded MP4 with audio are verified. Real-device QA remains.

## Version-control checkpoint

- Branch: `feature/jungle-ruins`, based on pushed glacier commit `fda23d6`.
- The glacier checkpoint is available as `origin/feature/glacier-ice-cave` in
  Carlos's personal `CVilla90/canicarrera` repository.
- Push through `git@github-personal:CVilla90/canicarrera.git`; the repo-local
  identity is the `CVilla90` noreply address. Stored GitHub CLI tokens are stale.
- No deployment or pull request was created.

## Completed in this checkpoint

### Pure jungle-ruin contract

- `client/scene/SetPieceLayout.ts` adds a third profile to the shared candidate
  selector. It uses `${COSMETIC.setPieces}:jungle`, never a simulation stream.
- A ruin prefers a 30 m declared straight and falls back no shorter than 14 m,
  stays 45 m from the grid and 10 m before the finish, and independently checks
  tangent, slope, chute, camera, and non-local-track clearance.
- The contract declares a 7 m interior, 9.15 m conservative exterior, 5.5 m
  camera envelope, 9.9 m prop reservation, both portal approaches, and a
  spectator-exclusion arc.
- Seven-ish weathered arches, seeded wall stones, hanging vines, and warm/green
  glyph lights are serialisable layout data. Each stone and vine records its
  conservative radius and measured camera clearance.
- Stones anchor 6.66 m from the authored straight axis; vines hang inward from
  6.74 m. The tightest generated bounds remain at least 0.35 m outside the
  complete chase-camera envelope.

### Renderer and visual correction

- Jungle worlds select and reserve the ruin before ordinary trees or characters
  are placed. Desert mines, glacier caves, other surface worlds, and all orbit
  worlds preserve their previous paths.
- `client/scene/World.ts` renders weathered low-poly portal arches, repeated
  stone ribs, moss bands, bounded broken masonry, hanging vines, and seeded
  glyph lights. Everything is static and shared by preview/export.
- The first production pass used a continuous dark outer shell and lining. It
  was geometrically safe but read as a brown tunnel rather than a jungle ruin.
  Removing the continuous shell opened daylight and forest views between the
  arches; increasing the still-bounded masonry/vine density made the biome read
  without narrowing the chase shot.
- The verified cast has no spectator inside the ruin or either approach. The
  nearby toucan remains outside as a trackside greeting.

## Files intentionally touched

- `client/scene/SetPieceLayout.ts` — jungle profile, pure arches/stones/vines/
  glyphs, and conservative dressing bounds.
- `client/scene/World.ts` — open jungle-ruin colonnade renderer and world routing.
- `tools/run-tests.ts` — 60-track jungle contract, scenery, spectator, dressing,
  and unchanged-outcome regressions.
- `docs/CURRENT_WORK.md`, `docs/DEVELOPMENT.md`, `HANDOFF.md`, and `PLAN.md` —
  checkpoint and next restart point.

## Automated verification

- `npm.cmd run check` — pass.
- `npm.cmd test` — pass, **102/102 checks**.
- `npm.cmd run build` — pass for production client/server with normal filesystem
  access. The restricted sandbox cannot write Vite's `.vite-temp` config.
- `git diff --check` — pass.

The suite covers **60 jungle tracks**, twelve from every generator grammar. All
60 select a distinct deterministic ruin, every interval and shell/envelope check
passes, and constructing the set piece leaves the race outcome unchanged.

All **9,000/9,000** requested jungle trees remain across reserved layouts; the
sparsest layout retains 100%, there are no ruin/approach intersections, and the
tightest extra tree margin is 0.19 m. The tightest broken-stone and hanging-vine
camera margins are approximately 0.54 m and 0.35 m respectively.

Expected non-fatal build warnings remain: Tailwind sourcemap quality and the
large Three.js chunk.

## Foreground and encoded-video verification

A production build ran in a dedicated visible, focused Edge window with seed
`RUINQA105` (`jungla`, `guantelete`). Its 30 m ruin spans S=165.479 to S=195.479
and contains seven arches, seven bounded stones, ten vines, and four glyphs.

Five normal real-time frames captured approach, entrance, interior, exit, and
departure at simulation times 24.125–29.292 s. Every capture reported a visible,
focused, running scene. The corrected sequence keeps daylight between arches,
shows weathered masonry and high vines, frames the jungle/track beyond, and
leaves the marbles and exit unobstructed.

The actual UI export and Edge download produced:

- file `canicarrera-RUINQA105-720p30-estandar.mp4`;
- 42,456,920 bytes; SHA-256
  `3481246030C50627FCA5588690FFBFD0B878356F78F1AFB9108B7AA18AD22EC2`;
- H.264 High, YUV 4:2:0 BT.709, 1280x720 at 30 fps;
- exactly 2,014 video frames and 67.133 s video duration;
- AAC-LC, 48 kHz stereo, 67.136 s duration, mean -12.3 dB and max -0.5 dB;
- 2.7 ms audio/video duration difference; and
- fast-start atom order: `ftyp`, then `moov`, then `mdat`.

FFmpeg decoded both complete streams without errors. Extracted encoded frames at
approach/interior/exit match the corrected foreground composition and correctly
omit the live HTML HUD. Edge reported the complete 42,456,920-byte browser
download as `completed` before the disposable debugger socket closed.

## Manual verification still required

- Watch additional jungle seeds, ruin lengths, slopes, and grammars on real
  hardware; the end-to-end gate exercised `RUINQA105`.
- Repeat the 320/390 px, phone landscape, fullscreen/iPhone fallback,
  auto-next, and multi-race WebGL-memory matrix from `docs/DEVELOPMENT.md`.
- Run a sustained export on the iPhone that originally reported memory pressure.
- Check lower-power hardware for arch/glyph cost and jungle exposure.

## Known risks and assumptions

- The ruin is an open authored colonnade, not terrain CSG or a destructible
  structure. Its 9.15 m shell is a conservative reservation around visible
  geometry, not a rendered continuous wall.
- Fixed arch geometry has a tested wall-hugging bound. Changing its torus radii
  requires updating the pure margin assertion in the same change.
- Stones and vines carry conservative bounds. A future leaf cluster, root, or
  fallen beam larger than those values needs its own contract field and test.
- The three set-piece slices are deliberately one per matching surface biome;
  a future system with multiple candidates in one world needs an explicit
  conflict/priority policy before placement.

## Next safe stage

The desert mine, glacier ice cave, and jungle ruin have all passed their pure,
foreground, encoded-output, audio, decode, and download gates. The next local
product slice should be in-scene attribution billboards and an outro end card,
because HTML branding does not appear in exported MP4s. Keep placement in pure
layout data, use scene objects/canvas textures, and verify preview/export parity.

Deployment (W10) and the real iPhone/Safari matrix remain external launch gates;
they were not implicitly authorized by feature-branch development.

No development or production server should be left running after session
closure.
