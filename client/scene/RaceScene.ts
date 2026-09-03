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
  DoubleSide,
  DynamicDrawUsage,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
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
  type Material,
  type WebGLRenderTarget,
} from 'three';

/** Torus geometry points along +Z, so this is the axis every ring is aimed from. */
const FORWARD = new Vector3(0, 0, 1);

import { RaceSim, COUNTDOWN, type RacePhase } from '@shared/sim.ts';
import { buildTrack, type Track } from '@shared/track.ts';
import { PHYSICS, type RaceSpec } from '@shared/spec.ts';
import { PALETTES, hslToHex, type Palette } from '@shared/palette.ts';
import { COSMETIC, stream } from '@shared/rng.ts';
import { clamp } from '@shared/vec3.ts';
import { SharedCurve } from './SharedCurve.ts';
import { buildWorld, buildChannelGeometry, buildKerbs, updateMotes, type WorldParts } from './World.ts';
import { buildCharacters, updateCharacters, type CharacterCast } from './Characters.ts';
import { buildAttribution, type AttributionParts } from './Attribution.ts';
import { PostFX } from '../render/PostFX.ts';
import { buildEnvironment } from '../render/environment.ts';
import { presetById, DEFAULT_PRESET_ID, needsPostFX, type RenderPreset } from '../render/presets.ts';
import { affordableSupersample, canAffordPostFX, deviceProfile } from '../render/device.ts';

