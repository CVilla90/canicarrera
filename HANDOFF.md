# Canicarrera — handoff

**Read this first.** `PLAN.md` is the strategy and still accurate; this file is
where the code actually is.

> **Latest checkpoint: 2026-09-03.** Attribution, fatigue-safe multi-genre audio,
> terrain/large-scenery clearance, typecheck, **126/126 tests**, and the
> production build pass. The built server
> passed a local deployment simulation. Real production-UI 1080p30/60 exports
> on the RTX laptop, Kids/Rock AAC exports, and a forced-SwiftShader probe are
> measured and decoded; only a real mid-range laptop remains for B1. Deployment
> and phone/Safari QA remain open. Exact evidence is in
> `docs/CURRENT_WORK.md`.

*Earlier baseline (2026-08-02): Stage 0 was built and pre-flight-checked; that
session added **audio**, **characters**, and the **mobile/iPhone** fixes, and
solved the surface-world grading bug that had been open since 2026-08-01.
**Still not deployed** — that remains the one blocking step.*

## Version control

`github.com/CVilla90/canicarrera`, public. `main` contains the older published
baseline; active uncommitted work is on `feature/attribution-billboards`, based
on jungle-ruin commit `a081f29`. The jungle branch is pushed; this attribution
branch is local only. Commit `b4a31e8` preserves the complete pre-tunnel
checkpoint before the mine implementation.

⚠️ The stored `gh` tokens on this laptop are stale. Push over the personal SSH alias:
`git@github-personal:CVilla90/canicarrera.git` (already set as `origin`). The
repo-local identity is the CVilla90 noreply address; global git stays the work
email, so **never commit here with `--global` identity assumptions**.

---

## What works, with numbers

The whole loop is real: open the page, a curated race is invented, it plays, you
export an MP4.

| Verified | Measurement |
|---|---|
| Determinism | same seed → byte-identical spec and identical finish times, 100× |
| Realtime == export | stepping the sim raggedly matches a straight run exactly |
| Curation | mean score **0.796** curated vs **0.506** uncurated, 20 candidates |
| Curation cost | **~150 ms** worst case for 20 candidates (this laptop) |
| Race durations | mean **55.5 s**, no DNFs across 120 seeds |
| Track generator | 0 self-intersections in 150 seeds; all 5 archetypes and all 9 worlds appear |
| Export correctness | 720p30, 2048 frames, **68.27 s** of video — exactly `endTime + 4.5 s` |
| Export container | `ftyp isom`, `moov` **before** `mdat` (fast start), 39.6 MB ≈ 4.9 Mbps vs 5 Mbps target |
| Export speed | **460 frames/s** at 720p30 — a 68 s video exported in **5 s** |
| Soundtrack | DnB/Kids/Rock deterministic profiles; finite crowd swells; two new 1080p AAC exports decode cleanly and peak at −3.0/−2.2 dBFS |
| Surface worlds | the pale-wash bug is **fixed** — same pixel 192,187,137 → 46,96,24 |

`npm test` is currently **126 checks** and takes a few seconds. Run it after touching
anything in `shared/`, `client/render/` or `client/audio/`.

The current B1 matrix includes real RTX-laptop 1080p30/60 exports and a
positively identified SwiftShader probe at **3.089 full-pipeline fps**. The 4×
CPU-throttled results remain an approximation; only the physical mid-range
laptop measurement is outstanding.

## Run it

```bash
npm install
npm run dev     # vite :5173 (proxies /api) + api :5000
npm run build && npm start   # the way it deploys: one process on :5000
npm test        # determinism / generator / curation
npm run check   # tsc --noEmit
```

`window.__canicarrera` is a live handle on the `RaceScene` in any build — handy
when something in the frame loop misbehaves.

## Plan tasks: where each one landed

| Task | State |
|---|---|
| B1 benchmark | ⚠️ partial — real foreground 720p measured; 1080p30/60, mid-laptop, and SwiftShader remain |
| W1 seeded RNG, split streams | ✅ asserted by tests |
| W2 modules | ✅ `shared/` · `client/scene` · `client/export` · `client/ui` · `server/` |
| W3 Vite + TS + npm three | ✅ three 0.185, `outputColorSpace` / ACES tone mapping |
| W4 offline render loop | ✅ `renderFrameAt(time, dt)`, no clock anywhere in it |
| W5 WebCodecs + mp4-muxer + backpressure | ✅ `encodeQueueSize` high/low water, verified output |
| W6 generator + pre-sim curation | ✅ 5 archetypes, 8 segment kinds, scorer in `shared/curate.ts` |
| W7 capability probe + honest ETA | ✅ built, ⚠️ see "known issues" |
| W8 job API | ✅ always answers `mode:"client"`; client already speaks the protocol |
| W9 UI/UX | ✅ Spanish-first broadcast HUD |
| W10 Replit deploy + phone/Safari smoke test | ⚠️ **not published** — `.replit` written, repo pushed, deploy path verified locally (see below); the Replit half is untouched |
| W11 telemetry | ✅ writing; no panel (as planned) |

