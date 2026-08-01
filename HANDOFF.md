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

## Deliberately not built

- **Tier C** (browsers with no `VideoEncoder`, i.e. Firefox Android): the
  `FrameEncoder` interface exists and `WebCodecsEncoder` implements it, so a
  WASM encoder slots in without the export loop changing. It is **not**
  implemented. Those browsers currently get an honest message and a copyable
  link, not a broken button. Per PLAN §2.3, check telemetry before spending a
  weekend on it.
- **Tier D** (server render): stubbed at the API only.
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
   memory (PLAN §R3b).
3. **Re-check the export ETA** against a real foreground export (issue 1 above).
4. Then Stage 1: audio first (a silent race video is a weak YouTube upload), or
   tier C if telemetry says people are hitting it.

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
