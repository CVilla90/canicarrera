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
import { generateSpec } from '../shared/generator.ts';
import { RaceSim, simulate, COUNTDOWN, OUTRO } from '../shared/sim.ts';
import { curate, scoreRace } from '../shared/curate.ts';
import { randomSeed, normaliseSeed, stream, COSMETIC } from '../shared/rng.ts';
import { buildTrack, selfIntersects } from '../shared/track.ts';
import { PHYSICS } from '../shared/spec.ts';

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
  check('all 5 archetypes appear', archetypes.size === 5, [...archetypes].join(', '));
  check('all 6 palettes appear', palettes.size === 6, [...palettes].join(', '));
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

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks\n`);
process.exit(failures === 0 ? 1 * 0 : 1);
