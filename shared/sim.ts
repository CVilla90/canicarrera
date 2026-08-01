/**
 * The simulator.
 *
 * There is no physics engine and no rendering here. Marbles are constrained to
 * the track curve and integrated in 1-D along its arc length, which is why a
 * 60-second race costs a few milliseconds of CPU — cheap enough that the server
 * can simulate 20 candidate races before choosing one, and cheap enough that a
 * phone can replay a race while it encodes video.
 *
 * Determinism rules, all of them load-bearing:
 *   - fixed DT, always stepped whole; sim time is `steps * DT`, never a clock
 *   - every random draw comes from a labelled stream keyed on the seed
 *   - no Math.random, no Date, no iteration over object keys
 *   - sorts are total (ties broken by id) so engine sort differences can't bite
 */
import { PHYSICS, type RaceMetrics, type RaceSpec } from './spec.ts';
import { SIM_STREAMS, stream, type Rng } from './rng.ts';
import { buildTrack, type Track } from './track.ts';
import type { TrackFrame } from './curve.ts';
import { Vec3, clamp } from './vec3.ts';

/** Seconds of start-light sequence before the race. Included in exported video. */
export const COUNTDOWN = 3;
/** Seconds held on the podium after the race ends. Also part of the video. */
export const OUTRO = 4.5;

export type RacePhase = 'countdown' | 'racing' | 'finished';

export interface MarbleState {
  id: number;
  name: string;
  /** Arc length along the track, metres. */
  s: number;
  /** Speed along the track, m/s. */
  v: number;
  /** Ornstein-Uhlenbeck luck term. */
  wander: number;
  finished: boolean;
  finishTime: number;
  /** 1-based; 0 until it finishes. */
  place: number;
  /** Total rolled angle, radians — the renderer spins the mesh by this. */
  spin: number;
  rng: Rng;
}

export interface SimEvent {
  t: number;
  kind: 'go' | 'finish' | 'overtake' | 'end';
  marbleId?: number;
  place?: number;
}

export class RaceSim {
  readonly spec: RaceSpec;
  readonly track: Track;
  readonly marbles: MarbleState[];
  readonly finishOrder: MarbleState[] = [];
  readonly events: SimEvent[] = [];

  /** Total elapsed sim time, including the countdown. `steps * DT` exactly. */
  time = 0;
  steps = 0;
  phase: RacePhase = 'countdown';
  /** Sim time at which the race ended. 0 until it does. */
  endTime = 0;

  private leaderId = -1;
  private sampleAccumulator = 0;
  private samples = 0;
  private leadChanges = 0;
  private lateChanges = 0;
  private maxGap = 0;
  private leaderSamples = new Map<number, number>();

  constructor(spec: RaceSpec, track?: Track) {
    this.spec = spec;
    this.track = track ?? buildTrack(spec.track);
    this.marbles = spec.marbles.map((m) => ({
      id: m.id,
      name: m.name,
      // Staggered grid, two per row, so nobody starts perfectly level.
      s: 3 - Math.floor(m.slot / 2) * 0.95,
      v: 0,
      wander: 0,
      finished: false,
      finishTime: 0,
      place: 0,
      spin: 0,
      rng: stream(spec.simSeed, SIM_STREAMS.wander(m.id)),
    }));
  }

  /** Race clock in seconds: 0 at lights-out, negative during the countdown. */
  get raceTime(): number {
    return this.time - COUNTDOWN;
  }

  /** Seconds left on the countdown, 3 -> 0. */
  get countdownLeft(): number {
    return Math.max(0, COUNTDOWN - this.time);
  }

  /** Lateral angle of a marble inside the tube. Feeds collisions, so it is sim. */
  theta(id: number): number {
    const spec = this.spec.marbles[id];
    const rt = Math.max(0, this.raceTime);
    return spec.lane * 0.55 + Math.sin(rt * spec.swayFreq + spec.swayPhase) * spec.swayAmp;
  }

