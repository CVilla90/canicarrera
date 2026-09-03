# Canicarrera development guide

This is the durable, tool-neutral guide for developing Canicarrera. It explains
how the system is divided, which behaviors are contractual, and how to leave a
restartable checkpoint for another person or coding assistant.

## Source map

| Area | Responsibility |
|---|---|
| `shared/` | Deterministic race specification, generator, track, simulator, curation, and audio score. No browser dependencies. |
| `client/scene/` | Three.js world, track, marbles, camera, characters, and cosmetic animation. |
| `client/render/` | Device budgets, visual presets, environments, and post-processing. |
| `client/audio/` | Live and offline consumers of the shared score. |
| `client/export/` | Capability measurement, offline frame loop, WebCodecs, and MP4 output. |
| `client/ui/` | React broadcast HUD and panels. |
| `server/` | Express API, race curation/registry, static build hosting, and telemetry. |
| `tools/run-tests.ts` | Framework-free deterministic and arithmetic regression suite. |

The central dependency direction is `shared -> consumers`. Scene or UI code may
read a race; it must not feed cosmetic state back into the simulator.

## Race lifecycle

`App.tsx` obtains a `RaceResult`, pre-simulates it once for video duration and
audio events, loads it into `RaceScene`, and starts the scene and live audio at
the same simulation time. `RaceScene` owns the current `RaceSim` and publishes a
lightweight HUD snapshot about ten times per second.

Replacing a race is expected to be safe and frequent. `RaceScene.load()` first
disposes the previous world's GPU resources, rebuilds from the new immutable
specification, restarts at time zero, and leaves race outcomes unchanged.

## Quick-win UI contracts

### Timing tower

- Phone-sized viewports start collapsed to the leader; desktop starts expanded.
- Expanded content is height-bounded and scrollable, so it cannot consume most
  of a portrait viewport.
- Do not show numeric completion percentages. The two-pixel bar communicates
  progress with less clutter; exact finish time appears after a racer finishes.
- A viewer can always expand or collapse the tower manually.

### Immersive and fullscreen view

- The control always enables an in-app immersive view by hiding nonessential
  HUD chrome and panels.
- When `document.fullscreenEnabled` is available, the same user gesture also
  requests native fullscreen on the document element.
- If native fullscreen is denied or unsupported, immersive mode remains active.
- `fullscreenchange` restores the HUD if the browser or user exits native
  fullscreen externally.
- Keep an explicit exit control visible in immersive mode; never depend only on
  Escape or a platform gesture.

### Auto-next race

- Default: enabled. Persistence key: `canicarrera.autoNext`.
- While enabled, a manual New Race press also remains immediate and fully
  random. While disabled, the same action opens the manual race setup panel.
- Manual setup constrains world and track type independently; leaving either
  on Random still lets the server curate the strongest candidate inside that
  partial constraint. Music may also be Random; resolve it from the selected
  race seed on a named cosmetic stream, then store the concrete genre in the
  link. Music must never affect curation, simulation RNG, or race outcome.
- A configured race link records the resolved `world`, `track`, and `music`
  alongside its seed. Boot must validate those query values before sending
  them to generation. The offline fallback must honor the same constraints as
  the server.
- Coming-soon worlds or music styles belong outside active selectors in a
  clearly labelled Coming Soon section. Every selectable item must work today;
  never map a future label onto an unrelated implemented world or soundtrack.
- Delay: six seconds of **visible-tab time** after the finished phase.
- The next curated race is prefetched during the podium window for a seamless
  transition.
- Replay, export, or manual race creation suppresses the pending transition for
  the current finished race without changing the saved global preference.
- Turning auto-next off cancels the countdown. Turning it back on at the podium
  explicitly restarts the countdown for that race.
- A rejected prefetch must be handled immediately; never leave a promise
  unobserved until the timer expires.
- Timer/listener cleanup must make a prefetched result stale when another user
  action wins.

## Deterministic visual work

### Surface terrain and track visibility

- Desert, glacier, and jungle terrain must clear the complete track/chase-camera
  corridor after the final heightfield and large terrain masses are known.
