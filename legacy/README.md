# Canicarrera

*Canica* + *carrera* — a 3D marble race proof of concept. Eight random-colored
marbles tumble down a glass chute floating in the night; the winner is genuinely
different every run.

![engine](https://img.shields.io/badge/engine-three.js%20r128-blue) — vendored,
zero build step, works offline.

## Run it

Just open `index.html` in a browser (double-click works — the three.js build is
vendored as a classic script, so no server or bundler is needed).

Optionally serve it:

```
python -m http.server 8737
# → http://localhost:8737
```

- **New race** — same track, new colors / traits / grid.
- **New track** — regenerates the whole course.

## How the randomness works

There is no physics engine. Marbles are constrained to the track curve and
simulated in 1-D along its arc length, so the sim is cheap and can never fall
off the track — but the outcome is still stochastic, four ways:

1. **Grid luck** — starting slots are shuffled every race.
2. **Per-race traits** — each marble rolls slightly different rolling
   resistance, drag, and mass every race.
3. **Wander** — an Ornstein–Uhlenbeck noise term nudges each marble's
   acceleration continuously, producing lead changes mid-race.
4. **Bumping** — marbles that catch each other exchange momentum with
   restitution, adding chaos in the pack.

## How the track works

- A random winding descent is generated as control points (straight launch
  ramp → 13 curvy drop segments → gentle run-out) and smoothed with a
  centripetal Catmull–Rom spline.
- The curve is sampled into an arc-length lookup table; `frameAt(s)` returns
  position, tangent, tube-floor direction, and lateral axis at any distance.
- Marbles ride the inside of a translucent `TubeGeometry` at
  `tubeR − marbleR`, swaying laterally with per-marble sinusoids; roll spin is
  applied around the lateral axis (the white cap makes it visible).
- Checkpoint rings, a gold finish arch, a starfield, and a chase camera that
  follows the leader (then orbits the finish) complete the scene.

## Files

| File | Purpose |
|---|---|
| `index.html` | page + HUD (timing-tower leaderboard, countdown, results) |
| `main.js` | scene, track generator, marble sim, camera, confetti |
| `vendor/three.min.js` | three.js r128 UMD build |

## Tuning

Top of `main.js`: `MARBLES`, `MARBLE_R`, `TUBE_R`, gravity/friction constants,
and the track-shape parameters inside `buildTrack()` (segment count, step
length, drop per segment).
