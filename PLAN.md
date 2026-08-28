# Canicarrera — Production Plan

> **Status (2026-08-27): Stage 0 is built and working locally — read
> [`HANDOFF.md`](HANDOFF.md) first.** The proof of concept described below now
> lives in `legacy/`. Everything in §2 (client-side render + WebCodecs export),
> §2.1 (pre-sim curation), §3 (determinism) and §4.3 W1–W9 + W11 is implemented
> and tested. Audio, biome geometry, characters, mobile HUD improvements, and
> deterministic desert-mine, glacier-ice-cave, and jungle-ruin set-piece slices
> also exist on the active feature branch.
> **W10 — deploy and smoke-test on a phone/Safari — is not done.** B1 now has a
> real foreground 720p measurement, but still needs its 1080p30/60, mid-laptop,
> and SwiftShader measurements. This document stays as the strategy; it has not
> been rewritten wholesale to past tense.

*Canica* + *carrera*. Today it is a single-page proof of concept: eight marbles
tumble down a procedurally generated glass chute, the winner is genuinely random
every run, and the whole thing is ~19 KB of vanilla JS plus a vendored three.js.

The product we are building is a **marble race video generator**: you press one
button, a race is invented, and you get a downloadable MP4 you could upload
straight to YouTube. Stage 0 is that loop and nothing else — random track, random
marbles, random duration, one great-looking web app, one MP4 out.

Target platform is **Replit Autoscale**, so this plan starts with what that
platform can actually do, because it constrains the entire architecture.

---

## 0. The decision this plan turns on

Rendering 3D video needs a GPU. **Replit Autoscale has no GPU.** So the first
real question is not "how many vCPUs do I buy" but "whose silicon draws the
pixels." The answer that makes Stage 0 cheap, fast and high-quality is: **the
user's GPU draws the pixels, the server just hands out a seed.** Section 2 has
the numbers behind that, Section 1 has the platform facts behind those numbers.

Everything else in this document is downstream of that call.

---

## 1. Replit cloud capability

### 1.1 What Autoscale actually is

Replit runs on Google Cloud infrastructure. Autoscale Deployments behave exactly
like a Cloud Run service: request-driven, **scale to zero** when idle, scale up
to a configurable max instance count when busy, billed only for the time your app
is actually working. Replit does not publicly document "this is Cloud Run", so
treat that as a strong inference from behaviour rather than a published fact —
but design against Cloud Run's constraints and you will not be surprised.

Practical consequence: **there is no always-on process.** No background worker
loop, no in-memory job queue that survives, no cron inside the app, no local
temp directory that outlives a request. If Stage 1+ needs any of those, they
have to be modelled explicitly (Section 5).

### 1.2 Machine configuration and what a "vCPU" means here

Machine power is set in Publishing → Adjust settings → Machine configuration:
CPU and RAM sliders per instance, plus a max-machines cap.

| | Value |
|---|---|
| Reported ceiling on non-Enterprise plans | **4 vCPU / 8 GiB** ← matches your assumption |
| Enterprise ceiling | up to 64 vCPU / 128 GiB |
| Max machines | configurable; set to 1 for Stage 0 |
| GPU | **none, at any tier** |

⚠️ **Verify the exact slider stops in the Publishing UI before committing** —
Replit's public docs describe the sliders but do not enumerate the tiers, and
the numbers above are assembled from third-party pricing write-ups.

A GCP vCPU is **one hyperthread of a shared Xeon/EPYC core**, roughly 2.2–3.0 GHz,
with no guaranteed instruction-set extensions beyond AVX2 and no clock guarantee.
It is *not* a fast core. Four of them is a modest laptop CPU with no graphics
card — which is the crux of Section 1.5.

### 1.3 The cost model

Published Autoscale pricing:

- **$1.00 / month** base fee
- **$3.20 per million compute units**
- **$1.20 per million requests**

Compute units convert as: **1 CPU-second = 18 CU**, **1 GB-second = 2 CU**.
Deriving the rates that actually matter:

| Unit | Cost |
|---|---|
| 1 CPU-second | $0.0000576 |
| **1 vCPU-hour** | **$0.2074** |
| 1 GB-second | $0.0000064 |
| **1 GiB RAM-hour** | **$0.0230** |
| A 4 vCPU / 8 GiB instance, fully busy for 1 hour | **~$1.01** |
| 1 request | $0.0000012 (noise) |

The Core plan is reported to include ~6,000,000 CU/month of Autoscale allowance.
Hold that number — Section 1.5 spends it.

**Key billing subtlety:** you are billed on the resources *allocated to the
instance* for the duration it is handling work, not on what you actually use.
Provisioning 4 vCPU / 8 GiB "just in case" makes every request ~4× more
expensive than 1 vCPU / 2 GiB, even for requests that use one core. So:

> **Stage 0 should deploy at 1 vCPU / 2 GiB, max 1–3 machines.**
> Save 4 vCPU / 8 GiB for the Stage 1 render worker, which is the only component
> that can actually saturate it.

That is a correction to the opening assumption, and it is worth ~4× on the bill.