- "No physics collision" is not clearance. If terrain hides the chute or pack,
  the visual layout is invalid even though the one-dimensional sim continues.
- Resolve accidental overlap cosmetically by carving/lowering terrain or
  rejecting and regenerating visual placement; never alter simulation state or
  consume a simulation RNG stream to fix scenery.
- Any overlap kept deliberately must be an authored tunnel-like set piece with
  portals, validated interior/camera clearance, approach reservations, lighting,
  and an unobstructed exit. Darkness or enclosure must not hide the marbles.
- Test terrain height against dense track samples with a conservative margin,
  then inspect real preview and exported frames across every surface world.
- `client/scene/TerrainLayout.ts` owns the final terrain height function. Its
  clamp must use the lowest nearby branch and include a complete mesh-cell
  diagonal plus spline-sampling error; checking only the analytical height at
  the centreline does not prove the rendered triangles are clear.

Cosmetic placement should use a stream in `shared/rng.ts`, keyed by seed and a
stable label. Animation must use `sim.time`. Adding a prop, character, particle,
or sound may alter the pixels or score but must not consume any simulation RNG
or alter a `RaceSpec` physics field.

Ordinary scenery uses the deterministic layout/clearance pass in
`client/scene/WorldLayout.ts`:

1. It samples the complete track spline, not only its midpoint or endpoints.
2. It projects a conservative collision-free envelope for both chute and chase
   camera into plan view.
3. Every prop kind declares a footprint; candidates are rejected and relocated
   when footprint + corridor + sampling margin would intersect.
4. Candidates are anchored along the complete run and use the race seed with
   `COSMETIC.props`. Do not substitute a literal seed or simulation stream.
5. `tools/run-tests.ts` checks determinism, budget fulfilment, and minimum
   clearance across all surface biomes.

When adding an ordinary prop kind, update its geometry footprint in
`WorldLayout.ts` in the same change. A renderer-only mesh with no layout bound
has no clearance guarantee.

Intentional crossings are different. `client/scene/SetPieceLayout.ts` is the
renderer-free contract. The desert mine is the reference selector, the glacier
ice cave proves it can carry a different shell, and the open jungle ruin proves
the conservative exterior may reserve geometry without rendering a solid wall:

1. Search only declared straight segments, then validate actual sampled tangent,
   slope, grid/finish distance, and non-local track clearance.
2. Define entrance, exit, axis, interior/outer radii, camera envelope, supports
   or ridges, lighting, and prop exclusion as serialisable data before drawing
   anything.
3. Pass the exclusion into `buildPropLayout()` before ordinary props are placed.
4. Keep every support, lamp, icicle, beam, vine, and other interior object
   outside the camera envelope too. Wall clearance alone does not prove an
   unobstructed shot. Store the measured margin in the pure contract when an
   object reaches inward from the shell.
5. Reserve the shell and its approaches from spectators as well as ordinary
   scenery. Relocate a character deterministically without consuming new RNG;
   skip it when neither adjacent safe arc fits.
6. Build preview and export from the same static group and animate any future
   moving part from `sim.time`.

The jungle ruin's arches are deliberately open to daylight. `outerRadius` is a
non-local-track and scenery reservation, not a promise that every set piece has
a continuous outer mesh. Fixed renderer geometry still needs a pure asserted
inner bound; changing an arch's torus thickness without its margin test is a
contract violation even when the track itself remains clear.

The selector must return `null` rather than force a mine onto an unsafe future
track grammar. Never make an ordinary prop intersect and call the overlap a
tunnel after the fact. A new cave, ruin, mountain, or planet should reuse this
contract and extend its pure tests before it adds renderer dressing.

### In-scene video attribution

Attribution belongs to the pixels, not the page around them. The shared link and
the HTML HUD are useful while watching, but neither exists after someone uploads
the MP4 elsewhere.

- Keep the rendered brand, creator credit, and destination together in
  `client/branding.ts`. A credit or deployment-URL change must not require edits
  to canvas drawing or scene lifecycle code.
- `client/scene/AttributionLayout.ts` owns sign selection and every visible
  bound. Place only at eligible segment landmarks, use `COSMETIC.billboards`,
  and return fewer signs rather than forcing one across the camera or another
  track section.
