/**
 * The renderer.
 *
 * It owns three.js and nothing else. It does not decide who wins, how long the
 * race lasts, or what the track looks like — it reads a spec, drives a
 * `RaceSim`, and draws whatever the simulator says is true. That separation is
 * what makes a Blender path later a second consumer rather than a rewrite.
 *
 * Realtime playback and offline export call the same `update` + `draw` pair;
 * the only difference is where dt comes from.
 */
import {
  AdditiveBlending,
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  BackSide,
  DynamicDrawUsage,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Quaternion,
  Scene,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
  WebGLRenderer,
  ACESFilmicToneMapping,
  SRGBColorSpace,
} from 'three';

/** Torus geometry points along +Z, so this is the axis every ring is aimed from. */
const FORWARD = new Vector3(0, 0, 1);

import { RaceSim, COUNTDOWN, type RacePhase } from '@shared/sim.ts';
import { buildTrack, type Track } from '@shared/track.ts';
import { PHYSICS, type RaceSpec } from '@shared/spec.ts';
import { PALETTES, hslToHex } from '@shared/palette.ts';
import { COSMETIC, stream } from '@shared/rng.ts';
import { clamp } from '@shared/vec3.ts';
import { SharedCurve } from './SharedCurve.ts';

export interface StandingRow {
  id: number;
  name: string;
  color: string;
  /** 0-1 along the track. */
  progress: number;
  speed: number;
  finished: boolean;
  finishTime: number;
  place: number;
}

export interface SceneSnapshot {
  phase: RacePhase;
  raceTime: number;
  countdownLeft: number;
  standings: StandingRow[];
  leaderId: number;
  leaderColor: string;
  /** Name of the track section the leader is in, for the HUD. */
  section: string | null;
  /** Gap in metres between first and second. */
  battleGap: number;
}

const SECTION_LABELS: Record<string, string> = {
  ramp: 'Recta',
  sweep: 'Curva larga',
  chicane: 'Chicana',
  spiral: 'Espiral',
  plunge: 'Caída',
  roller: 'Rizos',
  hairpin: 'Horquilla',
  runout: 'Recta final',
};

export class RaceScene {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;

  sim: RaceSim | null = null;
  track: Track | null = null;
  spec: RaceSpec | null = null;

  /**
   * Pushed to the HUD, at most 10 times a second, from inside the frame loop.
   *
   * Not a `setInterval` on the React side: browsers throttle timers hard in
   * background tabs, so a polled HUD drifts out of sync with the canvas — and
   * during an export, where there is no rAF at all, it would freeze outright.
   */
  onSnapshot: ((snapshot: SceneSnapshot) => void) | null = null;
  private lastSnapshotAt = 0;

  private trackGroup: Group | null = null;
  private marbleMeshes: Mesh[] = [];
  private lastSpin: number[] = [];
  private starField: Points | null = null;
  private confetti: { points: Points; vel: Vector3[]; life: number } | null = null;
  private confettiFired = false;

  private readonly camTarget = new Vector3();
  private readonly camLook = new Vector3();
  private orbitAngle = 0;
  private accumulator = 0;
  private rafId = 0;
  private running = false;
  private lastFrameTime = 0;