### 1.4 Hard constraints to design around

| Constraint | Consequence for us |
|---|---|
| **Ephemeral filesystem** — resets on every publish, not shared between instances | Generated MP4s **cannot** live in the project directory. They go to **Replit Object Storage** (App Storage), or they never touch the server at all. |
| **Scale to zero** → cold starts | First request after idle pays container boot. Keep the image lean; do not load three.js server-side unless a render actually needs it. |
| **Request duration ceiling** | Not publicly documented by Replit. **Assume ~60s and never block a request longer than that.** Anything slower must be job-based: `POST /render` returns an id immediately, client polls `GET /render/:id`. |
| **No persistent process** | No in-memory job queue. Job state lives in Postgres or Object Storage. |
| **No GPU** | See below. This is the big one. |
| **System deps via `replit.nix`** | `ffmpeg` is available as a Nix package. Chromium/Playwright is more work and is a Stage 1 problem, not a Stage 0 one. |
| **Port** | Bind `0.0.0.0:5000`. Replit expects 5000, not 3000. |

### 1.5 What "no GPU" costs a video renderer

Headless Chromium on a GPU-less box falls back to **SwiftShader**, Google's
software rasteriser. SwiftShader is correct and modern — it is not slow because
it is bad, it is slow because a CPU is not a GPU. Reported figures for
non-trivial WebGL scenes are 20+ seconds per frame at high resolution, and our
scene has the specific thing software rasterisers hate most: a **translucent tube
with heavy overdraw** filling most of the frame.

Budget for a 60-second 1080p30 video (1800 frames), server-side, 4 vCPU:

| | Estimate | Notes |
|---|---|---|
| SwiftShader throughput | **3–10 fps** | ⚠️ *estimate, not measured* — see benchmark task B1 |
| Wall clock per video | **3–10 minutes** | far past any safe request timeout |
| Compute units per video | ~26k–90k CU | 4 vCPU × 360s = 1440 CPU-s = 25,920 CU, plus RAM |
| **Cost per video** | **$0.08 – $0.29** | |
| Videos inside the 6M CU allowance | **~65–230 / month** | |
| x264 encode of those frames | not the bottleneck | `-preset veryfast` at 1080p runs several× realtime on 4 vCPU |

Now the same video rendered on the user's machine:

| | Value |
|---|---|
| Renderer | the user's actual GPU, via WebGL |
| Encoder | WebCodecs `VideoEncoder`, hardware-accelerated H.264 |
| Muxer | `mp4-muxer` (or `mediabunny`), pure TS, in-browser |
| Throughput | **~10× faster than realtime** — a 60s video exports in roughly 6–15s |
| Server compute units | **~0** |
| **Cost per video** | **~$0.000001** (one request) |
| Videos inside the 6M CU allowance | effectively unlimited |

Three to five orders of magnitude, in favour of the client, on both cost *and*
wall-clock. That is not a close call.

---

## 2. Architecture: where the pixels get made

### Path A — client-side render + WebCodecs export ✅ **Stage 0**

Server invents a **seed**, client replays it deterministically, renders offline
as fast as the GPU allows, encodes with WebCodecs, muxes to MP4, triggers a
download. The server is a static host with a tiny API.

- Costs nothing, finishes in seconds, quality limited only by the user's GPU
  (4K is realistic on a decent machine).
- Gives you the "watch first, export if you like it" flow **for free** — the
  live race and the export are the same seed replayed at different speeds. This
  is exactly the cheaper option you intuited, and it is also the better UX.
- **Limitation:** needs WebCodecs. Chrome/Edge/Safari 16.4+ are fine.
  Firefox desktop from 130; **Firefox Android has no `VideoEncoder`**. Feature-
  detect and degrade (Section 4.3, W7).

### Path B — server-side headless render 🔜 **Stage 1**

Playwright + headless Chromium + SwiftShader renders frames, ffmpeg encodes,
result lands in Object Storage, client polls for a signed URL.

Slow and ~$0.10–0.30 a video, so it is not the default — but it is the only path
that works for: browsers without WebCodecs, phones too weak to render, **batch /
scheduled generation**, and **direct-to-YouTube upload with no user machine in
the loop**. Build it once Stage 0 ships, behind the same job API from day one so
the client never learns which path served it.

### 2.1 What runs where

The split is not "we offload the hard part onto users." It is:

> **The server does the cheap, valuable thing. The client does the expensive,
> commodity thing.**

| Server owns | Client owns |
|---|---|
| Seed minting + race registry (permanent, shareable IDs) | Sim replay from spec |
| The **generator** and its parameter distributions | Rasterisation (WebGL) |
| **Pre-sim curation** (below) | Encoding (WebCodecs) |
| Quota, rate limiting, abuse control | Muxing → MP4 → download |
| Telemetry ingest (§2.6) | Capability probe |