## Render presets and the quality ladder (added 2026-08-01)

**The strategic call: there is no server-side render, ever.** Path B (Blender /
Playwright / SwiftShader) is **cancelled** — it was the only component that
would have cost money per video, and it was never buying quality the client
cannot reach. Everything below runs on the user's GPU at $0 to us.

Two independent axes, deliberately not conflated:

| Axis | Owner | What it controls |
|---|---|---|
| **Video format** | `client/export/quality.ts` | resolution, fps, bitrate |
| **Visual preset** | `client/render/presets.ts` | bloom, IBL, materials, supersampling, motion blur |

Four presets — **Ligero / Estándar / Alto / Ultra**. New files:

```
client/render/presets.ts      the four presets + drawCost(). All data.
client/render/cost.ts         pure cost arithmetic — no DOM, so npm test covers it
client/render/budget.ts       the ladder + planForBudget()
client/render/PostFX.ts       HDR pipeline: accumulate -> bloom -> ACES -> canvas
client/render/environment.ts  procedural PMREM env map, per palette, zero bytes
```

### The three rails

1. **A preset can never touch the sim.** Nothing in `presets.ts` is an input to
   `RaceSpec`, `RaceSim` or curation. Same seed is the same race on a phone and
   on a workstation; only pixels differ. `SIM_VERSION` is still 1 and share
   links are unaffected. A test asserts no preset field shares a name with a
   spec field.
2. **Everything is data.** Retuning or reordering presets, budgets or the
   ladder is an edit to one array. No logic enumerates them.
3. **Nothing costs us anything.** No server render, no downloaded assets — the
   environment map is generated, not fetched.

### Why the exported MP4 can look better than the preview

The export loop has no clock, so a frame may cost ten times a realtime frame.
**Supersampling (2x) and accumulation motion blur (N sub-frames averaged) are
export-only** and are what separate a game from a render. Bloom, IBL and
materials apply to both, so the preview still shows what you will get.

### The UX inversion

The user picks **how long they will wait** (Rápido 10 s / Equilibrado 30 s /
Máxima calidad 120 s) and `planForBudget` returns the richest ladder rung that
fits. Manual overrides for both axes live in the advanced panel, every option
selectable, **each showing its own honest ETA in parentheses** computed against
the current setting of the other axis. Touching either axis clears `auto`; a
"volver a lo automático" link brings it back.

The ladder's taste judgement, written as a plain list so it can be re-ordered:
**past 1080p, shading beats pixels.** It climbs to 1080p60, spends the next
budget on presets, and only reaches 1440p/4K once Ultra is affordable.

### The cost model now uses both measured numbers

`rasterFps` was measured and thrown away before. It is now load-bearing:

```
seconds = frames * (drawSeconds * pixels * drawCost + encodeSeconds * pixels)
```

Supersampling and motion blur multiply the **draw** only — the encoder still
receives exactly one frame per output frame. Charging preset cost to the whole
pipeline would badly over-estimate Ultra on machines with software encoders,
which are exactly the machines that most need the number to be right.

## Worlds and the open channel (added 2026-08-01)

Nine worlds now, in two families. `shared/palette.ts` is the whole definition;
`client/scene/World.ts` renders it.

| Family | Worlds | What it is |
|---|---|---|
| `orbit` | neón, cítrico, hielo, magma, bruma, arcade | star field, no ground, **sealed glass tube** |
| `surface` | **jungla, desierto, glaciar** | gradient sky, terrain, scenery, motes, **open channel + F1 kerbs** |

- **Terrain follows the track down.** These courses drop 40 m+, so a flat plate
  at any single height is wrong everywhere else — at the lowest point the first
  half of the race happens in empty sky; at the start the finish is buried.
  `groundHeightAt()` samples the track's own spine and eases out to a base level
  with distance.
- **The channel is a rendering choice only.** The sim is 1-D along the spline
  with an angular position in the barrel and has no concept of a ceiling. Marble
  theta is `lane*0.55 + sin(t)*swayAmp`, so ±~1 rad; `CHANNEL_ARC = 1.95` leaves
  real margin. Narrow it below ~1.2 and marbles appear outside the geometry.