  /** World position of a marble, inside the tube wall. */
  position(id: number, out = new Vec3(), frame?: TrackFrame): Vec3 {
    const m = this.marbles[id];
    const fr = this.track.table.frameAt(m.s, frame);
    const th = this.theta(id);
    const offset = this.track.tubeRadius - PHYSICS.marbleRadius - 0.05;
    return out
      .copy(fr.p)
      .addScaled(fr.d, Math.cos(th) * offset)
      .addScaled(fr.side, Math.sin(th) * offset);
  }

  /** The marble furthest along, finished or not. */
  leader(): MarbleState {
    let best = this.marbles[0];
    for (const m of this.marbles) if (m.s > best.s || (m.s === best.s && m.id < best.id)) best = m;
    return best;
  }

  /** Current standings: finishers by place, then everyone else by distance. */
  standings(): MarbleState[] {
    return this.marbles.slice().sort((a, b) => {
      const pa = a.place || 99;
      const pb = b.place || 99;
      if (pa !== pb) return pa - pb;
      if (b.s !== a.s) return b.s - a.s;
      return a.id - b.id;
    });
  }

  /** Exactly one fixed substep. The only way time moves. */
  step(): void {
    const dt = PHYSICS.dt;
    this.steps++;
    this.time = this.steps * dt;

    if (this.phase === 'countdown') {
      if (this.time >= COUNTDOWN) {
        this.phase = 'racing';
        this.events.push({ t: this.time, kind: 'go' });
      }
      return;
    }
    if (this.phase === 'finished') return;

    const track = this.track;
    for (const m of this.marbles) {
      const spec = this.spec.marbles[m.id];
      const slope = track.table.slopeAt(m.s);
      // Downhill component. slope is the tangent's y, negative going down.
      let a = -PHYSICS.gravity * slope * PHYSICS.rollingFactor;
      a -= spec.mu * m.v;
      a -= spec.cd * m.v * Math.abs(m.v);

      m.wander += (m.rng.next() * 2 - 1) * PHYSICS.wanderDrive * dt;
      m.wander *= Math.exp(-PHYSICS.wanderDecay * dt);
      m.wander = clamp(m.wander, -PHYSICS.wanderClamp, PHYSICS.wanderClamp);

      if (m.finished) a -= PHYSICS.brake * m.v;
      else a += m.wander;

      m.v = Math.max(0, m.v + a * dt);
      m.s += m.v * dt;
      m.spin += (m.v * dt) / PHYSICS.marbleRadius;

      if (m.s > track.total - 0.8) {
        m.s = track.total - 0.8;
        m.v = 0;
      }

      if (!m.finished && m.s >= track.finishS) {
        m.finished = true;
        m.finishTime = this.raceTime;
        m.place = this.finishOrder.length + 1;
        this.finishOrder.push(m);
        this.events.push({ t: this.time, kind: 'finish', marbleId: m.id, place: m.place });
      }
    }

    this.collide();
    this.sample(dt);

    if (this.finishOrder.length === this.marbles.length) this.end();
    else if (
      this.finishOrder.length > 0 &&
      this.raceTime > this.finishOrder[0].finishTime + PHYSICS.stragglerTimeout
    ) {
      this.end();
    } else if (this.raceTime > PHYSICS.maxRaceSeconds) {
      this.end();
    }
  }

  /** Advances until sim time reaches `target`, in whole substeps. */
  advanceTo(target: number): void {
    let guard = 40000;
    while (this.time < target && guard-- > 0) this.step();
  }

  private collide(): void {
    const order = this.marbles.slice().sort((a, b) => a.s - b.s || a.id - b.id);
    const rOff = this.track.tubeRadius - PHYSICS.marbleRadius - 0.05;
    const minD = PHYSICS.marbleRadius * 2 * 0.96;
    for (let i = 0; i < order.length - 1; i++) {
      const a = order[i];
      const b = order[i + 1];
      const ds = b.s - a.s;
      if (ds >= minD) continue;
      const dLat = Math.abs(this.theta(a.id) - this.theta(b.id)) * rOff;
      const gapSq = ds * ds + dLat * dLat;
      if (gapSq >= minD * minD) continue;

      if (a.v > b.v) {
        const e = PHYSICS.restitution;
        const u1 = a.v;
        const u2 = b.v;
        const m1 = this.spec.marbles[a.id].mass;
        const m2 = this.spec.marbles[b.id].mass;
        a.v = ((m1 - e * m2) * u1 + (1 + e) * m2 * u2) / (m1 + m2);
        b.v = ((m2 - e * m1) * u2 + (1 + e) * m1 * u1) / (m1 + m2);
      }
      if (dLat < PHYSICS.marbleRadius * 1.2) {
        const push = (minD - Math.sqrt(gapSq)) * 0.5;
        a.s -= push;
        b.s += push;
      }
    }
  }