**Pre-sim curation is the highest-value thing the server does.** The sim has no
rendering — it is 1-D arc-length integration of 8 marbles at 120 Hz, i.e. a few
milliseconds of CPU for a 60-second race. So the server can afford to simulate
**~20 candidate seeds, score them, and return the best one**: lead changes,
finish margin, duration inside the 40–80 s window, no boring runaway. Cost is
roughly 50 ms of CPU ≈ **$0.000003 per race**.

That converts "random race" into *curated* random race for free, and it is the
product's actual IP. GPU work is a commodity; taste is not.

### 2.2 Seed vs spec — the spec is the contract

The server returns a **fully expanded spec**, not just a seed. The seed is the
*input* to generation; the spec is the *output*, and the spec is what gets
stored and shared.

Ship only a seed and any future change to the generator silently breaks every
link anyone ever shared. Specs are immutable, so old races replay forever while
the generator evolves freely. It is ~500 bytes — small enough to live in a URL.

The spec still carries `simSeed` (the wander noise consumes RNG per substep, so
the sim needs a live stream at runtime) and `version` (bump on any physics
change — see §3.4).

### 2.3 The capability ladder

Not "has a GPU / doesn't." Three capabilities that fail *independently*:

| Capability | Who actually lacks it |
|---|---|
| WebGL rasterisation | almost nobody |
| **WebCodecs `VideoEncoder`** | Firefox Android, old Safari — **the real gate** |
| Sustained throughput + memory | weak or thermally throttled phones |

iOS is fine: WebCodecs shipped in Safari 16.4, and every iOS browser is WebKit
underneath, so Chrome-on-iOS inherits it. Android Chrome is fine.

> **Never gate on user-agent.** Gate on `VideoEncoder.isConfigSupported()` plus a
> measured render benchmark. This sidesteps the support matrix entirely.

Only the bottom rung costs us money:

| Tier | Path | Output | Est. export (60 s race) | Our cost |
|---|---|---|---|---|
| **A** | WebCodecs + hardware encode | 1080p60 | ~15–25 s | **$0** |
| **B** | WebCodecs, weak GPU / software encode | 1080p30 → 720p30 | ~40–120 s | **$0** |
| **C** | No WebCodecs → WASM encoder (`mp4-wasm`) | 720p30 | ~3–6 min | **$0** |
| **D** | Cannot render at all | 720p30, queued | minutes + queue | ~$0.05–0.15 |

⚠️ *Estimates. Task B1 replaces them with measurements.*

Tier C is the answer to "do we let them render at their miserable hardware
rate?" — **yes, and it still costs us nothing.** They pay in time; we pay in
nothing. What makes that not feel punishing:

- Drop resolution automatically; never silently attempt something that will fail.
- Real progress: a live thumbnail of the frame being encoded, not a spinner.
- **Let them watch the race at full quality while it exports.** The *watch* path
  is cheap on every device because the sim is trivial. Only *export* is expensive.
- Never auto-export. Sustained export burns battery and heats phones — that is a
  real cost to them, so it must be explicit and opt-in.

**Stage 0 builds tiers A–C and stubs D.** Log the capability probe from real
traffic first; if 0.5% of visitors can't export, tier D isn't worth a weekend.
Decide from data, not from fear.

### 2.4 Choosing quality: two different axes

These get conflated constantly. They are unrelated.

| | Meaning | Who decides |
|---|---|---|
| **Race quality** | is the race *exciting* — lead changes, close finish | **Server**, via §2.1 pre-sim scoring. **Never a user setting** — nobody picks "boring race." |
| **Video quality** | resolution / fps / bitrate | **Benchmark sets the default, user can override.** |

Auto-detect because ~95% of users will never open a settings menu. Always expose
the override, because a misdetected 3070Ti owner is rightly annoyed.

**The benchmark is not a proxy for the ETA — it *is* the ETA.** Export runs
offline, as fast as the machine allows, so measured offline fps → frames ÷ fps →
seconds. Put the honest number on the button:

```
Exportar  ◉ 1080p60  ~18 s      (recomendado para tu equipo)
          ○ 1080p30  ~12 s
          ○ 720p30   ~7 s
          ○ 4K60     ~2 min     ⚠ puede calentar tu dispositivo
```

Two rules: benchmark the **real scene** (the translucent tube is the expensive
part, a synthetic triangle tells you nothing), and measure **rasterisation and
encoding separately**, since they fail independently. Run the probe during the
first race's countdown, while the user is already waiting.

**UI shape:** the measured default is the visible choice; everything else lives
behind a collapsed **"Opciones avanzadas"** disclosure containing the full
resolution/fps/bitrate grid and a **"Volver a medir"** button (re-runs the probe
— useful after closing other tabs, plugging in a laptop, or if the first probe
ran while the machine was busy). Options above the measured tier stay selectable
with their honest ETA and a ⚠️, never disabled. The downside is a slow export or
a warm phone, not a broken one, so let people choose — just don't let the
default make that choice for them.

### 2.5 The streaming constraint (read this before writing the exporter)

One uncompressed 1080p frame is ~8 MB. A 60 s @30 fps video is 1800 frames.
**1800 × 8 MB ≈ 15 GB.** You cannot buffer frames. The pipeline is an assembly
line:

> draw frame → `VideoFrame` → `encoder.encode()` → mux → **release** → next

**The trap:** drawing is usually faster than encoding. Draw 100 frames while the
encoder finishes 10 and the other 90 sit in memory. That pile kills the tab.
Watch **`encoder.encodeQueueSize`** and pause drawing when it climbs past ~10.
Roughly five lines of code; omitting them is the single most likely failure in
this feature. It bites hardest on tier B/C — fast enough to draw, slow to
encode — which is exactly where you least want it. iOS Safari jetsams a tab
around 1–1.5 GB.

**Door closed:** "client rasterises, server encodes" is not viable — the browser
would have to upload that same 15 GB of raw frames. The only payload small
enough to send is the already-compressed video, and by then the server is
pointless.

### 2.6 Telemetry from day one

Nearly free, and impossible to backfill. From Stage 0, log per race:
the spec, the pre-sim metrics (lead changes, finish margin, max gap, late
overtakes), the capability probe result, and the **implicit signals** — did they
export, did they watch to the end, did they hit "new race" within 5 s. See
Stage 2b for what this becomes.

### The interface that makes both work

```
POST /api/race          -> { id, seed, spec }      // invent a race
GET  /api/race/:id      -> { seed, spec }          // replay/share a race
POST /api/render/:id    -> { jobId, mode }         // mode: "client" | "server"
GET  /api/render/:jobId -> { status, url? }        // server mode only
```

Design the job API in Stage 0 even though Stage 0 always answers `mode:"client"`.
It costs an afternoon now and saves a rewrite later.

---

## 3. The determinism contract

Everything above depends on one property: **seed in → identical race out.**

Current state: `main.js` calls `Math.random()` in seven places (`rand`,
`shuffle`, the starfield, `makeMarbles`'s hue offset, the per-substep wander at
line 289, confetti). None of it is seeded.

Required changes:

1. Replace the global RNG with a seeded PRNG (`mulberry32` / `xoshiro128**`),
   threaded through `rand`, `shuffle` and the wander term. No bare
   `Math.random()` anywhere in sim or scene-generation code.
2. **Separate sim RNG from cosmetic RNG.** Confetti and starfield must draw from
   a different stream, so a visual tweak never changes who wins.
3. The sim is already fixed-timestep (`DT = 1/120`) with a wall-clock accumulator
   in `advance()`. For export, swap the accumulator for a fixed frame advance:
   `frame n` → `n / fps` seconds of simulated time, no `performance.now()` in
   the loop. Realtime playback and offline export then produce the same race,
   one just runs faster than the other.
4. ⚠️ **Float portability caveat.** IEEE-754 guarantees `+ - * / sqrt` are
   bit-identical everywhere, but `Math.sin/cos/pow/exp` are **not** specified to
   the last bit across engines. The sim uses `Math.pow` and per-marble sinusoids,
   so a seed replayed on a different engine could theoretically diverge. Two
   mitigations, pick one when Path B lands: (a) both sides run V8 (browser
   Chromium + Node), which in practice agrees; (b) ship a compact recorded
   result trace alongside the seed and assert against it. Not a Stage 0 problem,
   but do not design the seed format as if it were impossible.

A race is then fully described by a small JSON `spec`:

```jsonc
{
  "seed": "8f3a2c91",
  "version": 1,              // sim version — bump on any physics change
  "marbles": 8,
  "durationTarget": 62.4,    // seconds, drawn from [40, 80]
  "track": { "segments": 13, "dropPerSegment": 4.2, "stepLen": 9.1 },
  "palette": "neon"
}
```

Small enough to live in a URL. That makes every race **shareable and
reproducible** — which is a real feature, not just plumbing.

---

## 4. Stage 0

### 4.1 Definition of done

> A stranger opens the deployed URL on a laptop, presses one button, watches a
> good-looking random marble race, presses **Export MP4**, and within ~15 seconds
> has a correctly-encoded, correctly-timed MP4 in their Downloads folder that
> plays in VLC, QuickTime and YouTube.

Plus: it looks like a product, not a demo.

### 4.2 Stack

| Layer | Choice | Why |
|---|---|---|
| Build | **Vite + TypeScript** | fast, no framework lock-in for the canvas |
| UI | **React + Tailwind** | matches your VillaAula stack; keeps UI out of `main.js` |
| 3D | **three.js from npm** (current release) | drop the vendored r128 |
| Encode | **WebCodecs + `mp4-muxer`** | hardware H.264, no wasm ffmpeg payload |
| Server | **Node + Express**, one process, `0.0.0.0:5000` | serves `dist/` + `/api/*` |
| Storage | none in Stage 0 | Object Storage arrives with Path B |
| Deploy | Replit Autoscale, **1 vCPU / 2 GiB, max 1–3** | Section 1.3 |

⚠️ The three.js upgrade is a real (small) migration, not a version bump: r128's
`renderer.outputEncoding` / `THREE.sRGBEncoding` were removed in favour of
`outputColorSpace` / `SRGBColorSpace`, and lighting intensities changed with the
physical-lights default. Budget an hour for the scene to look right again.

