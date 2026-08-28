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
renderer-free contract. The desert mine is the reference selector and the
glacier ice cave proves the same selector can safely carry different dressing:

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

The selector must return `null` rather than force a mine onto an unsafe future
track grammar. Never make an ordinary prop intersect and call the overlap a
tunnel after the fact. A new cave, ruin, mountain, or planet should reuse this
contract and extend its pure tests before it adds renderer dressing.

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
