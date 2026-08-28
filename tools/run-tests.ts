/**
 * Determinism and sanity checks for the shared core.
 *
 * No test framework on purpose: this runs in CI, in the Replit build, and on a
 * laptop with `npm test`, and every dependency here is a dependency the deploy
 * has to carry.
 *
 * The first two tests are the ones that matter. If they fail, every shared link
 * in the wild is broken and the export feature is a lie.
 */
import { generateSpec, ARCHETYPE_NAMES } from '../shared/generator.ts';
import { PALETTES, PALETTE_NAMES } from '../shared/palette.ts';
import { RaceSim, simulate, COUNTDOWN, OUTRO } from '../shared/sim.ts';
import { curate, scoreRace } from '../shared/curate.ts';
import { randomSeed, normaliseSeed, stream, COSMETIC } from '../shared/rng.ts';
import { buildTrack, selfIntersects } from '../shared/track.ts';
import { PHYSICS } from '../shared/spec.ts';
// Client-side, but deliberately DOM-free so it can be checked here rather than
// only in a browser nobody is watching.
import {
  BAR,
  BAR_ZERO,
  INTRO_BARS,
  SFX_MAX_SECONDS,
  SFX_SHAPES,
  buildScore,
  sfxSeconds,
  type SfxKind,
} from '../shared/audio/score.ts';
import { PRESETS, presetById, drawCost } from '../client/render/presets.ts';
// DOM-free on purpose, so the memory budget that keeps a phone alive is checked
// here rather than only ever on a device we do not own.
import {
  affordableSupersample,
  canAffordPostFX,
  deviceProfile,
  postFXBytes,
} from '../client/render/device.ts';
import { frameSeconds, exportSeconds } from '../client/render/cost.ts';
import {
  LADDER,
  planForBudget,
  planSeconds,
  planIsAvailable,
  type PlanCapability,
} from '../client/render/budget.ts';
import { QUALITIES } from '../client/export/quality.ts';
import {
  ORDINARY_PROP_TRACK_CLEARANCE,
  TRACK_PLAN_SAFETY_MARGIN,
  buildPropLayout,
  clearsPropExclusions,
  distanceToTrackPlan,
  sampleTrackPlan,
} from '../client/scene/WorldLayout.ts';
import {
  ICE_CAVE_FINISH_BUFFER,
  ICE_CAVE_GRID_BUFFER,
  ICE_CAVE_ICICLE_CAMERA_MARGIN,
  ICE_CAVE_MAX_SLOPE,
  ICE_CAVE_MAX_TANGENT_ANGLE,
  ICE_CAVE_MIN_LENGTH,
  MINE_FINISH_BUFFER,
  MINE_GRID_BUFFER,
  MINE_MAX_SLOPE,
  MINE_MAX_TANGENT_ANGLE,
  MINE_TUNNEL_MIN_LENGTH,
  buildDesertMineTunnelLayout,
  buildGlacierIceCaveLayout,
  distanceToSetPieceAxis,
} from '../client/scene/SetPieceLayout.ts';
import {
  clearsCharacterExclusions,
  relocateCharacterArc,
} from '../client/scene/Characters.ts';

let failures = 0;
let checks = 0;