### 4.3 Work breakdown

| # | Task | Notes |
|---|---|---|
| **B1** | **Benchmark first.** Measure real export throughput at 1080p30/60 on your 3070Ti *and* on a mid laptop. | Validates the whole Path A premise before you build on it. Also measure SwiftShader locally (`--use-gl=swiftshader`) to replace the Section 1.5 estimates with numbers. |
| **W1** | Seed the RNG; split sim/cosmetic streams; verify same seed → identical finish order 100× | Section 3 |
| **W2** | Restructure `main.js` into modules: `sim/`, `scene/`, `export/`, `ui/` | it is one 550-line IIFE today |
| **W3** | Port to Vite + TS + npm three; migrate colour-space API | |
| **W4** | Offline render loop: fixed frame advance, decoupled from `requestAnimationFrame` | |
| **W5** | WebCodecs export pipeline + `mp4-muxer`, **streaming with `encodeQueueSize` backpressure** (§2.5), real progress UI | keyframe every 2s, ~8–12 Mbps at 1080p. Do not skip the backpressure. |
| **W6** | Race generator + **pre-sim curation**: sim ~20 candidates, score them, return the best (§2.1) | also how `durationTarget ∈ [40,80]s` gets hit — cheap, it is 1-D |
| **W7** | Capability probe (§2.3–2.4) → tier A/B/C + honest ETA on the export button; tier D stubbed as "notify me" | probe the **real scene**, during the first countdown |
| **W8** | The API surface from Section 2, always answering `mode:"client"` | |
| **W9** | UI/UX pass (below) | this is where "very good looking" is won or lost |
| **W10** | Replit deploy + smoke test on a phone and on Safari | |
| **W11** | Telemetry logging (§2.6) — specs, pre-sim metrics, probe results, implicit signals | ~1 hour. No panel yet. Data you don't collect can't be backfilled. |

### 4.4 UI/UX direction

The current HUD is already the right instinct (timing tower, countdown, results) —
it reads like a broadcast. Lean into that: **this is a sports broadcast, not a
tech demo.**

- One hero action. A big **"Nueva carrera"** button, everything else secondary.
- The race is the page. Full-bleed canvas, HUD floating over it, no chrome.
- Export as a *moment*: progress bar with a live thumbnail of the frame being
  encoded, then the file drops. Never a spinner with no information.
- Post-race card: podium, finish times, the seed, a **copy-link-to-this-race**
  button, and **Export MP4** as the primary CTA.
- Spanish-first UI, English available. The marble names are already Spanish.
- Reduced-motion and no-WebGL paths must not be a blank screen.

### 4.5 Replit deployment checklist

- [ ] `.replit`: run command starts the built Node server, not Vite dev
- [ ] Build step produces `dist/`; server serves it statically
- [ ] Listen on `0.0.0.0:5000`
- [ ] Autoscale, **1 vCPU / 2 GiB**, max machines 1–3
- [ ] No secrets in the repo — `.env.example` placeholders only, real values in the Secrets panel
- [ ] Confirm the machine-power slider stops match Section 1.2
- [ ] Smoke test after cold start (scale-to-zero means first hit is slow)

### 4.6 Explicitly not in Stage 0

Accounts, YouTube upload, audio, custom tracks, marble traits chosen by the user,
AI anything, sharing beyond a URL seed, server-side rendering (tier D), the admin
panel.

In scope despite looking like Stage 2: **pre-sim curation** (W6) and **telemetry
logging** (W11). Curation is what makes the races worth watching at all, and
telemetry is the only thing here that cannot be added retroactively — the panel
that reads it can wait, the writing of it cannot.

---

## 5. Stage roadmap

### Stage 1 — Server render + audio *(the fallback becomes a feature)*

> 🔴 **DECISION 2026-08-01: the server-render half of this stage is CANCELLED.**
> Path B was the only component that would have cost real money per video, and
> it was never buying quality the client cannot reach — only reaching users
> whose *hardware* cannot. That is a much narrower problem than a per-video
> bill. The replacement is the **client-side quality ladder**: render presets
> (bloom, IBL, physical materials, 2x supersampling, accumulation motion blur)
> chosen by a **time budget** the user picks, all running on their GPU at $0 to
> us. Built and shipped; see `HANDOFF.md`. Everything below about Playwright,
> SwiftShader, ffmpeg, Object Storage and per-video quotas is **retained for
> the record only**. Audio remains live and is the next thing to build.

- ~~Playwright + Chromium + SwiftShader worker, ffmpeg encode, Object Storage output,
  polling job API. Runs at 4 vCPU / 8 GiB — the one component that earns it.~~
- **Audio**: music bed + marble impact SFX, muxed via WebCodecs `AudioEncoder`
  (AAC). A silent race video is a weak YouTube upload.
- Cost control from day one: rate limit, per-user quota, and a hard cap, because
  Path B is ~$0.10–0.30 a video and abuse is a real bill.

#### 5.1 Audio, in detail *(SFX · music · commentary — all optional)*