  /** Curation metrics, sampled at 5 Hz so noise doesn't inflate lead changes. */
  private sample(dt: number): void {
    this.sampleAccumulator += dt;
    if (this.sampleAccumulator < 0.2) return;
    this.sampleAccumulator = 0;
    this.samples++;

    let lead = this.marbles[0];
    let second = this.marbles[0];
    let last = this.marbles[0];
    for (const m of this.marbles) {
      if (m.s > lead.s) {
        second = lead;
        lead = m;
      } else if (m.s > second.s && m.id !== lead.id) second = m;
      if (m.s < last.s) last = m;
    }

    this.leaderSamples.set(lead.id, (this.leaderSamples.get(lead.id) ?? 0) + 1);
    this.maxGap = Math.max(this.maxGap, lead.s - last.s);

    // Hysteresis: a swap only counts once the new leader is clearly ahead,
    // otherwise two marbles side by side would register dozens of "changes".
    if (this.leaderId !== lead.id && lead.s - second.s > 0.4) {
      if (this.leaderId !== -1) {
        this.leadChanges++;
        const progress = lead.s / this.track.finishS;
        if (progress > 0.75) this.lateChanges++;
        this.events.push({ t: this.time, kind: 'overtake', marbleId: lead.id });
      }
      this.leaderId = lead.id;
    }
  }

  private end(): void {
    this.phase = 'finished';
    this.endTime = this.time;
    // Anyone still rolling is classified by distance covered.
    const rest = this.marbles
      .filter((m) => !m.finished)
      .sort((a, b) => b.s - a.s || a.id - b.id);
    for (const m of rest) {
      m.place = this.finishOrder.length + 1;
      this.finishOrder.push(m);
    }
    this.events.push({ t: this.time, kind: 'end' });
  }

  metrics(): RaceMetrics {
    const finishers = this.finishOrder.filter((m) => m.finishTime > 0);
    const winner = this.finishOrder[0];
    const duration = winner?.finishTime ?? this.raceTime;
    const second = finishers[1];
    const last = finishers[finishers.length - 1];
    return {
      duration,
      finishMargin: second ? second.finishTime - duration : 99,
      spread: last ? last.finishTime - duration : 99,
      leadChanges: this.leadChanges,
      lateChanges: this.lateChanges,
      frontRunning: winner ? (this.leaderSamples.get(winner.id) ?? 0) / Math.max(this.samples, 1) : 1,
      maxGap: this.maxGap,
      allFinished: finishers.length === this.marbles.length,
    };
  }
}

export interface SimSummary {
  metrics: RaceMetrics;
  /** Sim time when the race ended, including the countdown. */
  endTime: number;
  /** Total video length if this race were exported. */
  videoDuration: number;
  finishOrder: { id: number; name: string; place: number; finishTime: number }[];
}

/**
 * Runs a race to completion with no rendering. This is what the curator calls
 * 20 times per request, and what the exporter calls once to learn how many
 * frames it is about to draw.
 */
export function simulate(spec: RaceSpec, track?: Track): SimSummary {
  const sim = new RaceSim(spec, track);
  let guard = Math.ceil((PHYSICS.maxRaceSeconds + COUNTDOWN) / PHYSICS.dt) + 10;
  while (sim.phase !== 'finished' && guard-- > 0) sim.step();
  return {
    metrics: sim.metrics(),
    endTime: sim.endTime,
    videoDuration: sim.endTime + OUTRO,
    finishOrder: sim.finishOrder.map((m) => ({
      id: m.id,
      name: m.name,
      place: m.place,
      finishTime: m.finishTime,
    })),
  };
}