function check(name: string, condition: boolean, detail = ''): void {
  checks++;
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

const fingerprint = (seed: string): string => {
  const spec = generateSpec(seed);
  const summary = simulate(spec);
  return summary.finishOrder.map((m) => `${m.name}:${m.finishTime.toFixed(9)}`).join('|');
};

// ---------------------------------------------------------------- W1
section('W1 — determinism');
{
  const seed = 'TESTSEED';
  const specJson = JSON.stringify(generateSpec(seed));
  let specStable = true;
  for (let i = 0; i < 100; i++) {
    if (JSON.stringify(generateSpec(seed)) !== specJson) {
      specStable = false;
      break;
    }
  }
  check('same seed -> byte-identical spec, 100x', specStable);

  const base = fingerprint(seed);
  let simStable = true;
  let firstDiff = '';
  for (let i = 0; i < 100; i++) {
    const again = fingerprint(seed);
    if (again !== base) {
      simStable = false;
      firstDiff = `run ${i}`;
      break;
    }
  }
  check('same seed -> identical finish order and times, 100x', simStable, firstDiff);

  // Cosmetic randomness must be incapable of touching a result.
  const cosmetic = stream(seed, COSMETIC.confetti);
  for (let i = 0; i < 5000; i++) cosmetic.next();
  check('cosmetic stream consumption does not move the result', fingerprint(seed) === base);

  // Stepping through the sim by hand must match running it in one go.
  const spec = generateSpec(seed);
  const manual = new RaceSim(spec);
  while (manual.phase !== 'finished') manual.advanceTo(manual.time + 0.37);
  const manualFp = manual.finishOrder.map((m) => `${m.name}:${m.finishTime.toFixed(9)}`).join('|');
  check('ragged advanceTo() matches a straight run (realtime == export)', manualFp === base);

  check('different seeds produce different races', fingerprint('AAAA1111') !== fingerprint('BBBB2222'));
}

// ---------------------------------------------------------------- seeds
section('Seeds');
{
  check('normalise strips punctuation and case', normaliseSeed(' hola-mundo! ') === 'HOLAMUNDO');
  check('empty input still yields a usable seed', normaliseSeed('   ').length === 8);
  check('random seeds are 8 chars', randomSeed().length === 8);
  check(
    'user text is a valid seed',
    fingerprint(normaliseSeed('Canicarrera')) === fingerprint('CANICARRERA'),
  );
}

// ---------------------------------------------------------------- tracks
section('Track generator');
{
  const SAMPLE = 150;
  let intersecting = 0;
  let minLen = Infinity;
  let maxLen = 0;
  const archetypes = new Set<string>();
  const palettes = new Set<string>();

  for (let i = 0; i < SAMPLE; i++) {
    const spec = generateSpec(`TRACK${i}`);
    const track = buildTrack(spec.track);
    if (selfIntersects(track)) intersecting++;
    minLen = Math.min(minLen, track.total);
    maxLen = Math.max(maxLen, track.total);
    archetypes.add(spec.archetype);
    palettes.add(spec.palette);
  }
  check(
    `no self-intersecting tracks in ${SAMPLE} seeds`,
    intersecting === 0,
    `${intersecting} intersected`,
  );
  check('track lengths land in a sane band', minLen > 300 && maxLen < 1100, `${minLen.toFixed(0)}-${maxLen.toFixed(0)} m`);
  // Counted from the data, not hardcoded: the point of the check is that the
  // generator can REACH every world it knows about, and a literal here just
  // means adding a world breaks an unrelated test.
  check(
    `all ${ARCHETYPE_NAMES.length} archetypes appear`,
    archetypes.size === ARCHETYPE_NAMES.length,
    [...archetypes].join(', '),
  );
  check(
    `all ${PALETTE_NAMES.length} worlds appear`,
    palettes.size === PALETTE_NAMES.length,
    [...palettes].join(', '),
  );

  // Surface worlds are a different renderer path (sky dome, terrain, scenery,
  // motes) and every one of them must be self-consistent or it draws a plane
  // floating in a void.
  const surface = PALETTE_NAMES.map((n) => PALETTES[n]).filter((p) => p.kind === 'surface');
  check(
    'every surface world has ground, scenery and weather',
    surface.length > 0 &&
      surface.every(
        (p) =>
          p.ground !== null &&
          p.starCount === 0 &&
          p.props !== 'none' &&
          p.propCount > 0 &&
          p.motes !== 'none' &&
          p.moteCount > 0,
      ),
    surface.map((p) => p.name).join(', '),
  );
  check(
    'every orbit world still has its star field and no terrain',
    PALETTE_NAMES.map((n) => PALETTES[n])
      .filter((p) => p.kind === 'orbit')
      .every((p) => p.starCount > 0 && p.ground === null),
  );
}

// ---------------------------------------------------------------- scenery layout
//
// Ordinary scenery is allowed to be dramatic, but never allowed to occupy the
// chute or chase-camera corridor by accident. These checks use the same pure
// transforms the Three.js world consumes, across every surface biome.
section('World layout clearance');
{
  const worlds = PALETTE_NAMES.map((name) => PALETTES[name]).filter(
    (palette) => palette.kind === 'surface',
  );
  const fingerprints = new Set<string>();
  let deterministic = true;
  let wanted = 0;
  let placed = 0;
  let violations = 0;
  let smallestMargin = Infinity;

  for (const world of worlds) {
    for (let i = 0; i < 12; i++) {
      const seed = `LAYOUT_${world.name}_${i}`;
      const spec = generateSpec(seed, { palette: world.name });
      const track = buildTrack(spec.track);
      // The renderer supplies its track-following terrain function. A smooth,
      // non-flat stand-in proves Y placement is deterministic without pulling
      // Three.js or the terrain mesh into Node.
      const groundHeightAt = (x: number, z: number): number =>
        -11 + Math.sin(x * 0.03) * 2 + Math.cos(z * 0.025) * 1.5;
      const first = buildPropLayout(world, track, seed, groundHeightAt);
      const second = buildPropLayout(world, track, seed, groundHeightAt);
      const firstJson = JSON.stringify(first);
      if (firstJson !== JSON.stringify(second)) deterministic = false;
      fingerprints.add(firstJson);

      wanted += world.propCount;
      placed += first.length;
      const plan = sampleTrackPlan(track);
      for (const prop of first) {
        const margin =
          distanceToTrackPlan(prop.x, prop.z, plan) -
          (ORDINARY_PROP_TRACK_CLEARANCE + prop.radius);
        smallestMargin = Math.min(smallestMargin, margin);
        if (margin < -1e-9) violations++;
      }
    }
  }

  check('same race -> byte-identical scenery layout', deterministic);
  check(
    'different races produce different scenery layouts',
    fingerprints.size === worlds.length * 12,
    `${fingerprints.size} distinct layouts`,
  );
  check(
    'ordinary props fill every world budget after relocation',
    placed === wanted,
    `${placed}/${wanted} placed`,
  );
  check(
    'no ordinary prop enters the complete track/camera corridor',
    violations === 0,
    `${violations} violations`,
  );
  check(
    'clearance math preserves the spline-approximation safety margin',
    smallestMargin >= TRACK_PLAN_SAFETY_MARGIN - 1e-9,
    `${smallestMargin.toFixed(4)} m smallest margin`,
  );
  console.log(
    `       ${placed} props across ${worlds.length * 12} layouts · ` +
      `${smallestMargin.toFixed(2)} m tightest extra margin`,
  );
}

// ---------------------------------------------------------- desert mine tunnel
//
// An intentional crossing has the inverse contract from ordinary scenery: it
// may surround the track only after proving that the chute and chase camera fit
// inside it, no other course section enters its shell, and dunes were moved out
// before rendering. Exercise every grammar because a set piece that only works
// on one track family is not a world feature.
section('Desert mine tunnel');
{
  let selected = 0;
  let deterministic = true;
  let validInterval = true;
  let validEnvelope = true;
  let validDressing = true;
  let propViolations = 0;
  let wantedProps = 0;
  let placedProps = 0;
  let sparsestPropRatio = 1;
  let smallestPropMargin = Infinity;
  const fingerprints = new Set<string>();

  for (const archetype of ARCHETYPE_NAMES) {
    for (let i = 0; i < 12; i++) {
      const seed = `MINE_${archetype}_${i}`;
      const spec = generateSpec(seed, { archetype, palette: 'desierto' });
      const track = buildTrack(spec.track);
      const first = buildDesertMineTunnelLayout(track, seed);
      const second = buildDesertMineTunnelLayout(track, seed);
      if (JSON.stringify(first) !== JSON.stringify(second)) deterministic = false;
      if (!first) continue;

      selected++;
      fingerprints.add(JSON.stringify(first));
      validInterval &&=
        first.startS >= MINE_GRID_BUFFER - 1e-9 &&
        first.endS <= track.finishS - MINE_FINISH_BUFFER + 1e-9 &&
        first.length >= MINE_TUNNEL_MIN_LENGTH - 1e-9 &&
        first.metrics.minTangentDot >= Math.cos(MINE_MAX_TANGENT_ANGLE) - 1e-9 &&
        first.metrics.maxSlope <= MINE_MAX_SLOPE + 1e-9;
      validEnvelope &&=
        first.metrics.maxTrackAxisOffset + track.tubeRadius < first.interiorRadius &&
        first.metrics.maxCameraAxisOffset <= first.cameraEnvelopeRadius + 1e-9 &&
        first.cameraEnvelopeRadius < first.interiorRadius &&
        first.metrics.nearestOtherTrack >= first.outerRadius + track.tubeRadius;
      validDressing &&=
        first.supports.length >= 3 &&
        first.supports.every((support) => support.s > first.startS && support.s < first.endS) &&
        first.lamps.length >= 2 &&
        first.propExclusion.points.length >= 3 &&
        first.spectatorExclusion.startS < first.startS &&
        first.spectatorExclusion.endS > first.endS;

      const desert = PALETTES.desierto;
      const props = buildPropLayout(
        desert,
        track,
        seed,
        (x, z) => -11 + Math.sin(x * 0.03) * 2 + Math.cos(z * 0.025) * 1.5,
        { exclusions: [first.propExclusion] },
      );
      wantedProps += desert.propCount;
      placedProps += props.length;
      sparsestPropRatio = Math.min(sparsestPropRatio, props.length / desert.propCount);
      for (const prop of props) {
        const margin =
          distanceToTrackPlan(prop.x, prop.z, first.propExclusion.points) -
          (first.propExclusion.radius + prop.radius);
        smallestPropMargin = Math.min(smallestPropMargin, margin);
        if (!clearsPropExclusions(prop.x, prop.z, prop.radius, [first.propExclusion])) {
          propViolations++;
        }
      }
    }
  }

  const sampleCount = ARCHETYPE_NAMES.length * 12;
  check(
    `every generated desert course selects a safe mine interval (${sampleCount} tracks)`,
    selected === sampleCount,
    `${selected}/${sampleCount} selected`,
  );
  check('same race -> byte-identical mine contract', deterministic);
  check(
    'different races produce different mine contracts',
    fingerprints.size === sampleCount,
    `${fingerprints.size} distinct layouts`,
  );
  check('mine intervals are straight and clear of grid/finish', validInterval);
  check('chute, chase camera and non-local track clear the authored shell', validEnvelope);
  check('every mine has portals-ready frames, supports, lamps and prop exclusion', validDressing);
  check(
    'reserved mine corridors retain the desert scenery density',
    placedProps >= wantedProps * 0.99 && sparsestPropRatio >= 0.9,
    `${placedProps}/${wantedProps} placed, ${(sparsestPropRatio * 100).toFixed(1)}% sparsest`,
  );
  check(
    'no ordinary dune enters a mine or portal approach',
    propViolations === 0 && smallestPropMargin >= TRACK_PLAN_SAFETY_MARGIN - 1e-9,
    `${propViolations} violations, ${smallestPropMargin.toFixed(3)} m margin`,
  );

  const outcomeSeed = 'MINE_OUTCOME';
  const outcomeBefore = fingerprint(outcomeSeed);
  const outcomeSpec = generateSpec(outcomeSeed, { palette: 'desierto' });
  buildDesertMineTunnelLayout(buildTrack(outcomeSpec.track), outcomeSeed);
  check('mine selection cannot change the race outcome', fingerprint(outcomeSeed) === outcomeBefore);
  console.log(
    `       ${selected} tunnels · ${placedProps} dunes · ` +
      `${(sparsestPropRatio * 100).toFixed(1)}% sparsest layout · ` +
      `${smallestPropMargin.toFixed(2)} m tightest exclusion margin`,
  );
}

// ------------------------------------------------------------ glacier ice cave
//
// This is deliberately the same interval/camera/prop contract as the mine,
// with one extra promise: every authored icicle cone stays outside the camera
// envelope. Rendering a pretty spike first and measuring it later is exactly
// the unsafe direction this module exists to prevent.
section('Glacier ice cave');
{
  let selected = 0;
  let deterministic = true;
  let validInterval = true;
  let validEnvelope = true;
  let validDressing = true;
  let propViolations = 0;
  let wantedProps = 0;
  let placedProps = 0;
  let sparsestPropRatio = 1;
  let smallestPropMargin = Infinity;
  let smallestIcicleClearance = Infinity;
  const fingerprints = new Set<string>();

  for (const archetype of ARCHETYPE_NAMES) {
    for (let i = 0; i < 12; i++) {
      const seed = `ICE_CAVE_${archetype}_${i}`;
      const spec = generateSpec(seed, { archetype, palette: 'glaciar' });
      const track = buildTrack(spec.track);
      const first = buildGlacierIceCaveLayout(track, seed);
      const second = buildGlacierIceCaveLayout(track, seed);
      if (JSON.stringify(first) !== JSON.stringify(second)) deterministic = false;
      if (!first) continue;

      selected++;
      fingerprints.add(JSON.stringify(first));
      validInterval &&=
        first.startS >= ICE_CAVE_GRID_BUFFER - 1e-9 &&
        first.endS <= track.finishS - ICE_CAVE_FINISH_BUFFER + 1e-9 &&
        first.length >= ICE_CAVE_MIN_LENGTH - 1e-9 &&
        first.metrics.minTangentDot >= Math.cos(ICE_CAVE_MAX_TANGENT_ANGLE) - 1e-9 &&
        first.metrics.maxSlope <= ICE_CAVE_MAX_SLOPE + 1e-9;
      validEnvelope &&=
        first.metrics.maxTrackAxisOffset + track.tubeRadius < first.interiorRadius &&
        first.metrics.maxCameraAxisOffset <= first.cameraEnvelopeRadius + 1e-9 &&
        first.cameraEnvelopeRadius < first.interiorRadius &&
        first.metrics.nearestOtherTrack >= first.outerRadius + track.tubeRadius;

      for (const icicle of first.icicles) {
        const measuredClearance =
          distanceToSetPieceAxis(icicle.tip, first.entrance.p, first.axis) -
          icicle.radius -
          first.cameraEnvelopeRadius;
        smallestIcicleClearance = Math.min(smallestIcicleClearance, measuredClearance);
        validDressing &&=
          icicle.s > first.startS &&
          icicle.s < first.endS &&
          icicle.radius > 0 &&
          icicle.length > 0 &&
          Math.abs(icicle.cameraClearance - measuredClearance) < 1e-9 &&
          measuredClearance >= ICE_CAVE_ICICLE_CAMERA_MARGIN - 1e-9;
      }
      validDressing &&=
        first.ridges.length >= 3 &&
        first.ridges.every((ridge) => ridge.s > first.startS && ridge.s < first.endS) &&
        first.icicles.length >= 4 &&
        first.glows.length >= 2 &&
        first.propExclusion.points.length >= 3 &&
        first.spectatorExclusion.startS < first.startS &&
        first.spectatorExclusion.endS > first.endS &&
        [first.startS, (first.startS + first.endS) * 0.5, first.endS].every((s) => {
          const relocated = relocateCharacterArc(s, track.finishS, [first.spectatorExclusion]);
          return (
            relocated !== null &&
            clearsCharacterExclusions(relocated, [first.spectatorExclusion])
          );
        });

      const glacier = PALETTES.glaciar;
      const props = buildPropLayout(
        glacier,
        track,
        seed,
        (x, z) => -11 + Math.sin(x * 0.03) * 2 + Math.cos(z * 0.025) * 1.5,
        { exclusions: [first.propExclusion] },
      );
      wantedProps += glacier.propCount;
      placedProps += props.length;
      sparsestPropRatio = Math.min(sparsestPropRatio, props.length / glacier.propCount);
      for (const prop of props) {
        const margin =
          distanceToTrackPlan(prop.x, prop.z, first.propExclusion.points) -
          (first.propExclusion.radius + prop.radius);
        smallestPropMargin = Math.min(smallestPropMargin, margin);
        if (!clearsPropExclusions(prop.x, prop.z, prop.radius, [first.propExclusion])) {
          propViolations++;
        }
      }
    }
  }

  const sampleCount = ARCHETYPE_NAMES.length * 12;
  check(
    `glacier caves cover at least 95% of generated courses (${sampleCount} tracks)`,
    selected >= sampleCount * 0.95,
    `${selected}/${sampleCount} selected`,
  );
  check('same race -> byte-identical ice-cave contract', deterministic);
  check(
    'different races produce different ice-cave contracts',
    fingerprints.size === selected,
    `${fingerprints.size} distinct layouts`,
  );
  check('ice-cave intervals are straight and clear of grid/finish', validInterval);
  check('chute, chase camera and non-local track clear the ice shell', validEnvelope);
  check(
    'ridges, glows and every icicle respect the authored camera envelope',
    validDressing,
    `${smallestIcicleClearance.toFixed(3)} m tightest icicle clearance`,
  );
  check(
    'reserved cave corridors retain the glacier scenery density',
    placedProps >= wantedProps * 0.99 && sparsestPropRatio >= 0.9,
    `${placedProps}/${wantedProps} placed, ${(sparsestPropRatio * 100).toFixed(1)}% sparsest`,
  );
  check(
    'no ordinary ice shard enters a cave or portal approach',
    propViolations === 0 && smallestPropMargin >= TRACK_PLAN_SAFETY_MARGIN - 1e-9,
    `${propViolations} violations, ${smallestPropMargin.toFixed(3)} m margin`,
  );

  const outcomeSeed = 'ICE_CAVE_OUTCOME';
  const outcomeBefore = fingerprint(outcomeSeed);
  const outcomeSpec = generateSpec(outcomeSeed, { palette: 'glaciar' });
  buildGlacierIceCaveLayout(buildTrack(outcomeSpec.track), outcomeSeed);
  check(
    'ice-cave selection cannot change the race outcome',
    fingerprint(outcomeSeed) === outcomeBefore,
  );
  console.log(
    `       ${selected} caves · ${placedProps} ice shards · ` +
      `${(sparsestPropRatio * 100).toFixed(1)}% sparsest layout · ` +
      `${smallestPropMargin.toFixed(2)} m prop margin · ` +
      `${smallestIcicleClearance.toFixed(2)} m icicle margin`,
  );
}

// ---------------------------------------------------------------- races
section('Race outcomes');
{
  const SAMPLE = 120;
  const winners = new Map<number, number>();
  let finished = 0;
  let inWindow = 0;
  let totalDuration = 0;
  let closest = Infinity;

  for (let i = 0; i < SAMPLE; i++) {
    const spec = generateSpec(`RACE${i}`);
    const summary = simulate(spec);
    const winnerId = spec.marbles.find((m) => m.name === summary.finishOrder[0].name)!.id;
    winners.set(winnerId, (winners.get(winnerId) ?? 0) + 1);
    if (summary.metrics.allFinished) finished++;
    if (summary.metrics.duration >= 30 && summary.metrics.duration <= 95) inWindow++;
    totalDuration += summary.metrics.duration;
    closest = Math.min(closest, summary.metrics.finishMargin);
  }

  check('every grid slot wins sometimes', winners.size === 8, `${winners.size} distinct winners`);
  check('everyone finishes', finished === SAMPLE, `${SAMPLE - finished} races had a DNF`);
  check(
    'raw durations are mostly in a usable range',
    inWindow / SAMPLE > 0.8,
    `${((inWindow / SAMPLE) * 100).toFixed(0)}% in 30-95 s`,
  );
  console.log(`       mean duration ${(totalDuration / SAMPLE).toFixed(1)} s, closest finish ${closest.toFixed(3)} s`);
}

// ---------------------------------------------------------------- curation
section('Curation');
{
  const rounds = 12;
  const candidates = 20;
  let curatedScore = 0;
  let rawScore = 0;
  let slowest = 0;

  for (let r = 0; r < rounds; r++) {
    const seeds = Array.from({ length: candidates }, (_, i) => `CUR${r}_${i}`);
    const started = performance.now();
    const result = curate({ seeds });
    const elapsed = performance.now() - started;
    slowest = Math.max(slowest, elapsed);
    curatedScore += result.best.scored.score;
    rawScore += scoreRace(simulate(generateSpec(seeds[0])).metrics).score;
  }

  const curatedMean = curatedScore / rounds;
  const rawMean = rawScore / rounds;
  check(
    'curation beats picking the first seed',
    curatedMean > rawMean,
    `${curatedMean.toFixed(3)} vs ${rawMean.toFixed(3)}`,
  );
  check(
    `curating ${candidates} candidates stays well inside a request`,
    slowest < 8000,
    `${slowest.toFixed(0)} ms worst case`,
  );
  console.log(
    `       curated ${curatedMean.toFixed(3)} / uncurated ${rawMean.toFixed(3)} — worst ${slowest.toFixed(0)} ms`,
  );
}

// ---------------------------------------------------------------- video maths
section('Export arithmetic');
{
  const spec = generateSpec('VIDEO1');
  const summary = simulate(spec);
  const frames30 = Math.round(summary.videoDuration * 30);
  check('video duration includes countdown and outro', summary.videoDuration > summary.endTime);
  check(
    'countdown and outro are accounted for exactly',
    Math.abs(summary.videoDuration - (summary.endTime + OUTRO)) < 1e-9,
  );
  check('frame count is finite and sane', frames30 > 30 * (COUNTDOWN + 10) && frames30 < 30 * 200);
  console.log(
    `       ${summary.videoDuration.toFixed(2)} s of video = ${frames30} frames at 30 fps ` +
      `(dt ${PHYSICS.dt.toFixed(5)})`,
  );
}

// ---------------------------------------------------------------- render presets
//
// The ETA these produce is printed on the export button, which makes it a
// promise. The last time it was wrong it was wrong by 15x — it offered "1 min
// 12 s" for an export that took 5 s — and nothing in this suite would have
// noticed. These checks exist so that particular silence cannot happen twice.
section('Render presets and cost model');
{
  const machine = { rasterFps: 120, pipelineFps: 60 };
  const cheap = { rasterFps: 6, pipelineFps: 4 };

  // A preset must never be able to reach the simulator. This is the rail the
  // whole feature rests on: same seed, same race, on a phone and on a
  // workstation. If a key ever appears here that the generator or sim reads,
  // share links start lying about what they show.
  const simInputs = ['seed', 'simSeed', 'archetype', 'track', 'marbles', 'version', 'generator'];
  const presetKeys = new Set(PRESETS.flatMap((preset) => Object.keys(preset)));
  check(
    'no preset field shares a name with a spec field',
    simInputs.every((key) => !presetKeys.has(key)),
  );

  check(
    'preset draw cost rises with visual level',
    drawCost(presetById('ligero')) < drawCost(presetById('estandar')) &&
      drawCost(presetById('estandar')) < drawCost(presetById('alto')) &&
      drawCost(presetById('alto')) < drawCost(presetById('ultra')),
  );

  // The reason the model splits draw from encode. Four sub-frames cost four
  // draws but still exactly one encode, so the total must land well below 4x.
  const oneSample = frameSeconds(machine, 1, drawCost(presetById('alto')))!;
  const fourSample = frameSeconds(machine, 1, drawCost(presetById('ultra')))!;
  check(
    'motion blur multiplies the draw, not the encode',
    fourSample < oneSample * 2 && fourSample > oneSample,
    `${(fourSample / oneSample).toFixed(2)}x for 2x the sub-frames`,
  );

  check(
    'resolution scales the estimate quadratically-ish',
    Math.abs(
      frameSeconds(machine, 4, 1)! / frameSeconds(machine, 1, 1)! - 4,
    ) < 1e-9,
  );

  check('an unmeasured machine gets no estimate', exportSeconds(null, 1, 1, 100) === null);
  check(
    'a nonsense measurement gets no estimate',
    exportSeconds({ rasterFps: 0, pipelineFps: 0 }, 1, 1, 100) === null,
  );

  // The ladder is a taste judgement, but it has to be monotonic or the planner
  // walking it backwards would return something cheaper than a rung it skipped.
  const allQualities = QUALITIES.map((q) => q.id);
  const fastMachine: PlanCapability = {
    supported: allQualities,
    postFX: true,
    benchmark: machine,
  };
  const costs = LADDER.map((plan) => planSeconds(fastMachine, plan, 60)!);
  check(
    'the ladder never gets cheaper as it climbs',
    costs.every((cost, i) => i === 0 || cost >= costs[i - 1]),
    costs.map((c) => c.toFixed(1)).join(' / '),
  );

  // The point of the whole inversion: a bigger budget can only ever buy the
  // same or more, never less.
  const budgets = [5, 15, 30, 60, 300];
  const rungOf = (plan: { qualityId: string; presetId: string }): number =>
    LADDER.findIndex((rung) => rung.qualityId === plan.qualityId && rung.presetId === plan.presetId);
  const chosen = budgets.map((seconds) => rungOf(planForBudget(fastMachine, 60, seconds)));
  check(
    'a longer wait never buys a worse video',
    chosen.every((rung, i) => i === 0 || rung >= chosen[i - 1]),
    chosen.join(' -> '),
  );

  check(
    'every plan chosen actually fits its budget',
    budgets.every((seconds) => {
      const plan = planForBudget(fastMachine, 60, seconds);
      const cost = planSeconds(fastMachine, plan, 60)!;
      // The cheapest rung is the floor: if even that overruns, it is still the
      // right answer, because there is nothing below it to fall back to.
      return cost <= seconds || plan === LADDER[0] || cost === costs[0];
    }),
  );

  // A GPU with no half-float render targets gets Ligero or nothing. Offering it
  // Ultra would not be slow, it would be black.
  const noPostFX: PlanCapability = {
    supported: allQualities,
    postFX: false,
    benchmark: machine,
  };
  check(
    'a GPU without post-processing is never planned above Ligero',
    budgets.every((seconds) => planForBudget(noPostFX, 60, seconds).presetId === 'ligero'),
  );

  // The preset drives the LIVE PREVIEW as well as the export, so an unmeasured
  // machine must not be dropped to the cheapest tier — that would make the app
  // look worse for anyone who opened the link in a background tab, where the
  // probe deliberately refuses to run.
  const unmeasured: PlanCapability = { supported: allQualities, postFX: true, benchmark: null };
  const unmeasuredPlan = planForBudget(unmeasured, 60, 30);
  check(
    'an unmeasured machine still previews at the standard preset',
    unmeasuredPlan.presetId === 'estandar',
    unmeasuredPlan.presetId,
  );
  check(
    'an unmeasured machine stays conservative on resolution',
    unmeasuredPlan.qualityId === '720p30',
    unmeasuredPlan.qualityId,
  );
  check(
    'an unmeasured machine without post-processing still gets a valid plan',
    planIsAvailable(
      { supported: allQualities, postFX: false, benchmark: null },
      planForBudget({ supported: allQualities, postFX: false, benchmark: null }, 60, 30),
    ),
  );

  check(
    'a slow machine still gets a working plan, not nothing',
    planIsAvailable(
      { supported: allQualities, postFX: true, benchmark: cheap },
      planForBudget({ supported: allQualities, postFX: true, benchmark: cheap }, 60, 5),
    ),
  );

  // A browser that can only configure 720p must never be handed 4K, however
  // fast it measured.
  const only720: PlanCapability = { supported: ['720p30'], postFX: true, benchmark: machine };
  check(
    'a plan never names a resolution the browser refused',
    budgets.every((seconds) => planForBudget(only720, 60, seconds).qualityId === '720p30'),
  );

  // Measured cost must beat the static model. The static model was wrong by 6x
  // on a real GPU (Ultra: 3.2x measured vs 21.6x modelled), and an ETA that
  // pessimistic means nobody ever picks the good preset.
  const measured: PlanCapability = {
    supported: allQualities,
    postFX: true,
    benchmark: { ...machine, presetCost: { ligero: 0.9, estandar: 1, alto: 1.77, ultra: 3.21 } },
  };
  const modelledUltra = planSeconds(fastMachine, { qualityId: '1080p60', presetId: 'ultra' }, 60)!;
  const measuredUltra = planSeconds(measured, { qualityId: '1080p60', presetId: 'ultra' }, 60)!;
  check(
    'a measured preset cost overrides the static model',
    measuredUltra < modelledUltra / 4,
    `${measuredUltra.toFixed(1)} s measured vs ${modelledUltra.toFixed(1)} s modelled`,
  );

  const partial: PlanCapability = {
    supported: allQualities,
    postFX: true,
    benchmark: { ...machine, presetCost: { estandar: 1 } },
  };
  check(
    'a preset missing from the measurement falls back to the model',
    planSeconds(partial, { qualityId: '1080p60', presetId: 'ultra' }, 60) === modelledUltra,
  );
  check(
    'a zero or negative measurement is ignored rather than trusted',
    planSeconds(
      { ...partial, benchmark: { ...machine, presetCost: { ultra: 0 } } },
      { qualityId: '1080p60', presetId: 'ultra' },
      60,
    ) === modelledUltra,
  );

  // 120 fps exists but must never be planned automatically: YouTube caps
  // playback at 60, so it is double the cost for no delivered benefit.
  check('120 fps is offered but kept off the automatic ladder',
    QUALITIES.some((q) => q.id === '1080p120') &&
      !LADDER.some((rung) => rung.qualityId === '1080p120'));

  const reference = planSeconds(fastMachine, { qualityId: '1080p60', presetId: 'ultra' }, 60)!;
  console.log(
    `       1080p60 Ultra on a ${machine.pipelineFps} fps machine = ${reference.toFixed(1)} s for a 60 s race`,
  );
}

// ---------------------------------------------------------------- audio
//
// The soundtrack is generated, not sampled, which means it is arithmetic — and
// arithmetic is testable in node. These checks exist because the alternative way
// to find out that the music drifted is to export a video and listen to it.
section('Soundtrack');
{
  const spec = generateSpec('AUDIO1');
  const summary = simulate(spec, undefined, { trace: true });
  const score = buildScore(spec, summary);

  // Same rule as the race itself: a shared link must sound the same for
  // everyone who opens it.
  const rebuild = (seed: string) => {
    const s = generateSpec(seed);
    return buildScore(s, simulate(s, undefined, { trace: true }));
  };
  check('same seed -> byte-identical score', JSON.stringify(rebuild('AUDIO1')) === JSON.stringify(score));
  check(
    'different seeds -> different soundtracks',
    JSON.stringify(rebuild('AUDIO2')) !== JSON.stringify(score),
  );

  // The soundtrack must be exactly as long as the video it goes under. A score
  // that overruns is audio muxed past the last frame; one that stops short is a
  // podium in silence.
  check(
    'score duration is exactly the video duration',
    Math.abs(score.duration - summary.videoDuration) < 1e-9,
    `${score.duration.toFixed(3)} vs ${summary.videoDuration.toFixed(3)}`,
  );
  check('nothing is scheduled past the end', score.music.every((n) => n.t < score.duration));
  check('nothing is scheduled before the first frame', score.music.every((n) => n.t >= 0));

  // The claim the whole arrangement rests on: the drop lands ON lights-out, not
  // near it. BAR_ZERO is chosen so two intro bars end exactly there.
  check(
    'the bar grid puts the drop exactly on lights-out',
    Math.abs(BAR_ZERO + INTRO_BARS * BAR - score.dropAt) < 1e-9,
    `${(BAR_ZERO + INTRO_BARS * BAR).toFixed(6)} vs ${score.dropAt}`,
  );
  check(
    'every note lands on the sixteenth-note grid',
    score.music.every((n) => {
      const steps = (n.t - BAR_ZERO) / (BAR / 16);
      return Math.abs(steps - Math.round(steps)) < 1e-6;
    }),
  );
  // Drums only after the lights go out — an intro with a beat in it is not an
  // intro.
  check(
    'the beat starts at the drop, not before',
    score.music
      .filter((n) => n.voice === 'kick' || n.voice === 'snare')
      .every((n) => n.t >= BAR_ZERO + BAR),
  );

  // The rail, in so many words: an effect is short, it fades in, and it fades
  // out. Checked against the table rather than any one effect, so a new one
  // cannot quietly opt out of the rule.
  const kinds = Object.keys(SFX_SHAPES) as SfxKind[];
  check(
    'every sound effect fades in and fades out',
    kinds.every((k) => SFX_SHAPES[k].attack > 0 && SFX_SHAPES[k].release > 0),
    kinds.filter((k) => SFX_SHAPES[k].attack <= 0 || SFX_SHAPES[k].release <= 0).join(', '),
  );
  check(
    `every sound effect is shorter than ${SFX_MAX_SECONDS} s`,
    kinds.every((k) => sfxSeconds(k) <= SFX_MAX_SECONDS),
    kinds.map((k) => `${k} ${sfxSeconds(k).toFixed(2)}`).join(' '),
  );
  check(
    'no effect is cut off by the end of the file',
    score.sfx.every((hit) => hit.t + sfxSeconds(hit.kind) <= score.duration),
  );
  check(
    'effects are ordered in time',
    score.sfx.every((hit, i) => i === 0 || hit.t >= score.sfx[i - 1].t),
  );
  check(
    'every effect is panned and levelled within range',
    score.sfx.every((h) => h.pan >= -1 && h.pan <= 1 && h.gain >= 0 && h.gain <= 1),
  );
  check('the five start lights each get a beep', score.sfx.filter((h) => h.kind === 'beep').length === 5);
  check(
    'the crowd rises from the countdown and falls to silence',
    score.crowd.length > 4 &&
      score.crowd[0].level < 0.2 &&
      score.crowd[score.crowd.length - 1].level === 0 &&
      score.crowd.every((p, i) => i === 0 || p.t >= score.crowd[i - 1].t),
  );

  // Contact events are what the impact sounds are written against, and they are
  // opt-in so that curation — twenty sims per request — does not pay for them.
  const traced = simulate(generateSpec('AUDIO1'), undefined, { trace: true });
  const untraced = simulate(generateSpec('AUDIO1'));
  check('contact events appear only when asked for', untraced.events.every((e) => e.kind !== 'collide'));
  check('tracing records contacts', traced.events.some((e) => e.kind === 'collide'));
  check(
    'the trace cannot change the race',
    JSON.stringify(traced.finishOrder) === JSON.stringify(untraced.finishOrder),
  );
  check('the tension curve is bounded', traced.tension.every((t) => t.level >= 0 && t.level <= 1));

  console.log(
    `       ${score.music.length} notes, ${score.sfx.length} effects, ` +
      `${score.crowd.length} crowd points over ${score.duration.toFixed(1)} s at ${score.bpm} BPM`,
  );
}

// ---------------------------------------------------------------- the cast
section('The cast');
{
  const worlds = PALETTE_NAMES.map((n) => PALETTES[n]);
  check(
    'every world has characters in it',
    worlds.every((w) => w.characters.length > 0 && w.characterCount > 0),
    worlds.filter((w) => w.characters.length === 0).map((w) => w.name).join(', '),
  );
  // Each character is its own Group and therefore its own handful of draw
  // calls. This is a budget, not a preference.
  check('no world puts more than a dozen characters trackside', worlds.every((w) => w.characterCount <= 12));
  const surfaceCast = new Set(worlds.filter((w) => w.kind === 'surface').flatMap((w) => w.characters));
  check(
    'the surface worlds have their own residents, not one shared mascot',
    surfaceCast.size >= 6,
    [...surfaceCast].join(', '),
  );
}

// ---------------------------------------------------------------- memory
//
// A phone that runs out of video memory does not render slowly — the tab
// reloads, and the user calls that "it restarted". The budget is the only thing
// between a 1080p Alto export and exactly that, so it is checked here rather
// than discovered on a tester's iPhone.
section('Device memory budget');
{
  const MB = 1024 * 1024;
  const ultra1080 = postFXBytes(1920, 1080, 2);
  // Two 3840x2160 half-float targets are 63 MiB each; the bloom chain adds
  // another 0.625 of one. The number is asserted rather than described because
  // the first version of this comment said "66 MB" — which is the cost of ONE
  // target, not of the pipeline, and the whole budget is downstream of it.
  check(
    '1080p at 2x supersampling costs ~166 MiB, not ~66',
    ultra1080 > 150 * MB && ultra1080 < 180 * MB,
    `${(ultra1080 / MB).toFixed(1)} MiB`,
  );
  check(
    'a 96 MB phone budget refuses 2x supersampling at 1080p',
    affordableSupersample(1920, 1080, 2, 96 * MB) === 1,
  );
  check('a 512 MB desktop budget allows it', affordableSupersample(1920, 1080, 2, 512 * MB) === 2);
  // The top rung of the ladder must survive the guard on the machines it was
  // written for. A budget that silently clamps 4K Ultra everywhere would make
  // the export panel promise something it never delivers.
  check(
    'the desktop budget still allows 4K at 2x supersampling',
    affordableSupersample(3840, 2160, 2, deviceProfile().postFXBudget) === 2 ||
      deviceProfile().constrained,
    `${(postFXBytes(3840, 2160, 2) / MB).toFixed(0)} MiB needed`,
  );
  check(
    'the clamp never drops below 1, however small the budget',
    affordableSupersample(3840, 2160, 2, 1) === 1,
  );
  check('a phone can still run the post pipeline at 1x', canAffordPostFX(1920, 1080, 96 * MB));
  console.log(
    `       1080p: 1x ${(postFXBytes(1920, 1080, 1) / MB).toFixed(0)} MB, ` +
      `2x ${(ultra1080 / MB).toFixed(0)} MB · ` +
      `4K 2x ${(postFXBytes(3840, 2160, 2) / MB).toFixed(0)} MB`,
  );
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks\n`);
process.exit(failures === 0 ? 1 * 0 : 1);
