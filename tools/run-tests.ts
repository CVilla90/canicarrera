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
// Client-side, but deliberately DOM-free so it can be checked here rather than
// only in a browser nobody is watching.
import { PRESETS, presetById, drawCost } from '../client/render/presets.ts';
import { frameSeconds, exportSeconds } from '../client/render/cost.ts';
import {
  LADDER,
  planForBudget,
  planSeconds,
  planIsAvailable,
  type PlanCapability,
} from '../client/render/budget.ts';
import { QUALITIES } from '../client/export/quality.ts';

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

  const reference = planSeconds(fastMachine, { qualityId: '1080p60', presetId: 'ultra' }, 60)!;
  console.log(
    `       1080p60 Ultra on a ${machine.pipelineFps} fps machine = ${reference.toFixed(1)} s for a 60 s race`,
  );
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks\n`);
process.exit(failures === 0 ? 1 * 0 : 1);