> ✅ **SFX, music and the crowd shipped 2026-08-02.** Everything below was the
> design, and it held: procedural Web Audio, one scheduler for both the live
> `AudioContext` and the export `OfflineAudioContext`, a cosmetic RNG stream, the
> drop bar-locked to lights-out. Two things the design did not anticipate are
> recorded in `HANDOFF.md`: the cost of an offline render is **graph size, not
> DSP** (so percussion is pre-baked into buffers, one node per hit), and
> `setTimeout` backpressure in the audio encoder **hangs a background tab**.
> **Commentary is still not built** — the clip pool below remains the plan.

Everything here hangs off one thing that already exists: **`RaceSim` emits a
timestamped event stream** (`go`, `overtake`, `finish`, `end`). Audio is a second
consumer of that stream, exactly as the renderer is. Same seed → same soundtrack.

**The architectural constraint, and it is not obvious:** export runs *faster than
realtime*, so you cannot record the live Web Audio output. The soundtrack has to
be rendered offline into a buffer and then encoded.

> Live playback → `AudioContext`. Export → `OfflineAudioContext` → `AudioData`
> chunks → `AudioEncoder` → `muxer.addAudioChunk`.
>
> Two consumers of one event list, mirroring the visual side. Write the sound
> design against the event list, never against wall-clock playback, or the video
> and the live view will drift apart.

| Layer | What it needs | Marginal cost |
|---|---|---|
| **SFX** | Collision events with intensity. `collide()` knows the relative velocity but does **not** emit an event yet — that is the one sim change required. It touches no state and consumes no RNG, so it does **not** bump `SIM_VERSION`. Also: ring pass-throughs, the finish, and a countdown beep. | $0 |
| **Music** | A bed that reacts to race state (tighten when the front gap closes — `battleGap` is already in the snapshot). Procedural loops in Web Audio stay deterministic and dodge the licensing problem entirely. **Do not ship anything you do not own or that is not CC0** — a YouTube-facing generator is a copyright-claim machine. | $0 |
| **Commentary** | A **fixed pool of pre-recorded clips**, triggered by events. See below. | $0 |

##### Commentary: a clip pool, not a voice service

The obvious approach — generate a script and speak it — is the expensive one.
`speechSynthesis` cannot be captured into an audio buffer (no output stream to
tap), so it could narrate the live view but never reach the MP4; putting it in
the video would require server-side TTS, which makes the server own an audio
file and drags in Object Storage, per-video cost, quotas and accounts.

**A fixed clip pool avoids all of that.** Clips are static assets: decode once,
schedule into the `AudioContext` for playback and the `OfflineAudioContext` for
export. Zero marginal cost, no server involvement, ships with SFX and music
rather than behind Path B.

**Pay for the voice once, at build time.** If recording a human is impractical,
render the pool with a good TTS *offline*, once, and commit the audio. Natural
voice, $0 per video, forever. The per-video cost only ever appears if the lines
are generated per race — and they do not need to be.

Four problems, in the order they will actually bite:

1. **Repetition is what makes it sound broken.** Five "¡adelantamiento!" clips in
   a race with eight overtakes is worse than silence. Needs variant pools per
   event type, a no-repeat-within-N rule, and rarer lines reserved for rarer
   events. Budget most of the recording effort here, not on new event types.
2. **Overlap.** Events cluster — an overtake *on* the finish line fires two calls
   at once. One commentary channel, a priority order (finish > late overtake >
   overtake > colour), a minimum gap between lines, and music ducking underneath.
3. **Naming marbles is possible here, and it is why this works at all.**
   `MARBLE_NAMES` is a **fixed list of 24**, so every name can be recorded once
   and concatenated: `[¡Ámbar!] + [toma la punta!]`. That is how sports games did
   commentary for decades. ⚠️ It also means **Stage 2's user-named marbles cannot
   be spoken** — those races fall back to generic lines ("¡el líder se escapa!"),
   and that trade-off should be a conscious one, not a surprise.
4. **Payload.** A pool worth having is ~150–250 short clips; at mono Opus that is
   several MB, against a current bundle of ~225 KB gzip. **Lazy-load the pool only
   when commentary is switched on.** Never in the initial bundle.

**The unfair advantage: we know the whole race before it starts.** The sim is
fully computed before a single frame is drawn, so commentary can *anticipate* —
schedule "¡se le acerca por dentro!" two seconds **before** the overtake lands,
which is exactly what a real commentator does and what live-reactive systems
cannot do. This is only possible because the race is deterministic and
pre-simulated. It is the single thing that will make this sound professional
rather than like a slot machine.

Clip selection must draw from a **cosmetic RNG stream** keyed on the seed, so the
same race always gets the same commentary — and so a change to the line pool can
never alter who wins.

##### Music: arrange it *to* the race, not under it

Drum and bass is the obvious fit, and not only tonally — its structure maps onto
a race almost exactly: **intro → build → drop → breakdown → second drop** against
**countdown → lights out → mid-race → battle → finish**.

