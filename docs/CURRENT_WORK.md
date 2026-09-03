# Current work checkpoint

**Date:** 2026-09-03
**Release candidate:** `v0.2.0-beta.1` (`Rolling Rivals beta`)
**Objective:** Prevent accidental surface-world terrain/scenery occlusion,
finish attribution, simulate the production deployment path, replace the
remaining local B1 performance estimates with measurements, and complete the
first fatigue-safe multi-genre audio pass.
**Status:** Attribution and local production verification are complete. Native
1080p30/60 and forced-SwiftShader B1 measurements are complete. The continuous
crowd-noise floor is removed and DnB/Kids/Rock are production-export verified.
Terrain and tilted ice-shard clearance are now enforced by pure layout
contracts; foreground visual review across more surface seeds, an actual
mid-range laptop, and real-device Safari/iPhone QA remain. Manual race setup is
implemented for world, track type, and music whenever Auto Next Race is off.

## Version-control checkpoint

- Branch: `feature/attribution-billboards`, based on jungle-ruin commit
  `a081f29` (`origin/feature/jungle-ruins`).
- The attribution work is intentionally uncommitted at this checkpoint; no push,
  deployment, or pull request was requested.
- Push through `git@github-personal:CVilla90/canicarrera.git`; the repo-local
  identity is the `CVilla90` noreply address. Stored GitHub CLI tokens are stale.

## Completed in this checkpoint

### Manual race setup

- New Race remains an immediate curated random action while Auto Next Race is
  enabled. With Auto Next Race disabled, both New Race entry points open one
  compact mobile-safe setup dialog instead.
- World and track type can each remain Random or independently constrain the
  curator. Music can select Random or any implemented profile: Drum & Bass,
  Rock, or Kids. A random soundtrack is resolved deterministically from the new
  race seed and the link stores that concrete result. Random generation within
  the chosen constraints is still curated; this is not a single unscored
  generator call.
- `Grand Prix` is the placeholder name for the planned F1-inspired world.
  Arcade, Electronic, Epic Orchestral, and Latin Rhythms are placeholder music
  directions. All placeholders live in a separate Coming Soon panel outside
  the active selectors, so the UI does not claim they already change the
  result. Every item inside a selector is implemented and usable today.
- Share links now record the resolved world, track type, and music alongside
  the seed. Reload validates those values and reconstructs the same configured
  presentation. Local generation fallback now honors world/track constraints
  instead of silently dropping them when the API is unavailable.

### Replaceable attribution copy

- `client/branding.ts` is the single edit point for the rendered brand, creator
  credit, and URL. The current URL is the public GitHub repository and can be
  replaced with the deployment URL without touching layout or canvas code.
- Trackside signs and the outro card read that same object. No personal name or
  destination is duplicated inside renderer methods.
- Trackside billboards now contain one clean, centred title only: `Rolling
  Rivals`. The former personal-name credit, `CANICARRERA` label, and URL are no
  longer drawn on billboard faces. The fuller outro card remains unchanged.

### Terrain and large-scenery clearance

- `client/scene/TerrainLayout.ts` now owns the exact world-space height function
  consumed by the Three.js terrain mesh. Procedural relief is clamped beneath
  the lowest nearby track branch instead of being added after the nominal
  eleven-metre offset.
- The clearance radius includes the complete 64×64 mesh-cell diagonal and
  spline sampling error. All corners of the rendered triangle below each dense
  track sample therefore remain at least 5.5 m below the course; interpolation
  between vertices cannot put a hidden peak through the chute.
- Folded tracks use the lowest nearby branch for the clamp, preventing terrain
  shaped for an upper branch from covering a lower pass at the same X/Z area.
- Tilted glacier shards now reserve their complete scaled height as a
  conservative plan footprint. A tall shard can no longer lean into the chase
  corridor after its base passed placement validation.
- This is cosmetic only: no race specification, physics, RNG stream, timing,
  or `SIM_VERSION` changed. Intentional crossings remain authored set pieces
  with explicit portals, lighting, and camera clearance.

### Pure billboard placement contract

- `client/scene/AttributionLayout.ts` selects up to three segment landmarks from
  `COSMETIC.billboards`, independently of every simulation stream.
- Signs remain 24 m from the grid, 18 m before the finish, and 24 m apart along
  the run. Each contract serialises position, an orthonormal upstream-facing
  basis, dimensions, a complete bounding radius, camera margin, and non-local
  track clearance.
- Authored mines, caves, and ruins take priority. Their spectator intervals are
  excluded before sign selection; billboard bounds are then reserved before
  ordinary scenery and characters are placed.