- `GENERATOR_VERSION` → 2, **`SIM_VERSION` still 1.** `meta.pick()` draws once
  regardless of list length and palette only feeds marble saturation/lightness,
  so every seed keeps its archetype, track, physics and winner — only the world
  changes. `?r=<id>` links replay byte-identically.

### Desert mine set piece (added 2026-08-27)

`client/scene/SetPieceLayout.ts` is a pure, serialisable contract between a
generated track and intentional geometry. The desert renderer consumes it in
`World.ts`; the simulator never sees it.

- It prefers a 30 m declared straight and falls back no shorter than 14 m.
- Candidate samples must keep within 9° of the tunnel axis, fit the chute inside
  a 6.4 m interior, fit the chase camera inside a 5.5 m envelope, and keep every
  non-local track section outside the 8.25 m rock shell.
- The mine reserves its interval and both approaches before dunes are placed.
  Each dune's own footprint is included in that exclusion.
- The renderer uses open faceted cylinders rather than CSG: outer shell, inner
  lining, two portal rims, instanced wall ribs, and seeded point lights.
- 60 tracks (12 per grammar) all select a valid, byte-identical-per-seed mine.
  The suite found zero chute/camera/track/prop violations and retained 5,379 of
  5,400 dunes overall; the sparsest compact helix retained 91.1%.
- Headless production frames for `MINEVIEW16` caught square roof beams crossing
  the camera view. Replacing them with wall-hugging ribs fixed the approach and
  interior composition. A subsequent full foreground run and real 720p30 export
  with audio verified that fix through the encoded output. This is why interior
  objects need bounds too — proving the wall clears the camera is necessary but
  not sufficient.

### Glacier ice-cave set piece (added 2026-08-27)

The second vertical slice reuses the candidate search in
`client/scene/SetPieceLayout.ts` through a profile rather than copying the mine.
It has its own cosmetic stream and a wider authored shell, while keeping the
same grid/finish, chute, chase-camera, and non-local-track safety direction.

- It prefers a 30 m straight, falls back no shorter than 14 m, declares a 7.35 m
  interior, 9.5 m outer shell, and 5.5 m camera envelope, and returns `null`
  when a future course has no honest interval.
- Every crystalline ridge, glow, and icicle is serialisable contract data.
  Icicles anchor to the straight set-piece axis and carry a measured bound that
  stays at least 0.35 m outside the camera envelope.
- Both mines and caves now reserve the shell plus approaches from spectators.
  Character placement relocates to the nearest safe arc without consuming RNG,
  or skips the character when no side fits.
- 59 of 60 representative glacier tracks select a distinct deterministic cave;
  the one compact helix that cannot clear the wider shell safely returns `null`.
  All 7,080 requested ice shards remain, with zero reservation violations.
- Headless frames for `ICEVIEW5` found a seal inside the first cave draft. The
  spectator contract fixed it. A subsequent visible focused run captured five
  real-time traversal frames, and Edge completed a 44,512,875-byte 720p30
  H.264/AAC download. FFmpeg decoded it cleanly and encoded frames match the
  preview without the HTML HUD.

### Jungle ruin set piece (added 2026-08-27)

The third surface slice uses `${COSMETIC.setPieces}:jungle` and the same profile-
driven selector. Its conservative 9.15 m exterior reserves non-local track,
trees, and spectators even though the renderer deliberately leaves the space
between arches open to daylight.

- All 60 representative jungle tracks select distinct, deterministic safe
  ruins. All 9,000 requested trees remain; there are zero ruin/approach
  intersections and the tightest extra prop margin is 0.19 m.
- Arches, broken wall stones, hanging vines, and warm/green glyphs are pure
  contract data. Stone and vine radii measure at least 0.54 m and 0.35 m beyond
  the complete camera envelope in the final suite.
- The first production pass had a continuous dark shell. It passed every
  clearance test but read as a brown tunnel. Removing that shell produced an
  open weathered colonnade with visible jungle between the ribs; the bounded
  stone/vine density was raised to keep the ruin legible.
- A visible focused `RUINQA105` run captured approach through departure with no
  spectator in the reserved arc. Edge then completed a 42,456,920-byte 720p30
  H.264/AAC download. Its 2,014 video frames, 67.133 s video, 67.136 s audio,
  fast-start atoms, and both streams decode cleanly; extracted frames match the
  corrected foreground view without the HTML HUD.