/** Exposure before any race is loaded; every world then sets its own. */
const DEFAULT_EXPOSURE = 1.15;

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

  /**
   * Fired when the GPU takes the drawing context away, and again when it comes
   * back.
   *
   * This is the single most valuable listener in the file. Without it a lost
   * context is a permanently frozen canvas — the page looks alive, the HUD keeps
   * updating from the sim, and nothing ever draws again. That is precisely what
   * "it got stuck" describes, and it is common on iOS Safari, which drops
   * contexts under memory pressure rather than crashing the tab.
   */
  onContextChange: ((state: 'lost' | 'restored') => void) | null = null;
  private contextLost = false;

  private trackGroup: Group | null = null;
  private marbleMeshes: Mesh[] = [];
  private lastSpin: number[] = [];
  private starField: Points | null = null;
  private world: WorldParts | null = null;
  private cast: CharacterCast | null = null;
  private attribution: AttributionParts | null = null;
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

  // ------------------------------------------------------------ quality

  /**
   * Visual quality only. Nothing here reaches the simulator — `setRenderPreset`
   * cannot change who wins, so the same seed is the same race at every setting
   * and share links stay honest.
   */
  private preset: RenderPreset = presetById(DEFAULT_PRESET_ID);
  private postFX: PostFX | null = null;
  private readonly postFXAvailable: boolean;
  private envTarget: WebGLRenderTarget | null = null;
  private tubeMaterial: MeshStandardMaterial | null = null;
  /**
   * Env-map strength the CURRENT track surface wants.
   *
   * Stored rather than hardcoded in `setRenderPreset`, which used to reset it
   * to the glass tube's value and silently over-lit every channel world.
   */
  private tubeEnvBase = 1.1;

  /** Sub-frames averaged per output frame. 1 during live playback, always. */
  private subFrames = 1;
  private exporting = false;
  /** Output size in device pixels, tracked so PostFX can be resized with it. */
  private outputWidth = 1;
  private outputHeight = 1;

  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      // Needed so the exporter can lift a frame out of the canvas after the
      // event loop has had a chance to composite. Costs a little bandwidth;
      // buys a pipeline that cannot silently produce black video.
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    // Capped by the device, not by a constant. A phone reporting ratio 3 would
    // otherwise render a full-screen canvas at nine times the pixels of 1x —
    // and, because of `preserveDrawingBuffer` above, hold two of them.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, deviceProfile().maxPixelRatio));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = DEFAULT_EXPOSURE;

    // Probed once, at construction. Everything above Ligero needs to render
    // into a half-float target, and on a GPU that cannot, the presets are not
    // "slow" — they are black. Better to know now and never offer them.
    this.postFXAvailable = PostFX.isSupported(this.renderer);

    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);

    this.camera = new PerspectiveCamera(58, 16 / 9, 0.1, 900);
    this.scene.add(this.camera);
  }

  /**
   * The browser is taking the context away.
   *
   * `preventDefault` is mandatory — without it the context is gone for good and
   * `webglcontextrestored` never fires, which is the difference between a
   * two-second interruption and a page the user has to reload by hand.
   */
  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    this.stop();
    this.onContextChange?.('lost');
  };

  private readonly onContextRestored = (): void => {
    this.contextLost = false;
    // Every GPU-side object died with the context: textures, buffers, programs,
    // the environment cubemap, the post-processing targets. Rebuilding the race
    // from its spec is both the simplest and the only correct response — and it
    // is cheap precisely because a race IS its spec.
    const spec = this.spec;
    this.postFX?.dispose();
    this.postFX = null;
    if (spec) {
      try {
        this.load(spec);
      } catch {
        // Nothing more to try. The UI still has its own message up.
      }
    }
    this.onContextChange?.('restored');
  };

  get isContextLost(): boolean {
    return this.contextLost;
  }

  // -------------------------------------------------------------- quality

  get supportsPostFX(): boolean {
    return this.postFXAvailable;
  }

  get renderPreset(): RenderPreset {
    return this.preset;
  }

  /**
   * Swaps the visual preset. Safe at any time, including mid-race — it rebuilds
   * materials and buffers but never touches `sim`, so the race carries on from
   * exactly where it was.
   */
  setRenderPreset(preset: RenderPreset): void {
    const effective = this.postFXAvailable ? preset : presetById('ligero');
    const changed = effective.id !== this.preset.id;
    this.preset = effective;
    if (!changed) return;

    this.syncEnvironment();
    this.syncMarbleMaterials();
    this.syncPostFX();
    if (this.tubeMaterial) {
      this.tubeMaterial.envMapIntensity = effective.env ? this.tubeEnvBase : 0;
    }
  }

  /**
   * Enters offline render mode: sub-frame accumulation on, supersampled buffers
   * allocated. `subFrames` comes from the preset but is passed explicitly so the
   * benchmark can force 1 and measure a clean baseline.
   */
  beginExportRender(subFrames: number): void {
    this.exporting = true;
    this.subFrames = Math.max(1, Math.round(subFrames));
    this.syncPostFX();
  }

  endExportRender(): void {
    this.exporting = false;
    this.subFrames = 1;
    this.syncPostFX();
  }

  /** Creates, reconfigures or tears down the post pipeline for the current mode. */
  private syncPostFX(): void {
    // Two independent questions, and until this line only the first was asked.
    // `postFXAvailable` is about GPU *capability* — can it render into a
    // half-float target at all. `canAffordPostFX` is about *capacity* — is there
    // room for the targets at this size. A phone answers yes to the first and,
    // at export resolutions, no to the second; believing the first alone is how
    // a tab gets reloaded mid-export.
    const wanted =
      this.postFXAvailable &&
      needsPostFX(this.preset, this.exporting) &&
      canAffordPostFX(this.outputWidth, this.outputHeight);
    if (!wanted) {
      this.postFX?.dispose();
      this.postFX = null;
      return;
    }
    if (!this.postFX) {
      this.postFX = new PostFX(this.renderer, this.outputWidth, this.outputHeight);
    }
    // Supersampling is an export-only luxury: in realtime the browser is already
    // applying devicePixelRatio and doubling on top of that would drop a phone
    // to single-digit frame rates for a preview nobody keeps.
    //
    // And even offline it is capped by what fits. Dropping 2x to 1x costs a
    // little edge softness; allocating a 3840x2160 half-float pair on a phone
    // costs the whole tab.
    const supersample = this.exporting
      ? affordableSupersample(this.outputWidth, this.outputHeight, this.preset.supersample)
      : 1;
    this.postFX.configure({
      bloom: this.preset.bloom,
      bloomStrength: 0.55,
      // Whatever the current world asked for. PostFX owns tone mapping when it
      // is active, so this MUST track `renderer.toneMappingExposure` or the
      // same world grades differently with bloom on and off.
      exposure: this.renderer.toneMappingExposure,
      supersample,
    });
    this.postFX.setSize(this.outputWidth, this.outputHeight);
  }

  private syncEnvironment(): void {
    if (!this.spec) return;
    if (this.preset.env) {
      if (!this.envTarget) {
        const built = buildEnvironment(this.renderer, PALETTES[this.spec.palette]);
        this.envTarget = built.target;
        this.scene.environment = built.texture;
      }
    } else if (this.envTarget) {
      this.scene.environment = null;
      this.envTarget.dispose();
      this.envTarget = null;
    }
  }

  /**
   * Marbles are the subject of every shot, so they get the one genuinely
   * expensive material in the scene at the higher presets: clearcoat over a
   * near-mirror base, which is what makes a sphere read as polished glass
   * rather than as a coloured ball.
   */
  private makeMarbleMaterial(color: Color): Material {
    if (this.preset.glossyMarbles) {
      return new MeshPhysicalMaterial({
        color,
        metalness: 0.05,
        roughness: 0.09,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        envMapIntensity: 1.5,
        emissive: color.clone().multiplyScalar(0.14),
      });
    }
    return new MeshStandardMaterial({
      color,
      metalness: 0.35,
      roughness: 0.18,
      envMapIntensity: this.preset.env ? 1.2 : 0,
      emissive: color.clone().multiplyScalar(0.28),
    });
  }

  private syncMarbleMaterials(): void {
    if (!this.spec) return;
    this.marbleMeshes.forEach((mesh, index) => {
      const marble = this.spec!.marbles[index];
      if (!marble) return;
      const previous = mesh.material as Material;
      mesh.material = this.makeMarbleMaterial(
        new Color(hslToHex(marble.hue, marble.sat, marble.light)),
      );
      previous.dispose();
    });
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
    // Set BEFORE syncPostFX below, which copies it into the composite pass.
    this.renderer.toneMappingExposure = palette.exposure;

    this.buildLights();
    // Before the meshes: the environment map is what their materials sample,
    // and building it first means no frame is ever drawn with it missing.
    this.syncEnvironment();
    this.world = buildWorld(palette, this.track, spec.seed);
    this.scene.add(this.world.group);
    this.attribution = buildAttribution(
      this.world.attribution,
      this.renderer.capabilities.getMaxAnisotropy(),
    );
    this.scene.add(this.attribution.billboards);
    this.camera.add(this.attribution.endCard);
    this.attribution.resize(this.camera.aspect);
    // Keyed on the race seed, so the same link puts the same penguin on the
    // same rock — and on a cosmetic stream, so adding one cannot move a marble.
    this.cast = buildCharacters(palette, this.track, spec.seed, {
      exclusions: [
        ...(this.world.setPiece ? [this.world.setPiece.spectatorExclusion] : []),
        ...this.world.attribution.spectatorExclusions,
      ],
    });
    this.scene.add(this.cast.group);
    this.buildStars();
    this.buildTrackMesh();
    this.buildMarbles();
    this.syncPostFX();
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
    if (this.running || this.contextLost) return;
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
    this.attribution?.resize(this.camera.aspect);
    // PostFX buffers are sized in device pixels, matching the drawing buffer
    // rather than the CSS box — otherwise a HiDPI screen renders the effects at
    // half resolution and the composite blurs the whole frame.
    const ratio = this.renderer.getPixelRatio();
    this.outputWidth = Math.max(1, Math.round(width * ratio));
    this.outputHeight = Math.max(1, Math.round(height * ratio));
    this.postFX?.setSize(this.outputWidth, this.outputHeight);
  }

  setPixelRatio(ratio: number): void {
    this.renderer.setPixelRatio(ratio);
  }

  draw(): void {
    // Drawing into a lost context is not an error, it is a no-op that logs a
    // warning per frame. Skipping it keeps the console readable while we wait
    // for the browser to hand the context back.
    if (this.contextLost) return;
    if (this.postFX) {
      this.postFX.renderSubFrame(this.scene, this.camera, 1);
      this.postFX.resolve();
      return;
    }
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

    const samples = this.subFrames;
    if (samples <= 1 || !this.postFX) {
      this.sim.advanceTo(time);
      this.updateVisuals(frameDt);
      this.draw();
      return;
    }

    // Accumulation motion blur: N draws spread across this frame's own
    // duration, averaged. This is the real integral over the shutter, not a
    // velocity-buffer approximation, so it blurs the spinning caps and the
    // confetti correctly without any of them knowing about it.
    //
    // Sub-frame times only ever move forward, which is what `advanceTo`
    // requires — and the camera's exponential smoothing composes exactly under
    // subdivision, so a 4-sample frame lands the camera in the same place a
    // 1-sample frame would.
    const weight = 1 / samples;
    for (let i = 0; i < samples; i++) {
      this.sim.advanceTo(time + (i * frameDt) / samples);
      this.updateVisuals(frameDt / samples);
      this.postFX.renderSubFrame(this.scene, this.camera, weight);
    }
    this.postFX.resolve();
  }

  // -------------------------------------------------------------- build

  private buildLights(): void {
    const palette = PALETTES[this.spec!.palette];
    const group = new Group();
    group.name = 'lights';
    // Intensities come from the world. An orbit world is a black void with a
    // glowing chute and can take ~5 units of flat light; a surface world has a
    // lit sky and lit terrain, and the same rig blows the entire frame to
    // pastel with no dark side on anything.
    group.add(new HemisphereLight(palette.fillLight, palette.groundLight, palette.hemiIntensity));
    const key = new DirectionalLight(palette.keyLight, palette.keyIntensity);
    key.position.set(30, 60, 20);
    group.add(key);
    const rim = new DirectionalLight(palette.fillLight, palette.rimIntensity);
    rim.position.set(-40, 20, -30);
    group.add(rim);
    group.add(new AmbientLight(palette.fillLight, palette.ambientIntensity));
    this.scene.add(group);
    this.lightGroup = group;
  }

  private lightGroup: Group | null = null;

  private buildStars(): void {
    const palette = PALETTES[this.spec!.palette];
    // Surface worlds have a sky instead. `starCount: 0` is the switch.
    if (palette.starCount <= 0) return;
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

    if (palette.trackStyle === 'channel') {
      // Open roof. The chute becomes a running surface with real edges, which
      // is what a track on the ground looks like — and what kerbs sit on.
      // Opaque, not tinted glass: you are looking AT this surface now, not
      // through it.
      // A track surface under a real sun. Rough, barely reflective, and lit
      // mostly by the key light rather than by the environment — crank the env
      // up here and the whole channel washes out to the colour of the sky.
      this.tubeEnvBase = 0.35;
      this.tubeMaterial = new MeshStandardMaterial({
        color: palette.trackColor,
        roughness: 0.82,
        metalness: 0,
        envMapIntensity: this.preset.env ? this.tubeEnvBase : 0,
        side: DoubleSide,
      });
      group.add(new Mesh(buildChannelGeometry(track, track.tubeRadius, tubular), this.tubeMaterial));
      if (palette.kerbs) group.add(buildKerbs(track, track.tubeRadius, palette.kerbA, palette.kerbB));
      this.buildTrackFurniture(group, track, palette);
      this.scene.add(group);
      this.trackGroup = group;
      return;
    }

    const tubeGeo = new TubeGeometry(curve, tubular, track.tubeRadius, 16, false);

    this.tubeEnvBase = 1.1;
    this.tubeMaterial = new MeshStandardMaterial({
      color: palette.glass,
      metalness: 0.1,
      roughness: 0.22,
      // Reflections on the chute are what stop it reading as coloured cellophane,
      // but they stay subtler than the marbles' — it is scenery, not the subject.
      envMapIntensity: this.preset.env ? 1.1 : 0,
      transparent: true,
      // Back faces only. Drawing both walls stacks the tint twice and puts
      // a foggy near wall between the camera and the marbles it is chasing;
      // showing just the far wall reads as a clean channel from outside and
      // keeps the pack legible from inside.
      opacity: palette.glassOpacity * 1.5,
      side: BackSide,
      depthWrite: false,
    });
    group.add(new Mesh(tubeGeo, this.tubeMaterial));

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

    this.buildTrackFurniture(group, track, palette);

    this.scene.add(group);
    this.trackGroup = group;
  }

  /**
   * Section markers, start gate and finish arch.
   *
   * Shared by both track styles: on the sealed tube they read as rings inside
   * the pipe, and on the open channel the same geometry reads as gantries
   * arching over the track — which is exactly the right look for a circuit.
   */
  private buildTrackFurniture(group: Group, track: Track, palette: Palette): void {
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
      const mesh = new Mesh(this.marbleGeo, this.makeMarbleMaterial(color));
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

    // After the camera: the mote field wraps around wherever the camera now is,
    // so weather follows the race down the course instead of being left behind
    // at the start line.
    if (this.world?.motes) updateMotes(this.world.motes, dt, this.camera.position);

    // Driven by SIM TIME and the leader's position, never by a wall clock. That
    // is what makes the cast identical in the preview and in the exported file:
    // a frame drawn in 3 ms and the same frame drawn in 300 ms are handed the
    // same `sim.time`, so the penguin is mid-flap at exactly the same instant.
    if (this.cast) updateCharacters(this.cast, sim.time, sim.leader().s);
    this.attribution?.update(sim.time, sim.endTime, sim.phase === 'finished');

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
      (mesh.material as Material).dispose();
      for (const child of mesh.children) {
        if (child instanceof Mesh) (child.material as MeshBasicMaterial).dispose();
      }
    }
    this.marbleMeshes = [];
    this.tubeMaterial = null;

    // The environment is per palette, and the next race may well be a different
    // world. Leaking one prefiltered cubemap per race is the kind of thing that
    // only shows up after someone presses "nueva carrera" thirty times.
    if (this.envTarget) {
      this.scene.environment = null;
      this.envTarget.dispose();
      this.envTarget = null;
    }

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
    if (this.cast) {
      this.scene.remove(this.cast.group);
      // The cast shares one geometry and one material per species across every
      // instance, so it disposes itself rather than being traversed — a
      // traversal would dispose the same sphere eight times.
      this.cast.dispose();
      this.cast = null;
    }
    if (this.attribution) {
      this.scene.remove(this.attribution.billboards);
      this.camera.remove(this.attribution.endCard);
      this.attribution.dispose();
      this.attribution = null;
    }
    if (this.world) {
      this.scene.remove(this.world.group);
      this.world.group.traverse((object) => {
        if (object instanceof Mesh || object instanceof Points) {
          object.geometry.dispose();
          const material = object.material;
          if (Array.isArray(material)) material.forEach((m) => m.dispose());
          else material.dispose();
        }
      });
      this.world = null;
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
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.disposeRace();
    this.postFX?.dispose();
    this.postFX = null;
    this.marbleGeo.dispose();
    this.capGeo.dispose();
    this.renderer.dispose();
  }
}