- A future folded grammar may honestly return fewer signs instead of forcing an
  unsafe placement. Across the current generator matrix, 539 of 540 layouts fit
  all three and one compact jungle helix fits two.

### Preview/export renderer

- `client/scene/Attribution.ts` draws a 2:1 canvas-textured face on a thin
  instanced scene box. Text uses local system fonts, so there is no font fetch
  that can race export or fail offline.
- A square camera-attached scene card fades in 0.9 s after the simulator ends,
  reaches full opacity after another 0.65 s, and remains title-safe on narrow
  aspect ratios. The dark scrim, card, sign faces, and all textures are Three.js
  objects rather than HTML.
- Both animations and visibility use simulation time. Realtime playback and
  frame-indexed export therefore consume the same scene state.
- Attribution geometry, materials, canvas textures, and camera children are all
  removed and disposed when a race is replaced or the scene is destroyed.
- The first browser pass exposed a square-texture/2:1-plane mismatch that
  stretched the sign and revealed too much gold backing. The corrected texture
  has native 2:1 dimensions and passed the repeated pixel/MP4 check.

### Fatigue-safe genre audio

- The tiring static source was the crowd implementation: one looping broadband-
  noise buffer remained audible for the full race. The score now emits finite,
  tension-driven crowd swells. Each lasts at most 2.7 s, stops its own source,
  and leaves at least 0.8 s of literal silence before the next swell.
- Drum and bass is now one explicit deterministic profile alongside children's
  music and rock. Profiles own tempo, grid, harmony, rhythm, arrangement, and
  voice recipes while sharing race energy, event SFX, exact duration, and the
  live/export scheduler.
- Kids uses a bright major toy-box vocabulary with bells and filtered plucks;
  Rock uses live-band drum patterns, picked bass, and filtered power chords. All
  sound remains procedural—no samples, remote assets, or Content ID material.
- The remembered mixer now includes a bilingual genre selector. Changing genre
  rebuilds only the cosmetic score and rejoins an in-progress race at simulation
  time. The chosen profile also travels through the offline MP4 path and export
  telemetry; it never touches simulation state or `SIM_VERSION`.

## Files intentionally touched

- `client/ui/RaceSetupPanel.tsx`, `client/App.tsx`, and `client/i18n.ts` — manual
  setup dialog, Auto Next gating, bilingual choices, honest placeholders, and
  reproducible configured links.
- `client/lib/api.ts` — parity between server curation constraints and the
  offline fallback.

- `client/branding.ts` — replaceable video attribution copy.
- `client/scene/AttributionLayout.ts` — renderer-free placement and outro timing.
- `client/scene/Attribution.ts` — canvas textures, scene meshes, camera card, and
  explicit disposal.
- `client/scene/World.ts` — set-piece → attribution → props ordering.
- `client/scene/TerrainLayout.ts`, `client/scene/World.ts`, and
  `client/scene/WorldLayout.ts` — final heightfield clearance and conservative
  tilted-prop bounds.
- `client/scene/RaceScene.ts` — renderer lifecycle, spectator reservations, and
  simulation-time updates.
- `shared/audio/score.ts`, `client/audio/synth.ts`, `client/audio/director.ts`,
  `client/App.tsx`, `client/ui/AudioPanel.tsx`,
  `client/export/exportRace.ts`, and `client/i18n.ts` — genre score/synthesis,
  finite crowd swells, persistence, UI, live switching, and export selection.
- `tools/run-tests.ts` — attribution plus multi-genre determinism, duration,
  grid, voice, level, short/long-race, and finite-crowd regressions.
- `tools/run-browser-benchmark.mjs` and `package.json` — dependency-free B1
  harness for native, low-power-GPU, throttled, SwiftShader, and explicit genre
  runs. Low-power mode is implemented but was not run in this checkpoint.
- `README.md`, `docs/CURRENT_WORK.md`, `docs/DEVELOPMENT.md`, `HANDOFF.md`, and
  `PLAN.md` — durable behavior and restart point.

## Automated verification

- `npm.cmd run check` — pass.
- `npm.cmd test` — pass, **126/126 checks**.
- `npm.cmd run build` — pass for the production client/server with normal
  filesystem access. The restricted sandbox still cannot write Vite's
  `.vite-temp` config.
- `git diff --check` — pass.
- Live constrained API creation returned a 20-candidate curated Jungle/Helix
  race. A disposable headless Edge 152 deep-link boot retained
  `world=jungla`, `track=helice`, and `music=rock`, completed the capability
  probe, and kept its WebGL context. The manual setup dialog itself still needs
  the foreground/mobile interaction check listed below.