- Placement priority is set piece → attribution → ordinary props and
  spectators. A new sign shape must reserve its complete geometry from both
  consumers before the renderer grows it.
- `client/scene/Attribution.ts` is only a Three.js consumer. Use local canvas
  textures rather than fetched fonts or images, and keep trackside text on a
  texture with the same aspect ratio as its plane.
- The outro is a camera child but still a scene object. Drive its fade from
  `sim.time - sim.endTime`; a CSS overlay or wall-clock timeout will disappear
  from export or drift from the final frames.
- Dispose the sign geometry/materials, both canvas textures, the outro scrim,
  and the camera child whenever a race is replaced.

### Audio profiles and fatigue budget

- Genre is cosmetic state. `shared/audio/score.ts` may derive notes only from
  the race summary, the explicit genre, and `COSMETIC.music`; it must never
  consume simulation RNG or change `SIM_VERSION`.
- Keep one score and one `BaseAudioContext` scheduler for both live playback and
  offline export. A voice or profile implemented only in one path is incomplete.
- A genre owns its tempo/grid, harmony, rhythm, arrangement, and voice recipes.
  Shared code still owns exact video duration, event SFX, tension planning, and
  lights-out alignment. Every note/effect must begin and finish inside the file.
- Broadband ambience must be finite. Crowd sound is represented as bounded
  swells with stopped sources and audible rests, not a low-gain loop that spans
  the race. Do not “fix” fatigue by merely lowering a continuous noise floor.
- Persist only a validated genre ID. Switching profiles during playback rebuilds
  the cosmetic score and rejoins at simulation time; export must use the same
  selected ID even when preview sound is muted.
- Keep automated determinism/grid/duration/level coverage, but record subjective
  listening honestly. Peak/RMS checks cannot establish that a mix is pleasant on
  phone speakers or non-fatiguing over several consecutive races.

## Verification

From the project directory:

```bash
npm run check
npm test
npm run build
```

On Windows PowerShell where `npm.ps1` is blocked:

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run build
```

Also run `git diff --check` before handoff. The build currently emits expected
warnings about Tailwind sourcemaps and the large Three.js chunk; a warning is not
the same as a failed build.

For repeatable B1 browser measurements, build and start the production server,
then run `npm run benchmark:browser -- --quality=1080p30`. The dependency-free
harness also accepts `1080p60`, `--cpu-throttle=4`, `--hardware-concurrency=4`,
`--mode=low-power`, `--mode=swiftshader --probe-only`, and
`--genre=dnb|kids|rock`. Never label a
throttled or low-power run as a different physical laptop; record the actual
GPU string returned by the harness.

### Manual UI matrix

- 320–390px portrait phone viewport.
- Phone landscape.
- Desktop at ordinary and narrow window widths.
- Expand/collapse the timing tower during a race and after finishes begin.
- Enter and exit native fullscreen where supported.
- Exercise the immersive fallback where native fullscreen is unavailable.
- Let auto-next complete, toggle it off/on, hide and restore the tab, replay,
  open Export, and start a manual new race near the end of the countdown.
- Run several consecutive races and watch for growing GPU memory or lost WebGL
  contexts.
- Confirm preview audio and exported audio remain aligned after a transition.
- Audition DnB, Kids, and Rock on phone speakers and headphones; switch genre
  during a race, reload to confirm persistence, and inspect/decode one exported
  AAC track for each newly changed profile.
- Confirm trackside attribution is legible without obstructing the pack and the
  outro card remains title-safe in portrait and landscape.
- Extract at least one sign frame and one outro frame from an actual MP4; HTML
  inspection alone cannot prove video attribution exists.

## Checkpoint protocol

Update `docs/CURRENT_WORK.md` at each stopping point with:

- date and objective;
- completed behavior, not just filenames;
- files intentionally touched;
- exact automated checks and results;
- manual checks performed or still outstanding;
- known risks and assumptions;
- the next smallest safe implementation step.

Keep this document vendor-neutral. If a workflow requires a particular external
tool, also describe the underlying standard action so a different contributor
can continue without that tool.
