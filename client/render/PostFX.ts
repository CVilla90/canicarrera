/**
 * The offline-capable post pipeline: supersample -> accumulate -> bloom -> tone map.
 *
 * Why this exists at all: the export loop has no clock. `renderFrameAt` is
 * called as fast as the machine allows, so a frame is free to cost ten times
 * what a realtime frame can. That budget buys the two things that separate a
 * game from a render:
 *
 *   - **Supersampling.** Draw at 2x on both axes, resolve down. Every edge in
 *     the frame gets antialiased, including the ones MSAA misses (specular
 *     glints on the marbles, the thin ribs streaming past the camera).
 *   - **Accumulation motion blur.** Draw N sub-frames spread across the output
 *     frame's own duration and average them. A marble race is fast lateral
 *     motion, which is exactly the case where 30 fps without blur strobes.
 *     There is no cheaper way to get true blur: it is the actual integral, not
 *     a velocity-buffer approximation, so it handles the spinning caps and the
 *     confetti correctly for free.
 *
 * ## Colour
 *
 * The scene renders into a **half-float, linear** target so bloom can see the
 * real intensity of a highlight instead of a clamped white. Tone mapping and
 * sRGB encoding therefore move out of the renderer and into the composite pass
 * at the end. `ACES_FRAGMENT` below is three's ACESFilmic transcribed exactly,
 * matrices and all — not a lookalike approximation — so that switching presets
 * changes sharpness and glow but never colour.
 *
 * ## The fallback that matters
 *
 * Rendering *into* a half-float target needs `EXT_color_buffer_half_float`.
 * It is near-universal on WebGL2 but not guaranteed, and the devices most
 * likely to lack it are exactly the cheap Android phones this project cares
 * about. `PostFX.isSupported` is checked before any of this is constructed;
 * when it fails the scene renders straight to the canvas as it always did.
 */