### In-scene video attribution (added 2026-08-29)

- `client/branding.ts` is the only source for the scene-rendered brand, creator
  credit, and destination. It currently points at the public GitHub repository;
  replace that object when a public deployment URL or credit changes.
- `client/scene/AttributionLayout.ts` selects two or three buffered segment
  landmarks with `COSMETIC.billboards`, serialises the upstream-facing basis and
  complete bound, yields to authored set-piece intervals, and reserves props and
  spectators before either is placed.
- `client/scene/Attribution.ts` consumes that contract as instanced scene boxes
  with local 2:1 canvas textures. A square camera-attached scene card fades in
  from simulation time during the outro, so preview and MP4 share one path.
- The 540-layout suite covers all worlds and grammars: 539 layouts fit three
  signs, one honest compact-jungle case fits two, all 21,600 requested surface
  props remain, and the tightest extra prop margin is 0.17 m.
- Production Edge exported `ATTRQA01` through the real UI at 720p30 Estándar
  with audio: 2,121 H.264 frames, 70.700 s video, 70.720 s AAC, 44,132,927 bytes,
  and a complete browser download in roughly 12 s. FFmpeg decoded both streams;
  extracted sign and outro frames preserve the canvas composition and omit the
  HTML HUD.
- Pixel inspection caught and corrected the first pass: a square canvas mapped
  onto a 2:1 sign stretched the type and exposed too much gold backing. Canvas
  and plane aspect ratios now match.

No physics or race-spec field changed. `SIM_VERSION` and `GENERATOR_VERSION`
remain unchanged.

### ✅ SOLVED 2026-08-02: surface world colour grading

**It was `PostFX`, and it was one line.**

`WebGLRenderer.render()` sets the renderer's clear colour from
`scene.background` on every call. `PostFX.renderSubFrame` renders the scene into
the HDR buffer *and then* clears the **accumulator** — by which point the clear
colour is the sky. So the accumulator was being filled with the horizon colour
and the scene additively blended on top of it. Every frame started with the sky
already added to it.

That explains every observation, including all the ones that were ruled out:

| Measured | Result |
|---|---|
| Same pixel, bloom preset | **192,187,137** (pale) |
| Same pixel, no PostFX | **46,96,24** (saturated) |
| Same pixel, bloom preset + black accumulator clear | **46,96,24** ✅ |
| Fog disabled | no change — fog was never it |
| `scene.environment` disabled | 4–10 values — the env map was never it |
| Bright-pass threshold swept 0.85 → 6.0 | 192 → 188 — bloom was never it |

The orbit worlds were unaffected because their `background` is nearly black, so
the wrong clear added almost nothing. That is exactly why the symptom looked
like a *grading* problem in the three surface worlds specifically.

`PostFX.clearTarget()` now forces transparent black around every clear and
restores the renderer's colour afterwards. The fix is in the one file that
already carried the doctrine "every clear in this file is explicit" — it just
was not explicit about the *colour*.

⚠️ **The readback rule from the failed investigation still stands and is what
made this findable:** always `s.draw()` immediately before `readPixels`, **in
the same JS evaluation**. `preserveDrawingBuffer` plus the composite means a
readback in a later evaluation can return a stale or already-swapped buffer,
which is what made the earlier measurements self-contradictory.

**The lesson worth keeping: three separate investigations correctly ruled out
fog, lights and the env map, and all three were right.** The thing none of them
tested was the code doing the compositing, because it had recently been reviewed
and looked correct. `autoClear` had already been caught in that same function
once (see below). A clear that is explicit about *when* can still be wrong about
*what*.

## Audio (added 2026-08-02; profiles expanded 2026-08-29) — shipped

The race has a soundtrack: **procedural DnB, children's music, or rock arranged
to the race, plus sound effects and a crowd.** It is optional, off by default in
the preview, and on by default in the exported file.

```
shared/audio/score.ts     seed + sim events -> a timed Score. Pure, node-tested.
client/audio/synth.ts     Score + BaseAudioContext -> nodes. ONE scheduler.
client/audio/director.ts  live playback: gesture unlock, lookahead scheduling
client/audio/render.ts    OfflineAudioContext -> AudioBuffer -> AAC -> muxer
client/lib/yield.ts       the unthrottled yield, now shared with the video loop
```

### The three rails

1. **One scheduler, two contexts.** `scheduleScore` takes a `BaseAudioContext`,
   so live playback (`AudioContext`) and export (`OfflineAudioContext`) run the
   *same* code. PLAN §5.1 warns that export runs faster than realtime and live
   output cannot be recorded; two schedulers would be that same bug with extra
   steps.