The same advantage as commentary applies: the race is fully simulated before a
frame is drawn, so the arrangement can be *scheduled against known events* rather
than played underneath and hoped for. Put the drop on lights-out, not near it.

DnB's ~174 BPM makes the arithmetic land almost for free:

| | at 174 BPM |
|---|---|
| 1 beat / 1 bar (4/4) | 0.345 s / **1.379 s** |
| Current `COUNTDOWN` = 3 s | 2.18 bars → snap to **2 bars = 2.76 s** |
| Current `OUTRO` = 4.5 s | 3.26 bars → snap to **4 bars = 5.52 s** |
| A 55 s race | ~40 bars |

Both constants are safe to retune: the countdown consumes no RNG and the outro is
after the flag, so **changing them cannot change who wins** — only
`videoDuration`, and therefore frame counts, would move.

⚠️ Race length is continuous (38–82 s), so the *finish* can land anywhere in a
bar. Do not try to time-stretch to fix that. Use a loop-based bed that is
bar-locked at the **start** plus stingers that can enter on any beat, and accept
that only the opening is perfectly quantised. Quantising ambient SFX (ring
passes) to the beat grid is a cheap polish win — but collision and finish SFX
must stay on their true event time or they visibly desync.

⚠️ **Content ID is the real risk, not licensing.** A track can be
properly CC-licensed and still be *in* YouTube's Content ID database, which means
our users get claims on videos we told them were safe. For a tool whose entire
output is meant to be uploaded, that is a product failure, not a legal footnote.
Commission or generate the loops; DnB is loop-based enough that procedural
Web Audio sequencing is genuinely tractable, and it is deterministic for free.

All three layers ship muted-capable and remembered: autoplay policies block audio
before a user gesture, so the live view must never assume it can make noise.

### Stage 2 — User control
- Sliders: race length, marble count, palette, marble names.
- **Marble traits** as a first-class system: downhill bias, uphill grip, air time,
  mass, bounciness. The sim already has per-marble rolling resistance/drag/mass —
  this is exposing and naming what exists, plus new terms. Show traits on the
  timing tower so viewers can root for one.
- Named/saved marbles that persist across races (this is where accounts start
  paying for themselves).

### Stage 2b — The data flywheel *(parallel track, unlocked by W11)*

Server generates → client renders → **we learn which races people actually like**
→ scorer improves. The setup is nearly free because the features already exist:
the pre-sim metrics from §2.1 are the **inputs**, the user's reaction is the
**label**.

- **Admin panel**: race explorer, metric distributions, rating vs. metric plots.
- **No ML for a long time.** Start with SQL: *"races with ≥3 lead changes and a
  finish margin under 0.5 s rate 20% higher."* Then re-weight the curation
  scorer. That is most of the value, for a day of work.
- **Implicit signal beats explicit ratings.** Most users never click 👍, but
  *did they export it* is an excellent proxy for "liked it" and costs nothing.
  Explicit 👍/👎 is a bonus layer, not the foundation.
- ⚠️ **Keep an exploration arm.** If you only generate what the scorer already
  likes, you only ever learn about what the scorer already likes — it
  self-reinforces and never discovers the good regions it currently avoids.
  Make **~10% of races pure-random**, ignoring the scorer, and keep them labelled
  as the control group.
- Watch for survivor bias generally: you only get signal on races people chose to
  watch.

### Stage 3 — Track authoring, worlds, and billboards
- Curated track library with hand-tuned seeds.
- A visual track editor (place control points, set drop and twist).
- **AI track generation**: prompt → track spec. Note this is text → *parameters*,
  not text → geometry — the model fills in the `track` block of the spec and
  picks a palette. Cheap, fast, and it cannot produce a broken track.

#### 3.1 Worlds: biome ≠ palette

The current `Palette` definition now drives two complete renderer families:
six orbit worlds and three surface biomes with terrain, props, weather, cast,
lighting, and open channels. Longer term, biome still deserves its own spec axis
rather than remaining bundled into `palette` (palette then becomes one property
*of* a biome).

The cost profile is different from everything else in this plan: biomes cost
**bundle size and GPU time**, not server money. So: lazy-load props and textures
per biome, never in the initial bundle.

✅ One thing that already works correctly: the capability probe benchmarks **the
real loaded scene**, so a heavy jungle biome automatically produces a lower
measured throughput and an honest, longer export ETA. No change needed — this is
the payoff for not benchmarking a synthetic triangle.

##### Intentional set pieces

The first vertical slice is implemented for `desierto`: a deterministic mine
selected only from a sampled straight interval, with explicit portals, inner
and outer radii, chase-camera envelope, non-local track clearance, prop
reservation, supports, and lights. The contract lives in renderer-free
`client/scene/SetPieceLayout.ts`; Three.js only dresses the validated data.

The reusable rule is now concrete: select and reserve before ordinary scenery
and spectators, return no set piece when a grammar has no honest interval, and
bound every interior object as well as the enclosing wall. The real foreground
preview and encoded desert MP4 gate passed on `MINEVIEW16`; the glacier reused
the profile-driven selector and passed the same gate on `ICEVIEW5`, including a
completed browser download. The open jungle ruin then passed on `RUINQA105`
after real frames corrected a safe-but-dark shell into a sunlit colonnade. All
three surface biomes now have a verified intentional slice; in-scene attribution
billboards are the next local product feature.