import {
  AdditiveBlending,
  Camera,
  ClampToEdgeWrapping,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  Mesh,
  NoBlending,
  NoToneMapping,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three';

const QUAD_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/**
 * three's ACESFilmicToneMapping, transcribed, plus the sRGB encode.
 *
 * Transcribed rather than approximated on purpose. The cheap Narkowicz curve
 * everyone reaches for is visibly warmer in the highlights, which would mean a
 * preset with bloom graded differently from a preset without it — a colour
 * shift the user did not ask for when all they wanted was a sharper image.
 *
 * ⚠️ **Every symbol here is prefixed `cani`, and must stay that way.**
 * three prepends its own `<tonemapping_pars_fragment>` to *every* ShaderMaterial
 * it compiles, which already defines `RRTAndODTFit`, `ACESInputMat` and
 * `ACESOutputMat`. Using those names produces `'RRTAndODTFit' : function
 * already has a body`, the composite program silently fails to link, and —
 * because the canvas has `preserveDrawingBuffer` — the *previous* frame stays
 * on screen. It looks like it is working. The only symptom is a GL_INVALID_
 * OPERATION nobody is checking for.
 */
const ACES_FRAGMENT = /* glsl */ `
  const mat3 caniACESIn = mat3(
    vec3(0.59719, 0.07600, 0.02840),
    vec3(0.35458, 0.90834, 0.13383),
    vec3(0.04823, 0.01566, 0.83777)
  );
  const mat3 caniACESOut = mat3(
    vec3( 1.60475, -0.10208, -0.00327),
    vec3(-0.53108,  1.10813, -0.07276),
    vec3(-0.07367, -0.00605,  1.07602)
  );

  vec3 caniRRTAndODTFit(vec3 v) {
    vec3 a = v * (v + 0.0245786) - 0.000090537;
    vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return a / b;
  }

  vec3 caniACESFilmic(vec3 color, float exposure) {
    color *= exposure / 0.6;
    color = caniACESIn * color;
    color = caniRRTAndODTFit(color);
    color = caniACESOut * color;
    return clamp(color, 0.0, 1.0);
  }

  vec3 caniLinearToSRGB(vec3 c) {
    return mix(
      pow(c, vec3(0.41666)) * 1.055 - 0.055,
      c * 12.92,
      vec3(lessThanEqual(c, vec3(0.0031308)))
    );
  }
`;

/** Copies a texture, scaled. Used to fold each sub-frame into the accumulator. */
const ACCUMULATE_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D uSource;
  uniform float uWeight;
  void main() {
    gl_FragColor = vec4(texture2D(uSource, vUv).rgb * uWeight, 1.0);
  }
`;

/**
 * Soft-knee bright pass.
 *
 * A hard threshold makes bloom pop on and off as a highlight crosses it, which
 * on a rolling marble reads as flickering. The knee ramps it in.
 */
const BRIGHT_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D uSource;
  uniform float uThreshold;
  uniform float uKnee;
  void main() {
    vec3 color = texture2D(uSource, vUv).rgb;
    float brightness = max(color.r, max(color.g, color.b));
    float soft = clamp(brightness - uThreshold + uKnee, 0.0, 2.0 * uKnee);
    soft = soft * soft / (4.0 * uKnee + 0.0001);
    float weight = max(soft, brightness - uThreshold) / max(brightness, 0.0001);
    gl_FragColor = vec4(color * weight, 1.0);
  }
`;

/** Separable 9-tap gaussian. Run twice per level, horizontally then vertically. */
const BLUR_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D uSource;
  uniform vec2 uDirection;

  void main() {
    float weights[5];
    weights[0] = 0.227027;
    weights[1] = 0.194594;
    weights[2] = 0.121621;
    weights[3] = 0.054054;
    weights[4] = 0.016216;

    vec3 sum = texture2D(uSource, vUv).rgb * weights[0];
    for (int i = 1; i < 5; i++) {
      vec2 offset = uDirection * float(i);
      sum += texture2D(uSource, vUv + offset).rgb * weights[i];
      sum += texture2D(uSource, vUv - offset).rgb * weights[i];
    }
    gl_FragColor = vec4(sum, 1.0);
  }
`;

const COMPOSITE_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D uScene;
  uniform sampler2D uBloomNear;
  uniform sampler2D uBloomFar;
  uniform float uBloomStrength;
  uniform float uExposure;

  ${ACES_FRAGMENT}

  void main() {
    vec3 color = texture2D(uScene, vUv).rgb;
    vec3 bloom =
      texture2D(uBloomNear, vUv).rgb * 0.6 +
      texture2D(uBloomFar, vUv).rgb * 0.4;
    color += bloom * uBloomStrength;
    color = caniACESFilmic(color, uExposure);
    gl_FragColor = vec4(caniLinearToSRGB(color), 1.0);
  }
`;

function makeTarget(width: number, height: number, depth: boolean): WebGLRenderTarget {
  const target = new WebGLRenderTarget(Math.max(1, width), Math.max(1, height), {
    type: HalfFloatType,
    // Linear, not sRGB: this buffer holds radiance, and the encode happens once
    // at the very end. Writing sRGB here would clamp the highlights that bloom
    // exists to find.
    colorSpace: LinearSRGBColorSpace,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    wrapS: ClampToEdgeWrapping,
    wrapT: ClampToEdgeWrapping,
    depthBuffer: depth,
    stencilBuffer: false,
  });
  return target;
}

export interface PostFXSettings {
  bloom: boolean;
  bloomStrength: number;
  exposure: number;
  /** Linear supersample factor applied to the internal buffers. */
  supersample: number;
}

export class PostFX {
  /**
   * Can this machine render into a half-float target?
   *
   * Checked before construction, never assumed. WebGL2 exposes RGBA16F as a
   * *texture* format everywhere, but rendering to it needs the extension, and
   * without it every target here silently produces black.
   */
  static isSupported(renderer: WebGLRenderer): boolean {
    try {
      const gl = renderer.getContext();
      return (
        gl.getExtension('EXT_color_buffer_half_float') !== null ||
        gl.getExtension('EXT_color_buffer_float') !== null
      );
    } catch {
      return false;
    }
  }

  private readonly quadScene = new Scene();
  private readonly quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: Mesh;

  private readonly accumulateMaterial: ShaderMaterial;
  private readonly brightMaterial: ShaderMaterial;
  private readonly blurMaterial: ShaderMaterial;
  private readonly compositeMaterial: ShaderMaterial;

  private sceneTarget: WebGLRenderTarget;
  private accumTarget: WebGLRenderTarget;
  private brightTarget: WebGLRenderTarget;
  private blurTarget: WebGLRenderTarget;
  private farTarget: WebGLRenderTarget;
  private farBlurTarget: WebGLRenderTarget;

  private width = 1;
  private height = 1;
  private settings: PostFXSettings = {
    bloom: true,
    bloomStrength: 0.55,
    exposure: 1.15,
    supersample: 1,
  };

  /** Set while a multi-sample frame is being built up. */
  private accumulating = false;

  constructor(
    private readonly renderer: WebGLRenderer,
    width: number,
    height: number,
  ) {
    this.accumulateMaterial = new ShaderMaterial({
      vertexShader: QUAD_VERTEX,
      fragmentShader: ACCUMULATE_FRAGMENT,
      uniforms: { uSource: { value: null }, uWeight: { value: 1 } },
      depthTest: false,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    this.brightMaterial = new ShaderMaterial({
      vertexShader: QUAD_VERTEX,
      fragmentShader: BRIGHT_FRAGMENT,
      uniforms: {
        uSource: { value: null },
        uThreshold: { value: 0.85 },
        uKnee: { value: 0.45 },
      },
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
    });

    this.blurMaterial = new ShaderMaterial({
      vertexShader: QUAD_VERTEX,
      fragmentShader: BLUR_FRAGMENT,
      uniforms: { uSource: { value: null }, uDirection: { value: new Vector2() } },
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
    });

    this.compositeMaterial = new ShaderMaterial({
      vertexShader: QUAD_VERTEX,
      fragmentShader: COMPOSITE_FRAGMENT,
      uniforms: {
        uScene: { value: null },
        uBloomNear: { value: null },
        uBloomFar: { value: null },
        uBloomStrength: { value: 0.55 },
        uExposure: { value: 1.15 },
      },
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
    });

    // Built with a real material rather than letting three mint a default one
    // that would then never be disposed.
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.accumulateMaterial);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    this.sceneTarget = makeTarget(width, height, true);
    this.accumTarget = makeTarget(width, height, false);
    this.brightTarget = makeTarget(width >> 1, height >> 1, false);
    this.blurTarget = makeTarget(width >> 1, height >> 1, false);
    this.farTarget = makeTarget(width >> 2, height >> 2, false);
    this.farBlurTarget = makeTarget(width >> 2, height >> 2, false);
    this.width = width;
    this.height = height;
  }

  configure(settings: PostFXSettings): void {
    this.settings = settings;
    this.compositeMaterial.uniforms.uBloomStrength.value = settings.bloom
      ? settings.bloomStrength
      : 0;
    this.compositeMaterial.uniforms.uExposure.value = settings.exposure;
  }

  /**
   * Internal buffers are sized to the OUTPUT resolution times the supersample
   * factor. The canvas itself stays at output resolution — the resolve happens
   * when `composite` samples these targets with a linear filter.
   */
  setSize(outputWidth: number, outputHeight: number): void {
    const scale = this.settings.supersample;
    const width = Math.max(1, Math.round(outputWidth * scale));
    const height = Math.max(1, Math.round(outputHeight * scale));
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.sceneTarget.setSize(width, height);
    this.accumTarget.setSize(width, height);
    this.brightTarget.setSize(Math.max(1, width >> 1), Math.max(1, height >> 1));
    this.blurTarget.setSize(Math.max(1, width >> 1), Math.max(1, height >> 1));
    this.farTarget.setSize(Math.max(1, width >> 2), Math.max(1, height >> 2));
    this.farBlurTarget.setSize(Math.max(1, width >> 2), Math.max(1, height >> 2));
  }

  /**
   * Draws one fullscreen pass.
   *
   * `autoClear` is forced off for the duration. It defaults to ON, and with it
   * on the accumulation pass would clear the accumulator immediately before
   * additively blending each sub-frame into it — leaving only the last one.
   * Motion blur would silently do nothing at all: no error, no black frame,
   * just a video that looks exactly like the cheap preset. Every clear in this
   * file is therefore explicit.
   */
  private drawQuad(material: ShaderMaterial, target: WebGLRenderTarget | null): void {
    const previousAutoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCamera);
    this.renderer.autoClear = previousAutoClear;
  }

  /**
   * Renders one sub-frame and folds it into the accumulator.
   *
   * `weight` is 1/N, so N calls sum to exactly 1. Doing the divide per sub-frame
   * rather than once at the end keeps every intermediate value in the same
   * range as a normal frame, which matters in a half-float buffer.
   */
  renderSubFrame(scene: Scene, camera: Camera, weight: number): void {
    const previousToneMapping = this.renderer.toneMapping;
    const previousAutoClear = this.renderer.autoClear;
    // The scene must land in the HDR buffer UNMAPPED. Tone mapping happens once,
    // in the composite pass, after bloom has had a chance to see the highlights.
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.autoClear = false;
    this.renderer.setRenderTarget(this.sceneTarget);
    // Explicit, because autoClear is off: this one DOES want a fresh buffer
    // every sub-frame. It is the accumulator below that must survive.
    this.renderer.clear(true, true, true);
    this.renderer.render(scene, camera);
    this.renderer.toneMapping = previousToneMapping;
    this.renderer.autoClear = previousAutoClear;

    if (!this.accumulating) {
      this.renderer.setRenderTarget(this.accumTarget);
      this.renderer.clear(true, false, false);
      this.accumulating = true;
    }

    this.accumulateMaterial.uniforms.uSource.value = this.sceneTarget.texture;
    this.accumulateMaterial.uniforms.uWeight.value = weight;
    this.drawQuad(this.accumulateMaterial, this.accumTarget);
  }

  /** Bloom the accumulated frame, tone map it, and put it on the canvas. */
  resolve(): void {
    const accumulated = this.accumTarget.texture;

    if (this.settings.bloom) {
      this.brightMaterial.uniforms.uSource.value = accumulated;
      this.drawQuad(this.brightMaterial, this.brightTarget);

      this.blurLevel(this.brightTarget, this.blurTarget);
      this.downsample(this.brightTarget, this.farTarget);
      this.blurLevel(this.farTarget, this.farBlurTarget);
    }

    this.compositeMaterial.uniforms.uScene.value = accumulated;
    this.compositeMaterial.uniforms.uBloomNear.value = this.settings.bloom
      ? this.brightTarget.texture
      : accumulated;
    this.compositeMaterial.uniforms.uBloomFar.value = this.settings.bloom
      ? this.farTarget.texture
      : accumulated;

    this.drawQuad(this.compositeMaterial, null);
    this.renderer.setRenderTarget(null);
    this.accumulating = false;
  }

  /** Horizontal then vertical, ping-ponging back into `target`. */
  private blurLevel(target: WebGLRenderTarget, scratch: WebGLRenderTarget): void {
    const width = target.width;
    const height = target.height;
    const direction = this.blurMaterial.uniforms.uDirection.value as Vector2;

    this.blurMaterial.uniforms.uSource.value = target.texture;
    direction.set(1 / width, 0);
    this.drawQuad(this.blurMaterial, scratch);

    this.blurMaterial.uniforms.uSource.value = scratch.texture;
    direction.set(0, 1 / height);
    this.drawQuad(this.blurMaterial, target);
  }

  /** Half-res copy for the wide bloom tail. Linear filtering does the filtering. */
  private downsample(source: WebGLRenderTarget, target: WebGLRenderTarget): void {
    this.accumulateMaterial.uniforms.uSource.value = source.texture;
    this.accumulateMaterial.uniforms.uWeight.value = 1;
    const previousBlending = this.accumulateMaterial.blending;
    this.accumulateMaterial.blending = NoBlending;
    this.drawQuad(this.accumulateMaterial, target);
    this.accumulateMaterial.blending = previousBlending;
  }

  dispose(): void {
    this.sceneTarget.dispose();
    this.accumTarget.dispose();
    this.brightTarget.dispose();
    this.blurTarget.dispose();
    this.farTarget.dispose();
    this.farBlurTarget.dispose();
    this.accumulateMaterial.dispose();
    this.brightMaterial.dispose();
    this.blurMaterial.dispose();
    this.compositeMaterial.dispose();
    this.quad.geometry.dispose();
  }

  /** Exposed for the scene's env-map lookups; nothing else should need it. */
  get sceneTexture(): Texture {
    return this.sceneTarget.texture;
  }
}