The attribution suite covers **540 layouts**: twelve seeds for all five track
grammars in all nine worlds. It validates 1,619 signs, byte-identical placement,
distinct seeded layouts, landmark/buffer rules, basis orientation, camera and
non-local-track bounds, set-piece priority, prop/spectator reservations, outro
timing, and unchanged race outcomes.

All **21,600/21,600** requested surface props remain after the combined
set-piece and billboard reservations. No prop enters a billboard bound; the
tightest measured extra margin is approximately 0.17 m.

The terrain suite covers **60 layouts and 48,268 dense samples** across all
three surface biomes and all five generator grammars. It checks the four actual
mesh-cell corners beneath every sample; the tightest measured ground clearance
is approximately 6.75 m against a 5.5 m contract.

Expected non-fatal build warnings remain: Tailwind sourcemap quality and the
large Three.js chunk.

## Browser and encoded-video verification

A production build ran in an isolated headless Edge QA target with seed
`ATTRQA01` (`glaciar`). The document reported `visible` and focused, the canvas was
1280×720, and the pure layout supplied three signs at S=184.879, 363.255, and
588.297. Canvas-only frames confirmed legible upstream-facing signs and the
fully visible outro card without relying on HTML overlays.

The actual UI export, with audio enabled, produced and downloaded:

- file `canicarrera-ATTRQA01-720p30-estandar.mp4`;
- 44,132,927 bytes; SHA-256
  `4BAA9E5A83349592568961CD2C2359A17E859E8A28CEB5D126BD137E74AB30EE`;
- H.264 High, YUV 4:2:0, 1280×720 at 30 fps;
- exactly 2,121 video frames and 70.700 s video duration;
- AAC-LC, 48 kHz stereo, 70.720 s duration; and
- approximately 12 s from starting the export to the finished browser result.

FFmpeg decoded both complete streams without errors. An encoded frame at 19.7 s
contains the same first billboard composition as the canvas preview and no HTML
HUD; a frame one second before EOF contains the complete outro card with the
configured brand, credit, and URL. Edge reported the 44,132,927-byte download as
`completed` before the disposable QA target and local server were closed.

## Production simulation and B1 continuation

The production build passed a local deployment simulation: `npm start` bound
`0.0.0.0:5000`; the shell, health API, seeded race create/fetch, client render
job create/fetch, and SPA fallback succeeded. HTML/fallback responses were
`no-store`; the hashed JS asset was immutable.

The new harness drove the real production UI in Edge 151 with seed `B1BENCH1`,
Standard visuals, and audio enabled. Every file was 65.813 s:

| Run | Frames | Export time | Bytes | UI estimate |
|---|---:|---:|---:|---:|
| RTX 3070 Ti Laptop, 1080p30 | 1,974 | 16.849 s | 64,649,968 | ~26 s |
| RTX 3070 Ti Laptop, 1080p60 | 3,948 | 21.276 s | 98,273,291 | ~47 s |
| Same GPU, 4× CPU throttle / 4 CPUs, 1080p30 | 1,974 | 22.687 s | 64,649,968 | ~26 s |
| Same GPU, 4× CPU throttle / 4 CPUs, 1080p60 | 3,948 | 34.872 s | 98,273,291 | ~43 s |

The throttled pair is an approximation, **not** a real mid-range-laptop result.
The harness can now request this laptop's low-power GPU, but that mode was left
unrun at this stop point and must not be reported as verified.

All four downloads are H.264 High, YUV 4:2:0, exact 1920×1080 at the requested
fps, with AAC-LC 48 kHz stereo. FFprobe counted every frame; FFmpeg decoded all
complete streams with exit 0 and no diagnostics. No context was lost, and the
collected JS heap after export remained below the pre-export sample.

Forced ANGLE SwiftShader was positively identified and measured **3.089 full-
pipeline fps** at the 1080p Standard baseline. That implies about **10.7 minutes
at 1080p30** and **21.3 minutes at 1080p60** for this seed, validating the low
end of the old 3–10 fps estimate. Retain the capture/encode pipeline figure;
the draw-only probe measures asynchronous command submission, not completion.

## Multi-genre browser and MP4 verification

The production UI in isolated, visible/focused Edge 151 selected and persisted
each new genre, then exported the same `AUDIOQA1` race at 1080p30 Standard with
sound enabled:

