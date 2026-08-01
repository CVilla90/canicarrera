/**
 * A procedural environment map, built per palette.
 *
 * Marbles are polished spheres. What makes a polished sphere read as polished
 * is not its material settings — it is having something to *reflect*. Without
 * an environment map a marble is a flat blob with a specular dot; with one it
 * picks up the sky, the glow of the chute and the colour of the world it is
 * rolling through.
 *
 * This is generated, never downloaded. A real HDRI would be 1-4 MB against a
 * bundle that is currently ~225 KB gzipped, it would need Object Storage or a
 * CDN, and it would be one more thing that can 404 in front of the user. A
 * gradient sky plus three bright cards, pushed through `PMREMGenerator`, gets
 * most of the way there for zero bytes and about 15 ms once per race.
 *
 * The cards are deliberately HDR (colour components above 1). Clamped to white
 * they would produce grey reflections; overdriven they produce the bright
 * rolling highlight that sells the material.
 */
import {
  BackSide,
  BoxGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  type Texture,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';

import type { Palette } from '@shared/palette.ts';

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Horizon-weighted gradient: ground, a warm band at eye level, then sky. The
 * band matters more than either end — a reflective sphere spends most of its
 * visible area reflecting the horizon.
 */
const SKY_FRAGMENT = /* glsl */ `
  varying vec3 vDirection;
  uniform vec3 uGround;
  uniform vec3 uHorizon;
  uniform vec3 uSky;

  void main() {
    float h = normalize(vDirection).y;
    vec3 color = h > 0.0
      ? mix(uHorizon, uSky, pow(clamp(h, 0.0, 1.0), 0.55))
      : mix(uHorizon, uGround, pow(clamp(-h, 0.0, 1.0), 0.42));
    gl_FragColor = vec4(color, 1.0);
  }
`;

/** Scaled-up copy of a palette colour, so it reflects as a highlight not a smudge. */
function hdr(hex: number, intensity: number): Color {
  return new Color(hex).multiplyScalar(intensity);
}

/**
 * Builds and prefilters the environment.
 *
 * The caller owns the returned target and must dispose it — the texture stays
 * alive for as long as the race does, and leaking one per race would grow GPU
 * memory every time the user presses "nueva carrera".
 */
export function buildEnvironment(
  renderer: WebGLRenderer,
  palette: Palette,
): { texture: Texture; target: WebGLRenderTarget } {
  const scene = new Scene();

  /**
   * Surface worlds get a much dimmer environment.
   *
   * In orbit the env map is doing most of the work — there is nothing else out
   * there, so an overdriven dome is what makes the glass read as glass. On the
   * ground there is already a sun, a lit sky and lit terrain, and adding a
   * 7x-overdriven dome on top of that is what turned the jungle into a flat
   * mint wash. Image-based light is still light, and it all adds up.
   */
  const gain = palette.kind === 'surface' ? 0.32 : 1;

  const sky = new Mesh(
    new SphereGeometry(60, 24, 16),
    new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      // `toneMapped: false` is not enough on its own — PMREM renders into a
      // half-float target, so these values stay HDR all the way through.
      toneMapped: false,
      uniforms: {
        uGround: { value: hdr(palette.groundLight, 1.1 * gain) },
        uHorizon: { value: hdr(palette.fillLight, 0.55 * gain) },
        uSky: { value: hdr(palette.background, 2.2 * gain) },
      },
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
    }),
  );
  scene.add(sky);

  // Three light cards, matching the three real lights in the scene so the
  // reflections agree with the shading rather than fighting it.
  const cards: Array<{ color: Color; position: [number, number, number]; scale: [number, number, number] }> = [
    { color: hdr(palette.keyLight, 7 * gain), position: [16, 26, 12], scale: [16, 10, 0.4] },
    { color: hdr(palette.fillLight, 2.4 * gain), position: [-22, 8, -16], scale: [20, 12, 0.4] },
    { color: hdr(palette.ringA, 1.8 * gain), position: [0, -14, 20], scale: [26, 6, 0.4] },
  ];

  const cardGeometry = new BoxGeometry(1, 1, 1);
  for (const card of cards) {
    const mesh = new Mesh(
      cardGeometry,
      new MeshBasicMaterial({ color: card.color, toneMapped: false }),
    );
    mesh.position.set(...card.position);
    mesh.scale.set(...card.scale);
    mesh.lookAt(0, 0, 0);
    scene.add(mesh);
  }

  const pmrem = new PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const target = pmrem.fromScene(scene, 0.04, 0.1, 200);
  pmrem.dispose();

  // The source scene has done its job; only the prefiltered cubemap survives.
  cardGeometry.dispose();
  sky.geometry.dispose();
  (sky.material as ShaderMaterial).dispose();
  scene.traverse((object) => {
    if (object instanceof Mesh && object !== sky) {
      (object.material as MeshBasicMaterial).dispose();
    }
  });
  scene.clear();

  return { texture: target.texture, target };
}
