# Canicarrera — handoff

**Read this first.** `PLAN.md` is the strategy and still accurate; this file is
where the code actually is.

*Last session: 2026-08-01. Stage 0 / "Phase 1" is built, under version control,
and pre-flight-checked for deploy. **Not deployed yet.***

## Version control

`github.com/CVilla90/canicarrera`, public, branch `main`. Initial commit
`d36c63a` covers all of Stage 0.

⚠️ **`gh` on this laptop is authed as the work account `carlosvilla-creai`** —
never use it to write here. Push over the ssh alias:
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
| Track generator | 0 self-intersections in 150 seeds; all 5 archetypes, all 6 palettes appear |
| Export correctness | 720p30, 2048 frames, **68.27 s** of video — exactly `endTime + 4.5 s` |
| Export container | `ftyp isom`, `moov` **before** `mdat` (fast start), 39.6 MB ≈ 4.9 Mbps vs 5 Mbps target |
| Export speed | **460 frames/s** at 720p30 — a 68 s video exported in **5 s** |

`npm test` is 21 checks and takes a few seconds. Run it after touching anything
in `shared/`.

⚠️ **The 460 fps figure was measured in a Chrome tab that was *hidden*** (the
automation harness never foregrounds it). Real foreground throughput on the
3070Ti should be at least that. Task **B1 still wants a real foreground
measurement**, and a SwiftShader run for the Stage 1 estimates.

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
| B1 benchmark | ⚠️ partial — export measured, but from a hidden tab; no SwiftShader number yet |
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

### 🔴 Known incomplete: surface world colour grading

**The three surface worlds are structurally correct but visually washed out** —
low contrast, everything drifting toward a pale wash. The orbit worlds are
unaffected. Ruled out by measurement, so do not re-test these:

- **Not the fog.** Pushing it to 100000/200000 changed the hills by ~1 value.
- **Not the key light.** Sweeping 1.5 → 0.5 moved the track pixel 206 → 190.
- **Not the env map.** Disabling `scene.environment` moved it ~12 values.
- **Partly the palette design, now fixed:** the first jungle had a *green sky*
  over green fog over green terrain — sky and fog cover most of the frame, so
  the result was monochrome soup. Skies are blue now.
- **Partly exposure, now plumbed:** ACES begins `color *= exposure / 0.6`, a
  1.9x boost, so any mid-tone lands near white. Orbit worlds never showed it
  because they are nearly black. `Palette.exposure` is now per-world (orbit
  1.15, surface 0.5). This helped but did not finish the job.

⚠️ **The measurement method itself became unreliable at the end** — a terrain
pixel read as lit with every light at zero, which is impossible for a
`MeshStandardMaterial`. Suspect canvas readback across separate JS evaluations:
`preserveDrawingBuffer` plus the PostFX composite means `readPixels` can return
a stale or already-swapped buffer. **Always `s.draw()` immediately before
`readPixels`, in the same evaluation**, and prefer tagging surfaces with
distinct flat colours over reading single pixels — that is what finally proved
the terrain, not the sky, fills the frame.

Next thing to try: render one surface world with `toneMapping = NoToneMapping`
and no PostFX to see the raw linear values, which removes both suspect layers at
once.

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
- Audio, accounts, YouTube upload, admin panel — Stage 1+.

## Known issues

1. **Capability probe vs. real throughput.** The first version timed
   `encoder.flush()` inside the measured window, which made it ~15× pessimistic
   (it promised 1 min 12 s for an export that took 5 s). Fixed: flush is now
   outside the timing, there is a full-pipeline warm-up, and 30 frames are
   timed. **This has not been re-verified in a foreground tab** — the probe now
   refuses to run while `document.hidden`, so the automation harness cannot
   measure it. Check the number on the button against the real export once.
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
5. **No mobile or Safari testing at all.** PLAN §R3b calls frame pile-up the
   most likely bug in the project, and the device where it bites is a mid-range
   Android. The backpressure is written and works on desktop; it is unproven on
   a phone.

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

1. **Deploy** (W10) — the only remaining step is on Replit's side.
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
3. **B1 — re-check the export ETA against a real foreground export.** Now the
   input to the entire quality ladder, not just a loose end. Telemetry already
   records `predicted` next to the real elapsed time on every `export_finished`
   event, so one real export answers it.
4. Then Stage 1 **audio** (a silent race video is a weak YouTube upload), and
   **billboards** — scene objects, not a DOM overlay, because the MP4 is what
   gets shared and a CSS watermark never reaches it.

## Roadmap detail added 2026-07-27 (design only, nothing built)

`PLAN.md` gained four sections from a design conversation at the end of the
session. Nothing in them is implemented; they exist so the next session does not
re-derive the constraints.

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
  cheap honest substitute**; billboards must be scene objects because the MP4 is
  what gets shared, and the first reason to build them is attribution, not ads.

The one item there that would need a `SIM_VERSION` bump is **banking**. Emitting
collision events for SFX would not.