  private readonly tmpVec = new Vector3();
  private readonly marbleGeo = new SphereGeometry(PHYSICS.marbleRadius, 24, 16);
  private readonly capGeo = new SphereGeometry(0.085, 10, 8);

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      // Needed so the exporter can lift a frame out of the canvas after the
      // event loop has had a chance to composite. Costs a little bandwidth;
      // buys a pipeline that cannot silently produce black video.
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.camera = new PerspectiveCamera(58, 16 / 9, 0.1, 900);
    this.scene.add(this.camera);
  }

  // -------------------------------------------------------------- lifecycle

  /** Swaps in a new race. Safe to call repeatedly; disposes the previous one. */
  load(spec: RaceSpec): void {
    this.disposeRace();
    this.spec = spec;
    this.track = buildTrack(spec.track);
    this.sim = new RaceSim(spec, this.track);
    this.accumulator = 0;
    this.orbitAngle = 0;
    this.confettiFired = false;

    const palette = PALETTES[spec.palette];
    this.scene.background = new Color(palette.background);
    this.scene.fog = new Fog(palette.background, palette.fogNear, palette.fogFar);

    this.buildLights();
    this.buildStars();
    this.buildTrackMesh();
    this.buildMarbles();
    this.resetCamera();
    this.updateVisuals(0);
  }

  /** Rewinds to the grid without rebuilding geometry — used before an export. */
  restart(): void {
    if (!this.spec || !this.track) return;
    this.sim = new RaceSim(this.spec, this.track);
    this.accumulator = 0;
    this.orbitAngle = 0;
    this.confettiFired = false;
    this.clearConfetti();
    this.lastSpin = this.spec.marbles.map(() => 0);
    for (const mesh of this.marbleMeshes) mesh.rotation.set(0, 0, 0);
    this.resetCamera();
    this.updateVisuals(0);
  }

  /**
   * Browsers stop firing rAF in a hidden tab, so playback pauses there — which
   * is the behaviour we want (nobody wants to come back to a race they missed).
   * This just makes sure the first frame after returning does not try to
   * integrate the entire time the tab spent in the background.
   */
  private readonly onVisibility = (): void => {
    if (!document.hidden) {
      this.lastFrameTime = performance.now();
      this.accumulator = 0;
    }
  };

  start(): void {
    if (this.running) return;
    this.running = true;
    document.addEventListener('visibilitychange', this.onVisibility);
    this.lastFrameTime = performance.now();
    const tick = (now: number): void => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(tick);
      const dt = Math.min((now - this.lastFrameTime) / 1000, 0.25);
      this.lastFrameTime = now;
      this.advanceRealtime(dt);
      this.updateVisuals(dt);
      this.draw();
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  get isRunning(): boolean {
    return this.running;
  }

  setSize(width: number, height: number, updateStyle = true): void {
    this.renderer.setSize(width, height, updateStyle);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  setPixelRatio(ratio: number): void {
    this.renderer.setPixelRatio(ratio);
  }

  draw(): void {
    this.renderer.render(this.scene, this.camera);
  }

  // -------------------------------------------------------------- time

  /** Wall-clock playback. Consumes whole substeps, so the result is unchanged. */
  private advanceRealtime(dt: number): void {
    if (!this.sim) return;
    this.accumulator += dt;
    let guard = 400;
    while (this.accumulator >= PHYSICS.dt && guard-- > 0) {
      this.sim.step();
      this.accumulator -= PHYSICS.dt;
    }
    if (guard <= 0) this.accumulator = 0;
  }

  /**
   * Offline advance for export: no clock anywhere. Frame n renders exactly
   * n / fps seconds of race, which is what makes the video's timing correct.
   */
  renderFrameAt(time: number, frameDt: number): void {
    if (!this.sim) return;
    this.sim.advanceTo(time);
    this.updateVisuals(frameDt);
    this.draw();
  }

  // -------------------------------------------------------------- build

  private buildLights(): void {
    const palette = PALETTES[this.spec!.palette];
    const group = new Group();
    group.name = 'lights';
    group.add(new HemisphereLight(palette.fillLight, palette.groundLight, 1.6));
    const key = new DirectionalLight(palette.keyLight, 2.2);
    key.position.set(30, 60, 20);
    group.add(key);
    const rim = new DirectionalLight(palette.fillLight, 0.9);
    rim.position.set(-40, 20, -30);
    group.add(rim);
    group.add(new AmbientLight(palette.fillLight, 0.35));
    this.scene.add(group);
    this.lightGroup = group;
  }

  private lightGroup: Group | null = null;

  private buildStars(): void {
    const palette = PALETTES[this.spec!.palette];
    const rng = stream(this.spec!.seed, COSMETIC.stars);
    const n = palette.starCount;
    const pos = new Float32Array(n * 3);
    // Centre the field on the middle of the track so a long course does not run
    // out of sky.
    const mid = this.track!.table.frameAt(this.track!.total * 0.5).p;
    for (let i = 0; i < n; i++) {
      const u = rng.next() * 2 - 1;
      const phi = rng.next() * Math.PI * 2;
      const r = rng.range(180, 420);
      const sq = Math.sqrt(1 - u * u);
      pos[3 * i] = mid.x + r * sq * Math.cos(phi);
      pos[3 * i + 1] = mid.y + r * u * 0.7 + 40;
      pos[3 * i + 2] = mid.z + r * sq * Math.sin(phi);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    this.starField = new Points(
      geo,
      new PointsMaterial({
        color: palette.star,
        size: 1.1,
        transparent: true,
        opacity: 0.85,
        fog: false,
        depthWrite: false,
      }),
    );
    this.scene.add(this.starField);
  }

  private buildTrackMesh(): void {
    const track = this.track!;
    const palette = PALETTES[this.spec!.palette];
    const group = new Group();
    group.name = 'track';

    const curve = new SharedCurve(track.spline);
    const tubular = clamp(Math.round(track.total / 0.9), 240, 1600);
    const tubeGeo = new TubeGeometry(curve, tubular, track.tubeRadius, 16, false);

    group.add(
      new Mesh(
        tubeGeo,
        new MeshStandardMaterial({
          color: palette.glass,
          metalness: 0.1,
          roughness: 0.22,
          transparent: true,
          // Back faces only. Drawing both walls stacks the tint twice and puts
          // a foggy near wall between the camera and the marbles it is chasing;
          // showing just the far wall reads as a clean channel from outside and
          // keeps the pack legible from inside.
          opacity: palette.glassOpacity * 1.5,
          side: BackSide,
          depthWrite: false,
        }),
      ),
    );

    // Ribs every few metres instead of a wireframe.
    //
    // A wireframe over the smooth tube draws thousands of edges and reads as
    // painted solid; a coarse one reads as a low-poly debug cage. Ribs are what
    // a real marble run is actually made of, they give the tube structure
    // without noise, and — the reason they earn their cost — they stream past
    // the camera during a run, which is most of the sensation of speed.
    const ribCount = clamp(Math.floor(track.total / 5.5), 12, 220);
    const ribGeo = new TorusGeometry(track.tubeRadius + 0.03, 0.028, 6, 26);
    const ribs = new InstancedMesh(
      ribGeo,
      new MeshBasicMaterial({ color: palette.wire, transparent: true, opacity: 0.62 }),
      ribCount,
    );
    const matrix = new Matrix4();
    const quaternion = new Quaternion();
    const scale = new Vector3(1, 1, 1);
    const position = new Vector3();
    for (let i = 0; i < ribCount; i++) {
      const frame = track.table.frameAt(((i + 0.5) / ribCount) * track.total);
      position.set(frame.p.x, frame.p.y, frame.p.z);
      quaternion.setFromUnitVectors(
        FORWARD,
        this.tmpVec.set(frame.t.x, frame.t.y, frame.t.z).normalize(),
      );
      ribs.setMatrixAt(i, matrix.compose(position, quaternion, scale));
    }
    ribs.instanceMatrix.needsUpdate = true;
    group.add(ribs);

    // A ring marks every change of section, so the geometry the generator chose
    // is legible from inside the race rather than only in the spec.
    const ringGeo = new TorusGeometry(track.tubeRadius + 0.22, 0.055, 8, 40);
    track.landmarks.forEach((landmark, i) => {
      if (landmark.s <= 1 || landmark.s >= track.finishS - 2) return;
      const ring = new Mesh(
        ringGeo,
        new MeshBasicMaterial({
          color: i % 2 ? palette.ringB : palette.ringA,
          transparent: true,
          opacity: 0.8,
        }),
      );
      this.placeOnTrack(ring, landmark.s);
      group.add(ring);
    });

    // Start gate and finish arch.
    const gate = new Mesh(
      new TorusGeometry(track.tubeRadius + 0.3, 0.09, 10, 44),
      new MeshBasicMaterial({ color: palette.star, transparent: true, opacity: 0.55 }),
    );
    this.placeOnTrack(gate, 0.4);
    group.add(gate);

    const arch = new Mesh(
      new TorusGeometry(track.tubeRadius + 0.42, 0.14, 12, 48),
      new MeshBasicMaterial({ color: palette.finish }),
    );
    this.placeOnTrack(arch, track.finishS);
    group.add(arch);

    const halo = new Mesh(
      new TorusGeometry(track.tubeRadius + 0.42, 0.42, 12, 48),
      new MeshBasicMaterial({
        color: palette.finish,
        transparent: true,
        opacity: 0.14,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.placeOnTrack(halo, track.finishS);
    group.add(halo);

    this.scene.add(group);
    this.trackGroup = group;
  }

  private placeOnTrack(object: Mesh, s: number): void {
    const frame = this.track!.table.frameAt(s);
    object.position.set(frame.p.x, frame.p.y, frame.p.z);
    object.quaternion.setFromUnitVectors(
      new Vector3(0, 0, 1),
      this.tmpVec.set(frame.t.x, frame.t.y, frame.t.z).normalize(),
    );
  }

  private buildMarbles(): void {
    const spec = this.spec!;
    this.marbleMeshes = spec.marbles.map((marble) => {
      const color = new Color(hslToHex(marble.hue, marble.sat, marble.light));
      const mesh = new Mesh(
        this.marbleGeo,
        new MeshStandardMaterial({
          color,
          metalness: 0.35,
          roughness: 0.18,
          emissive: color.clone().multiplyScalar(0.28),
        }),
      );
      // A white pole makes the roll visible; without it a sphere sliding and a
      // sphere rolling look identical.
      const cap = new Mesh(this.capGeo, new MeshBasicMaterial({ color: 0xffffff }));
      cap.position.set(0, PHYSICS.marbleRadius * 0.82, 0);
      mesh.add(cap);
      this.scene.add(mesh);
      return mesh;
    });
    this.lastSpin = spec.marbles.map(() => 0);
  }

  // -------------------------------------------------------------- per frame

  private updateVisuals(dt: number): void {
    const sim = this.sim;
    const track = this.track;
    if (!sim || !track) return;

    for (const marble of sim.marbles) {
      const mesh = this.marbleMeshes[marble.id];
      if (!mesh) continue;
      const frame = track.table.frameAt(marble.s);
      const theta = sim.theta(marble.id);
      const offset = track.tubeRadius - PHYSICS.marbleRadius - 0.05;
      mesh.position.set(
        frame.p.x + frame.d.x * Math.cos(theta) * offset + frame.side.x * Math.sin(theta) * offset,
        frame.p.y + frame.d.y * Math.cos(theta) * offset + frame.side.y * Math.sin(theta) * offset,
        frame.p.z + frame.d.z * Math.cos(theta) * offset + frame.side.z * Math.sin(theta) * offset,
      );
      const deltaSpin = marble.spin - this.lastSpin[marble.id];
      if (deltaSpin > 1e-6) {
        mesh.rotateOnWorldAxis(this.tmpVec.set(frame.side.x, frame.side.y, frame.side.z), deltaSpin);
        this.lastSpin[marble.id] = marble.spin;
      }
    }

    this.updateCamera(dt);

    if (!this.confettiFired && sim.finishOrder.length > 0) {
      this.confettiFired = true;
      this.spawnConfetti();
    }
    this.updateConfetti(dt);

    if (this.onSnapshot) {
      const now = performance.now();
      if (now - this.lastSnapshotAt >= 100) {
        this.lastSnapshotAt = now;
        const snapshot = this.snapshot();
        if (snapshot) this.onSnapshot(snapshot);
      }
    }
  }

  /** Snap to where the countdown camera starts, so frame 0 is already framed. */
  private resetCamera(): void {
    const track = this.track!;
    const start = track.table.frameAt(1.5);
    const angle = -1.15;
    this.camera.position.set(
      start.p.x - start.t.x * Math.cos(angle) * 12 + start.side.x * Math.sin(angle) * 12,
      start.p.y + 5.2,
      start.p.z - start.t.z * Math.cos(angle) * 12 + start.side.z * Math.sin(angle) * 12,
    );
    const ahead = track.table.frameAt(7).p;
    this.camLook.set(ahead.x, ahead.y, ahead.z);
    this.camera.lookAt(this.camLook);
  }

  private updateCamera(dt: number): void {
    const sim = this.sim!;
    const track = this.track!;

    if (sim.phase === 'finished') {
      // Slow orbit of the finish line while the podium reads.
      this.orbitAngle += dt * 0.3;
      const centre = track.table.frameAt(track.finishS);
      this.camTarget.set(
        centre.p.x + Math.cos(this.orbitAngle) * 14,
        centre.p.y + 6.5,
        centre.p.z + Math.sin(this.orbitAngle) * 14,
      );
      this.tmpVec.set(centre.p.x, centre.p.y, centre.p.z);
    } else if (sim.phase === 'countdown') {
      // Three-quarter view of the grid, arcing slowly behind the marbles.
      // Looking straight down the tube from behind frames a black screen with a
      // ring in it and tells you nothing about the track you are about to race.
      const t = 1 - sim.countdownLeft / COUNTDOWN;
      const start = track.table.frameAt(1.5);
      const angle = -1.15 + t * 0.5;
      const distance = 12 - t * 2;
      this.camTarget.set(
        start.p.x - start.t.x * Math.cos(angle) * distance + start.side.x * Math.sin(angle) * distance,
        start.p.y + 5.2 - t * 0.7,
        start.p.z - start.t.z * Math.cos(angle) * distance + start.side.z * Math.sin(angle) * distance,
      );
      const ahead = track.table.frameAt(7 + t * 5).p;
      this.tmpVec.set(ahead.x, ahead.y, ahead.z);
    } else {
      const standings = sim.standings();
      const leader = standings[0];
      const second = standings[1];
      // Battle cam: when the front two are close, drop in behind them. The
      // camera is the only place the broadcast gets to have an opinion.
      //
      // Held off for the first seconds, because the grid is by definition a
      // dead heat and tightening there just buries the camera in the pack.
      const gap = second ? Math.abs(leader.s - second.s) : 99;
      const settled = clamp((sim.raceTime - 2) / 3, 0, 1);
      const tight = clamp(1 - gap / 3, 0, 1) * settled;
      const distance = 8.5 - tight * 3;
      const height = 4.4 - tight * 1.2;

      // Early on, `leader.s - distance` is before the start of the tube. Clamping
      // it to 0 puts the camera exactly where the marbles are; instead, keep
      // backing off along the opening tangent.
      const behindS = leader.s - distance;
      const behind = track.table.frameAt(Math.max(behindS, 0));
      const overshoot = behindS < 0 ? -behindS : 0;

      // Offset along the track's own up, not world up. On a steep plunge world
      // up hangs the camera out over the drop and the pack slides to the bottom
      // of frame; the local frame keeps the shot square to the chute whatever
      // the gradient is doing.
      this.camTarget.set(
        behind.p.x - behind.d.x * height - behind.t.x * (1.6 + overshoot),
        behind.p.y - behind.d.y * height - behind.t.y * (1.6 + overshoot),
        behind.p.z - behind.d.z * height - behind.t.z * (1.6 + overshoot),
      );
      const ahead = track.table.frameAt(Math.min(leader.s + 3.5, track.total)).p;
      this.tmpVec.set(ahead.x, ahead.y, ahead.z);
    }

    const k = 1 - Math.pow(0.0015, dt);
    this.camera.position.lerp(this.camTarget, k);
    this.camLook.lerp(this.tmpVec, k);
    this.camera.lookAt(this.camLook);
  }

  // -------------------------------------------------------------- confetti

  private spawnConfetti(): void {
    const track = this.track!;
    const spec = this.spec!;
    const rng = stream(spec.seed, COSMETIC.confetti);
    const centre = track.table.frameAt(track.finishS).p;
    const n = 300;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const vel: Vector3[] = [];
    const colour = new Color();
    for (let i = 0; i < n; i++) {
      pos[3 * i] = centre.x + rng.range(-0.5, 0.5);
      pos[3 * i + 1] = centre.y + rng.range(-0.2, 0.7);
      pos[3 * i + 2] = centre.z + rng.range(-0.5, 0.5);
      vel.push(
        new Vector3(rng.signed(), rng.range(0.4, 1.7), rng.signed())
          .normalize()
          .multiplyScalar(rng.range(2.5, 9)),
      );
      colour.setHSL(rng.next(), 0.85, 0.62);
      col[3 * i] = colour.r;
      col[3 * i + 1] = colour.g;
      col[3 * i + 2] = colour.b;
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3).setUsage(DynamicDrawUsage));
    geo.setAttribute('color', new BufferAttribute(col, 3));
    const points = new Points(
      geo,
      new PointsMaterial({ size: 0.19, vertexColors: true, transparent: true, opacity: 1 }),
    );
    this.scene.add(points);
    this.confetti = { points, vel, life: 3.4 };
  }

  private updateConfetti(dt: number): void {
    const confetti = this.confetti;
    if (!confetti) return;
    confetti.life -= dt;
    if (confetti.life <= 0) {
      this.clearConfetti();
      return;
    }
    const attr = confetti.points.geometry.attributes.position as BufferAttribute;
    const array = attr.array as Float32Array;
    for (let i = 0; i < confetti.vel.length; i++) {
      const v = confetti.vel[i];
      v.y -= 6.5 * dt;
      array[3 * i] += v.x * dt;
      array[3 * i + 1] += v.y * dt;
      array[3 * i + 2] += v.z * dt;
    }
    attr.needsUpdate = true;
    (confetti.points.material as PointsMaterial).opacity = clamp(confetti.life / 3.4, 0, 1);
  }

  private clearConfetti(): void {
    if (!this.confetti) return;
    this.scene.remove(this.confetti.points);
    this.confetti.points.geometry.dispose();
    (this.confetti.points.material as PointsMaterial).dispose();
    this.confetti = null;
  }

  // -------------------------------------------------------------- snapshot

  /** What the HUD reads. Cheap enough to call at 10 Hz. */
  snapshot(): SceneSnapshot | null {
    const sim = this.sim;
    const track = this.track;
    if (!sim || !track) return null;

    const standings = sim.standings();
    const spec = this.spec!;
    const rows: StandingRow[] = standings.map((m) => {
      const marbleSpec = spec.marbles[m.id];
      return {
        id: m.id,
        name: m.name,
        color: hslToHex(marbleSpec.hue, marbleSpec.sat, marbleSpec.light),
        progress: clamp(m.s / track.finishS, 0, 1),
        speed: m.v,
        finished: m.finished,
        finishTime: m.finishTime,
        place: m.place,
      };
    });

    const leader = standings[0];
    const second = standings[1];
    let section: string | null = null;
    for (const landmark of track.landmarks) {
      if (landmark.s <= leader.s) section = SECTION_LABELS[landmark.kind] ?? null;
    }

    return {
      phase: sim.phase,
      raceTime: sim.raceTime,
      countdownLeft: sim.countdownLeft,
      standings: rows,
      leaderId: leader.id,
      leaderColor: rows[0]?.color ?? '#f2efe6',
      section,
      battleGap: second ? Math.abs(leader.s - second.s) : 99,
    };
  }

  // -------------------------------------------------------------- teardown

  private disposeRace(): void {
    this.clearConfetti();
    for (const mesh of this.marbleMeshes) {
      this.scene.remove(mesh);
      (mesh.material as MeshStandardMaterial).dispose();
      for (const child of mesh.children) {
        if (child instanceof Mesh) (child.material as MeshBasicMaterial).dispose();
      }
    }
    this.marbleMeshes = [];

    if (this.trackGroup) {
      this.scene.remove(this.trackGroup);
      this.trackGroup.traverse((object) => {
        if (object instanceof Mesh) {
          object.geometry.dispose();
          const material = object.material;
          if (Array.isArray(material)) material.forEach((m) => m.dispose());
          else material.dispose();
        }
      });
      this.trackGroup = null;
    }
    if (this.starField) {
      this.scene.remove(this.starField);
      this.starField.geometry.dispose();
      (this.starField.material as PointsMaterial).dispose();
      this.starField = null;
    }
    if (this.lightGroup) {
      this.scene.remove(this.lightGroup);
      this.lightGroup = null;
    }
    this.sim = null;
    this.track = null;
  }

  dispose(): void {
    this.stop();
    this.disposeRace();
    this.marbleGeo.dispose();
    this.capGeo.dispose();
    this.renderer.dispose();
  }
}