2. **Nothing is sampled.** Every sound is oscillators, filtered noise and
   envelopes. No assets, nothing to 404, and — the commercial reason — **no
   recording for YouTube's Content ID to match**, which PLAN §5.1 names as the
   real risk rather than licensing.
3. **The score cannot touch the sim.** Cosmetic RNG stream (`COSMETIC.music`),
   same seed + genre → same soundtrack, `SIM_VERSION` still 1.

### It is arranged *to* the race, not under it

174 BPM, bar = 1.379 s. `BAR_ZERO = COUNTDOWN - 2 * BAR = 0.241 s`, so two intro
bars end **exactly** on lights-out and the drop lands on the frame the lights go
out — asserted in `npm test`, not eyeballed. Bar energy follows a 16-bar genre
cycle *and then* the race overrides it: a bar where the front two are fighting is
a drop bar whatever the cycle says, and the last four bars before the finish
always are. `RaceSim` now emits a **tension curve** for this, sampled in the
existing 5 Hz metrics pass.

### Fatigue fix and genre profiles (2026-08-29)

The reported static was real: `scheduleCrowd` ran one looping broadband-noise
source across the whole file. The score now describes short crowd swells tied to
lights-out, sufficiently tense battles, and the finish. Each source stops, lasts
at most 2.7 seconds, and leaves at least 0.8 seconds of silence before the next.

The remembered bilingual selector chooses `dnb`, `kids`, or `rock`. Each profile
owns its own BPM/grid, harmony, patterns, and procedural voices, but all three
share exact race duration, event SFX, tension planning, and one live/offline
scheduler. Kids and Rock were selected through the production UI and exported
at 1080p30 with AAC; both decoded completely and remained below full scale.
Subjective phone/headphone audition is still required—metrics cannot prove that
a timbre is pleasant.

### Verified, with numbers

| Check | Result |
|---|---|
| Score determinism | same seed → byte-identical score |
| Drop alignment | `BAR_ZERO + 2*BAR` == `COUNTDOWN`, exactly |
| Offline render | 80 s of stereo 48 kHz in **17 s** (hidden tab — see ⚠️) |
| Dynamics | intro RMS **0.022**, drop RMS **0.28** — the drop is real |
| Clipping | **0 samples** over full scale, peak 0.974 |
| Real MP4 | `ftyp` → `moov`(`vide`/`avc1` + `soun`/`mp4a`/`esds`) → `mdat` |
| Round trip | `decodeAudioData` on the finished file: **79.94 s** stereo vs **79.93 s** of video |

### Two performance findings worth keeping

🔴 **The cost of an offline audio render is graph size, not DSP.** Measured
per-voice, a two-oscillator bass note cost the same per node as a filtered noise
burst — ~7 ms per node, uniformly. So the drums were rebuilt the way a drum
machine works: each (voice, velocity) pair is baked once into a small buffer by
plain arithmetic, and a hit is **one `AudioBufferSourceNode`**. The 492 hats in a
75-second race went from **10.6 s to 2.3 s**; the whole score from **45 s to
17 s**. Baking without the per-voice levels the live voices had applied pushed
the drop to a peak of 1.21 with 86 clipped samples, hence `DRUM_LEVEL` and the
master soft-clipper.

🔴 **`setTimeout` in the audio encoder was a hang, not a slowdown.** A background
tab clamps nested timeouts to **one second**, and a 70-second file is ~3300
chunks. An export left in another tab sat in the `audio` phase indefinitely. The
video loop had always used a `MessageChannel` yield for exactly this reason;
`client/lib/yield.ts` is now that helper, shared by both. **An export is the
thing a user starts and then switches away from — a background tab is the normal
case here, not the edge case.**

⚠️ **Every absolute timing above was measured in a hidden tab** (the automation
harness never foregrounds it), which this project has now been bitten by three
times. The *ratios* are sound — both sides of each comparison were measured the
same way — but treat the seconds as an upper bound. **A real foreground export
with audio is still unmeasured.**

### Not built