| Genre | Frames / A-V duration | UI export | Bytes | Peak |
|---|---|---:|---:|---:|
| Kids | 2,110 / 70.333 s video, 70.336 s audio | 14.024 s | 64,576,071 | −3.0 dBFS |
| Rock | 2,110 / 70.333 s video, 70.336 s audio | 21.215 s | 63,684,500 | −2.2 dBFS |

Both files are H.264 High, 1920×1080 at 30 fps, with AAC-LC 48 kHz stereo.
FFmpeg decoded both complete streams with exit 0 and no diagnostics. The full-
file SHA-256 values are
`A50F6B739CC3A7CA72040A4D4B6A6FA4A23D8EA2AA02D3975A09F39BF10B9533`
and `79DA69AE6323D3E8F631C3F329992D0D75A575FECAB2A44A0A451B1C020AE0EF`;
their extracted AAC streams also differ, proving two distinct encoded
soundtracks rather than a selector-only UI change.

## Manual verification still required

- Exercise manual setup in a foreground browser at desktop and 320–390 px:
  Auto Next on must remain one-click random; Auto Next off must open setup;
  partial world/track constraints, music changes, Cancel/Escape, and copied-link
  reloads must behave as labelled. Confirm Grand Prix and future music appear
  only in Coming Soon and cannot be selected.

- Re-run representative desert, glacier, and jungle races in a foreground
  browser and inspect the complete course for terrain or large-scenery
  occlusion. The pure grid contract and a live WebGL boot passed, but this
  checkpoint did not claim a human viewing pass or encoded-frame terrain gate.
- Watch the sign approaches and outro during normal foreground playback in
  additional orbit and surface worlds; the encoded gate exercised one glacier.
- Repeat the 320/390 px, phone landscape, fullscreen/iPhone fallback,
  auto-next, and multi-race WebGL-memory matrix from `docs/DEVELOPMENT.md`.
- Run a sustained export on the iPhone that originally reported memory pressure.
- Confirm the square outro card remains comfortably title-safe on real portrait
  devices and the small URL remains legible after a social-platform transcode.
- Audition all three profiles through phone speakers, headphones, and ordinary
  laptop speakers. Automated level/structure checks prove the continuous source
  is gone and clipping is absent, but they cannot judge fatigue or taste.
- Switch genres during normal foreground playback and confirm the 80 ms rejoin
  feels clean on Safari/iPhone; the automated browser gate covered selection,
  persistence, and export rather than a human listening pass.

## Known risks and assumptions

- The configured destination is the public GitHub repository until a public app
  URL exists. Change only `client/branding.ts` when that destination or creator
  credit changes.
- Text rasterisation can vary slightly between system fonts, but placement,
  timing, and race results remain deterministic. No remote font is required.
- The billboard footprint is a conservative sphere around the complete board.
  Adding posts, lights, or sponsor dressing outside it requires a larger pure
  bound and corresponding tests in the same change.
- This is attribution, not sponsor inventory. No ad selection, tracking, or
  disclosure workflow was introduced.
- Kids and Rock are first-pass procedural arrangements. Their contracts and
  encoded output are verified, but subjective voicing/balance should be tuned
  from real listening feedback rather than waveform metrics alone.

## Next safe stage

The next product-launch step is **W10: deploy to Replit**, then run the real
phone/Safari and sustained-iPhone export matrix against the intended hosting
path. Use a blank Repl plus a normal clone; do not use Replit's GitHub import
flow, which previously restructured the repository.

B1 is complete for this RTX laptop's 1080p30/60 path and forced SwiftShader. A
**real mid-range laptop** remains; the throttle pair is not a replacement.
The static-noise and first multi-genre audio pass is complete. The next audio
step is subjective device listening/tuning; commentary and the no-WebCodecs WASM
encoder remain later engineering work.

The surface-world terrain/large-prop clearance implementation is complete. The
remaining gate is foreground and encoded-frame visual review across desert,
glacier, and jungle. Any future retained overlap must remain an intentional,
lit, portal-defined tunnel/cave/passage with validated interior visibility.

Future race-excitement mechanics are now documented in `PLAN.md` §3.2: jumps,
bifurcating routes, water/dirt/ice/sand surface zones, speed boosts, and static
or moving obstacles. These are simulation changes rather than cosmetic props;
they require a new sim version, deterministic physics/events, generator and
curation work, camera/visibility validation, and preview/export regression
coverage. The recommended first slice is one safe jump or surface zone, not the
track-graph rewrite required for honest bifurcations.

The development server requested for visual review is currently expected at
`http://localhost:5173/`; verify its process before relying on that statement in
a later session.
