# Canicarrera

*Canica* + *carrera* — a marble race **video generator**. Press one button, the
server invents a race worth watching, your machine renders it and hands you an
MP4.

The whole product turns on one decision: **the server invents, the client
draws.** Rendering 3D video needs a GPU and Replit Autoscale does not have one,
so the pixels are drawn by the user's own hardware via WebGL + WebCodecs. The
server's job is small and valuable — mint a seed, simulate ~20 candidate races,
score them, hand back the good one. See `PLAN.md` §2 for the numbers behind
that; the short version is three to five orders of magnitude on both cost and
wall-clock, in favour of the client.

## Run it

```bash
npm install
npm run dev     # vite on :5173 (proxying /api), api on :5000
```

Or the way it actually deploys:

```bash
npm run build
npm start       # one Node process on 0.0.0.0:5000 serving dist/ + /api
```

```bash
npm test        # determinism + generator + curation checks, no framework
npm run check   # tsc --noEmit
```

## Contributing and continuation

This project keeps contributor guidance in vendor-neutral Markdown so a human or
any coding assistant can resume without private tool memory:

- `AGENTS.md` — project rules and read order.
- `docs/CURRENT_WORK.md` — latest completed checkpoint and next safe step.
- `docs/DEVELOPMENT.md` — durable architecture, behavior, and QA contracts.
- `HANDOFF.md` — detailed implementation history and measurements.

Always inspect the current worktree before editing; active checkpoints may be
uncommitted and can overlap older work.

## How it fits together

```
shared/     pure TypeScript. No DOM, no three.js, no renderer, no Web Audio.
  rng         xoshiro128**, streams keyed on seed + label
  vec3        minimal vector maths
  curve       centripetal Catmull-Rom + arc-length table
  track       segments -> control points -> geometry
  generator   seed -> RaceSpec
  sim         the simulator: fixed-step, 1-D along the track
  curate      simulate N candidates, score, pick the best
  spec        types + physics constants (these ARE the sim version)
  audio/score seed + sim events -> a timed soundtrack. Notes, not samples.

client/
  scene/      three.js. Reads the sim, draws it. Owns no race logic.
  audio/      Web Audio. Reads the score, plays it. Owns no arrangement.
  export/     capability probe, WebCodecs encoder, the offline render loop
  render/     quality presets, the post pipeline, the device memory budget
  ui/         React + Tailwind broadcast HUD

server/       Express. Curation, race registry, job API, telemetry.
```

The important line is between `shared/` and its consumers. The simulator has no
renderer inside it and the score has no synthesiser inside it, so three.js and
Web Audio are each just *one* consumer — which is what makes a future
high-quality path a second consumer rather than a rewrite.

The same split pays off twice over: because the score is renderer-free, live
playback and the offline export render it through the **same scheduler**, and
`npm test` can assert things about the music in node.

## Determinism

Seed in, identical race out — that is what makes a shared link work and what
lets the client replay what the server scored.

- One PRNG, seeded; no `Math.random` anywhere in sim or generation.
- Streams are derived from the **seed string plus a label**, never from a
  parent's mutable state, so adding a marble or drawing one extra confetti
  particle cannot shift another stream.
- Cosmetic randomness lives in its own streams and can never change a result.
- Fixed `dt`; sim time is `steps * dt`, never a clock. Realtime playback and
  offline export produce the same race — one just runs faster.

`npm test` asserts all of this 100 times per run.

## The seed

Anything is a valid seed. `hola-mundo`, `CANICARRERA`, `8F3A2C91` — input is
normalised, never rejected. Every race is at `/?c=<seed>`, which is the share
link and the "give me that one again" mechanism.

## Deploy

Replit Autoscale, **1 vCPU / 2 GiB, max 1–3 machines**. `.replit` is configured;
see the comments in it for why the machine is deliberately small and why
`npm install` is not in the build command.

## Sound

Every race has a soundtrack, and it is **generated, not sampled**: procedural
drum and bass at 174 BPM, sound effects off the simulator's event stream, and a
crowd that reacts to how close the front two are.

It is arranged *to* the race rather than played underneath it — the bar grid is
anchored so the drop lands exactly on lights-out, and a bar where the leaders are
fighting becomes a drop bar whatever the sixteen-bar cycle says. The whole race
is simulated before a note is scheduled, which is what makes that possible.

Nothing is a recording. That keeps the bundle small, means nothing can 404, and
avoids the real risk for a tool whose output is meant to be uploaded: a licensed
loop can still be in YouTube's Content ID database.

Sound is off by default in the preview (browsers require a gesture before making
noise, and so does good manners) and on by default in the exported file.

## What is not here yet

Commentary, server-side rendering, accounts, YouTube upload, a WASM encoder for
browsers without WebCodecs. See `HANDOFF.md` for the current state and
`PLAN.md` §5 for the roadmap.

The original single-file proof of concept is kept in `legacy/` for reference.