Commentary (PLAN §5.1's clip pool). The event stream and the cosmetic RNG it
needs are both in place; it is a recording job, not an engineering one.

## Characters (added 2026-08-02)

`client/scene/Characters.ts` — seven species, built from primitives only:

| World | Cast |
|---|---|
| jungla | monkey, toucan |
| desierto | **snake**, cactus |
| glaciar | penguin, seal |
| the six orbit worlds | a hovering robot |

- **Every character is drawn to be liked.** One shared `face()` gives all of them
  oversized eyes with a highlight and an actual smile, so no species can end up
  looking cold by accident. The desert snake is a coil with a big grin and a
  comically small tongue — a character who happens to be a snake, not a threat.
- **They react to the race.** Excitement is `1 - |leaderS - characterS| / 26`, so
  arms go up and the hopping speeds up as the pack arrives, and the robot's
  antenna brightens. Driven by **sim time**, never a wall clock, so the exported
  video matches the preview frame for frame.
- **Placement is on a cosmetic stream keyed on the race seed**, so a shared link
  puts the same penguin on the same rock — but adding a character can never shift
  a marble's luck.
- **They stand on plinths at track height.** Surface worlds put the terrain 11 m
  below the chute; a character standing on the ground would be a speck at the
  bottom of a shot framed on the marbles. Surface plinths get a support post
  running down into the fog; orbit ones float.
- **Cost:** geometry and materials are shared per species, so eight penguins are
  one sphere. They are separate `Group`s (they animate independently) and three's
  frustum culling means the ones behind the camera are free.
- ⚠️ The plinth uses `palette.trackColor`, **not** `palette.ground`. The jungle's
  terrain is `0x24491f` — near-black — and a plinth painted with it put a dark
  green character on a dark green disc in a dark green world.

## Mobile and the iPhone report (added 2026-08-02)

A tester on an iPhone reported the page "getting stuck" and "restarting". Both
symptoms have one root cause and it is not a single bug: **nothing in the render
path had a memory budget.**

- **"Stuck" = a lost WebGL context.** iOS Safari drops the context under memory
  pressure and the canvas then holds its last frame forever, while the HUD keeps
  updating from the sim. There was **no `webglcontextlost` listener at all**, so
  this was permanent. `RaceScene` now handles both events (`preventDefault` is
  mandatory, or the context never comes back), rebuilds the race from its spec on
  restore, and the UI says so.
- **"Restarting" = the tab being reloaded** by iOS Safari under memory pressure,
  which comes back at the start of a new race.

What was actually allocating it (`client/render/device.ts`):

| Fix | Why |
|---|---|
| `postFXBudget` per device | `PostFX.isSupported` only ever checked for the **extension**, never for room. 1080p at 2x supersampling is **166 MiB** of half-float targets; 4K Ultra is **664 MiB** |
| `affordableSupersample()` | Drops 2x → 1x when it will not fit. Costs a little edge softness; saves the tab |
| Probe at a device-appropriate resolution | The preset probe benchmarked **every** preset at 1080p **during boot** — allocating the full 4K supersampled chain on a phone before the user had watched anything. Phones now measure at 720p, normalised back to 1080p by `pixelFactor` |
| `maxPixelRatio` per device | An iPhone reports 3. A full-screen canvas at 3x is nine times the pixels of 1x, and `preserveDrawingBuffer` means we hold two of them |
| Debounced resize, deaf to the URL bar | iOS fires `resize` every time the URL bar slides. Each one reallocated the drawing buffer. Now ignores height-only changes under 80 px and settles for 220 ms |
| `boot()` / `newRace()` wrapped | An unhandled throw left the "Inventando la carrera" overlay up forever — the same *symptom* as a lost context, from a different cause |

⚠️ Capability cache bumped to **v4**: the numbers mean the same thing but are no
longer produced the same way, so old entries are discarded rather than
reinterpreted.

⚠️ **Desktop budget is 768 MiB, chosen against the real numbers.** At 512 MiB the
top rung of the ladder (4K Ultra, 664 MiB) would have been silently clamped on
every desktop. The guard exists to stop a phone reloading, not to quietly
downgrade a workstation that asked for Ultra.

### The timing tower collapses on a phone

Eight rows is ~240 px — a third of a phone screen, permanently covering the race
it reports on. It now shows the leader plus `▾ +7` on narrow viewports and the
full list on desktop, one tap either way. Measured in a 390 px same-origin
iframe (`resize_window` is dead in this automation browser): **73 px collapsed
vs 327 px expanded, 17 px clearance from the wordmark, no horizontal overflow.**
The wordmark also shrinks below `sm` — at 390 px the two used to overlap.

## Deliberately not built

- **Tier C** (browsers with no `VideoEncoder`, i.e. Firefox Android): the
  `FrameEncoder` interface exists and `WebCodecsEncoder` implements it, so a
  WASM encoder slots in without the export loop changing. It is **not**
  implemented. Those browsers currently get an honest message and a copyable
  link, not a broken button. Per PLAN §2.3, check telemetry before spending a
  weekend on it.
- **Tier D** (server render): stubbed at the API only, and now **cancelled as a
  direction** — see the quality-ladder section above. The API stub stays because
  the client already speaks the protocol and removing it buys nothing.
- Commentary, accounts, YouTube upload, admin panel — Stage 1+.

## Known issues

1. **Capability coverage is still partial across hardware classes.** Real
   1080p30/60 exports on the RTX laptop and forced SwiftShader are recorded in
   `docs/CURRENT_WORK.md`. A 4× CPU-throttled pair is useful but is not a real
   mid-range-laptop measurement; do not generalise this machine's result.
2. **Race ids do not survive a redeploy.** The registry is in memory
   (`MemoryRaceStore`). That is fine by design — a race is fully recoverable
   from its seed and share links use `?c=<seed>` — but `?r=<id>` links die.
   `RaceStore` is an interface; Postgres slots in when Stage 1 needs it.
3. **Telemetry writes to `data/telemetry.jsonl`**, which is ephemeral on
   Autoscale. It warns about this at startup when `REPLIT_DEPLOYMENT` is set.
   Move to Object Storage or Postgres before relying on the data.
4. **Playback pauses in a hidden tab** (no rAF). Intentional — you should not
   come back to a race you missed. Export does *not* use rAF, so it keeps
   running in the background.
5. **Still no test on a real phone.** The iPhone report is *addressed* — see
   "Mobile and the iPhone report" — but every fix was verified by measurement on
   a desktop and in a 390 px iframe, not on the device that reported the
   problem. The one thing that would settle it is a sustained export on that
   iPhone with the memory budget in place.
6. **Foreground audio is verified only on this desktop.** DnB plus 1080p30 Kids
   and Rock exports with AAC decode cleanly and stay below full scale. A human
   listening pass, lower-power laptop, and the target iPhone sustained export/
   memory check are still required.
7. **The surface-world occlusion fix still needs a broad human viewing pass.**
   `TerrainLayout.ts` now clamps all rendered heightfield-cell corners beneath
   the lowest nearby track branch, and tilted ice shards reserve their complete
   footprint. The 60-layout/48,268-sample pure matrix and a live WebGL boot pass,
   but desert/glacier/jungle foreground viewing and encoded-frame checks remain.

## Things that were subtly wrong and are worth not re-breaking

- **Slope is drop ÷ *real path length*, not horizontal length.** The first
  generator computed drop from horizontal length, so a chicane swinging 9 m over
  34 m had a path 2.4× longer than budgeted and an effective slope a third of
  what was intended. That produced 93-second races and marbles that crawled to a
  DNF. `segmentLength()` must stay honest.
- **The arc-table resolution is part of the physics.** `ARC_SAMPLES` is read by
  the sim to get slope, so changing it changes every race. Curation and playback
  must use the same value. Bump `SIM_VERSION` if you touch it.
- **The chase camera offsets along the track's local up, not world up.** With
  world up, a steep plunge hangs the camera over the drop and the pack slides
  off the bottom of the frame.
- **Sorts are total** (ties broken by id) so engine sort differences cannot
  change a race.
- The tube draws **back faces only**. Both walls stacks the tint twice and puts
  a foggy near wall between the camera and the marbles.
- The wireframe was replaced by **instanced ribs**. A wireframe over the smooth
  tube is ~8000 edges and reads as solid paint; a coarse one reads as a debug
  cage.

### From the render-preset work (2026-08-01)

Three bugs, all of which *looked like they were working*. Each one is a reason
the browser check matters more than the typecheck:

- 🔴 **Never name a GLSL symbol the way three.js names one.** three prepends
  `<tonemapping_pars_fragment>` to **every** `ShaderMaterial` it compiles, which
  already defines `RRTAndODTFit`, `ACESInputMat` and `ACESOutputMat`. Reusing
  those names gave `'RRTAndODTFit' : function already has a body`, the composite
  program silently failed to link, and — because the canvas has
  `preserveDrawingBuffer` — **the previous frame stayed on screen**. The
  screenshot looked perfect. The only symptom was a `GL_INVALID_OPERATION`
  nobody was checking. Every symbol in `PostFX.ts` is now prefixed `cani`.
- 🔴 **`renderer.autoClear` defaults to TRUE**, so the accumulation pass was
  clearing the accumulator immediately before additively blending each sub-frame
  into it. Motion blur would have silently reduced to "the last sub-frame" — no
  error, no black frame, just a video indistinguishable from the cheap preset.
  Every clear in `PostFX.ts` is now explicit and `autoClear` is forced off.
- **An unmeasured machine must not be dropped to the cheapest preset.** The
  preset also drives the *live preview*, and the probe deliberately refuses to
  run in a hidden tab — so anyone opening a shared link in a background tab
  would have permanently seen a worse-looking app. Unmeasured now means
  conservative **resolution** but standard **preset**.
- **Verify a canvas by clearing it to magenta first.** A frame that "looks
  right" may be the last good frame still sitting in the drawing buffer.

## Deploy pre-flight (run 2026-08-01, all green)

The exact commands Replit will run were run locally against the built output,
so a failure on Replit is a *platform* problem, not a code problem:

| Check | Result |
|---|---|
| `npm run build` | clean (2 cosmetic warnings: tailwind sourcemap, 539 kB three chunk) |
| `npm start` → `GET /api/health` | `{ok:true, simVersion:1}` |
| `POST /api/race` cold | **204 ms** including first-request JIT warm-up — inside the 4 s curation budget |
| `GET /` | 200, `Cache-Control: no-store` ✅ |
| `GET /assets/index-*.js` | 200, `public, max-age=31536000, immutable` ✅ |
| `/?c=hola-mundo` and an unknown path | 200 — SPA fallback works |

⚠️ The build needs **devDependencies** (vite, esbuild, tsc). If Replit ever sets
`NODE_ENV=production` before install, the build breaks with a missing-vite
error — that is the failure mode to recognise.

## Next

1. **Deploy** (W10) — still the product-launch blocker and the only way to run
   the real iPhone/Safari check against the intended hosting path.
   🔴 **Use a blank Repl + `git clone https://github.com/CVilla90/canicarrera.git`.
   Do NOT use "Import from GitHub"** — it restructures the repo before any agent
   reads a file, and nothing in-repo can prevent it.
   Then Publishing → Autoscale, **1 vCPU / 2 GiB**, max 1–3. `.replit` already
   carries build/run. `npm install` is deliberately *not* in the build command.
   Confirm the machine-power slider stops match PLAN §1.2 while you are in there
   (risk R2).
2. **Smoke test on a phone and on Safari** — especially a sustained export, watching
   memory (PLAN §R3b). ⚠️ Now more important than before: the presets add
   supersampled half-float buffers. `Alto` at 1080p allocates 2560x1440
   half-float targets, and a phone that survives `Ligero` may not survive that.
   `PostFX.isSupported` gates on the extension, **not on memory**.
   Also verify the trackside credit and square outro at portrait and landscape
   sizes, then inspect actual encoded frames rather than only the HTML page.
3. **B1 — finish the physical-hardware matrix.** 1080p30/60 and SwiftShader are
   measured; a real mid-range laptop remains. Telemetry already records
   `predicted` beside real elapsed time on every `export_finished` event.
4. **Use telemetry to decide the next compatibility spend.** Commentary and the
   no-WebCodecs WASM encoder remain deliberately deferred; neither should jump
   ahead of real device/export data by assumption.

## Roadmap detail added 2026-07-27 (historical design notes)

`PLAN.md` gained four sections from a design conversation at the end of the
session. Audio, worlds, and attribution billboards have since shipped as
described above; commentary and track-family work remain design only. The notes
stay here so later sessions do not re-derive their constraints.

- **§5.1 Audio** — SFX, music and commentary as three consumers of the sim's
  existing event stream. Export runs faster than realtime, so the soundtrack must
  be rendered through `OfflineAudioContext`, never recorded from live playback.
- **§5.1 Commentary** — a **pre-recorded clip pool**, not a voice service: static
  assets keep it at $0 and let it ship with SFX instead of waiting behind Object
  Storage. TTS the pool *once at build time*. The 24-name `MARBLE_NAMES` list is
  fixed, so names can be recorded and concatenated. Because the race is fully
  simulated before rendering, commentary can **anticipate** events rather than
  react to them.
- **§5.1 Music** — drum and bass; arrange *to* the race (drop on lights-out).
  `COUNTDOWN` and `OUTRO` are safe to retune to bar boundaries — neither can
  change who wins. Content ID, not licensing, is the real risk.
- **§3.1–3.3 Worlds, track families, billboards** — biome is a bigger concept
  than palette; an oval fights the physics model and a **banked spiral is the
  cheap honest substitute**; the shipped attribution billboards are scene
  objects because the MP4 is what gets shared, and their purpose is attribution,
  not ads.

The one item there that would need a `SIM_VERSION` bump is **banking**. Emitting
collision events for SFX would not.