#### 3.2 Track families: ovals and F1 layouts

These are **generator grammar**, not scenery — a separate axis from biome. Two of
them are cheap and one is not:

- **F1-inspired layouts** — cheap. A real circuit is a named sequence of corner
  types, and `hairpin` / `chicane` / `sweep` / `runout` already exist. This is
  mostly new grammar weightings plus hand-authored specs in the curated library.
- **NASCAR oval** — ⚠️ **this is the one that fights the physics model.** The sim
  is strictly 1-D along an open curve and **gravity is the only motive force**. A
  genuinely closed loop returns to its own start height, so friction stops the
  marbles: laps are impossible without adding a motive force.
  > **The cheap honest answer: a banked spiral reads as an oval.** The `spiral`
  > segment already exists; from a chase camera and from above, a shallow-drop
  > multi-turn spiral looks exactly like laps of an oval, still descends, and
  > needs **zero** physics change. Turns become laps — the HUD can even say
  > "VUELTA 2 / 3".
- **Banking** is the one real addition. Marbles currently rest where gravity
  projects onto the tube (`theta` + the local frame), so banking means rolling
  the tube's local frame and changing where "down" is inside it. That touches
  collision geometry and **is** a sim change — bump `SIM_VERSION`.

#### 3.3 Billboards

Textured planes along the track, placed at `landmarks` (which already exist).
Text is simplest as canvas-drawn textures (`CanvasTexture`) — no font loading in
WebGL, and deterministic.

**They must be scene objects, not an HTML overlay.** The exported MP4 is the
thing people share, so anything that is not *in the scene* does not exist where
it matters.

> **The reason to do this early is not revenue — it is that the exported video
> currently carries no attribution at all.** Someone uploads a Canicarrera race
> to YouTube today and nothing in the file says where it came from. Billboards
> reading `CANICARRERA`, `creado por Carlos Villa`, and a URL, plus an end card
> over the outro, turn every exported video into its own marketing. That is worth
> more than ad space for a long time.

⚠️ On selling billboard space later: an advertiser buying placement in
*user-generated* video wants to know what it appears next to, and paid promotion
inside videos users upload has disclosure obligations that land on **them**, not
us. Sponsored or branded *races* are a cleaner product than sold billboard
inventory. Worth keeping in mind before building an ad server.

### Stage 4 — Distribution
- Accounts (Google OAuth), race history, public gallery.
- **YouTube upload** via OAuth + Data API v3 resumable upload, with auto-generated
  title/description/tags. This *requires* Path B — the server must own the file.
- Shorts format (9:16, ≤60s) as a first-class output, since that is where marble
  racing actually lives.

### Stage 5 — Scale
- Batch/scheduled generation ("a race a day to my channel"). Needs a scheduler
  outside Autoscale — Replit Scheduled Deployment, or an external cron hitting
  the API.
- Tournaments, seasons, standings across races.
- If server render volume ever justifies it, move Path B off Autoscale to a
  GPU box; the job API means nothing else changes.

---

## 6. Risks and open questions

| # | Risk | Mitigation / what to do |
|---|---|---|
| R1 | Autoscale request-duration ceiling is undocumented | Never block >60s. Job API from Stage 0. Ask Replit support for the number. |
| R2 | Machine tiers in Section 1.2 are third-party sourced | **Open the Publishing UI and read the sliders** before finalising the budget. |
| R3 | WebCodecs absent (Firefox Android, old Safari) | Tier C WASM encoder — still $0 to us (§2.3). Feature-detect, never UA-sniff. |
| R3b | **Frame pile-up → OOM / tab kill** | §2.5. Streaming pipeline + `encodeQueueSize` backpressure. **Most likely bug in the project.** Test on a mid-range Android and on iOS. |
| R4 | Export tab-throttled when backgrounded | Warn the user to keep the tab visible, or drive the loop from a Worker. |
| R5 | 6M CU allowance burns fast if Path B becomes default | Quotas + hard cap before Stage 1 ships. |
| R6 | Float non-determinism across engines | Section 3.4. Only bites when Path B lands. |
| R7 | Cold start after scale-to-zero feels broken | Lean image; a "waking up" state in the UI. |
| R8 | Section 1.5 numbers are **estimates** | Task B1 replaces them with measurements. Do this before Stage 1 scoping. |

---

## 7. Cost at scale (Path A)

| Monthly videos | Server cost |
|---|---|
| 100 | $1.00 (base fee only) |
| 10,000 | ~$1.02 |
| 1,000,000 | ~$2.20 |

Path A's server bill is essentially the $1 base fee plus request charges. **The
cost of this product is Path B**, which is precisely why Path B must be opt-in,
quota'd, and never the default. Build the free path first and build it well.

---

*Read this file first when picking the project back up. Stage 0 starts at B1 —
benchmark before building.*
