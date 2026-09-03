/**
 * Three.js consumer for the pure attribution layout.
 *
 * Both the trackside signs and the outro are real scene objects. The export
 * loop therefore sees exactly the same pixels as realtime playback; no DOM
 * watermark or export-only compositor can drift away from the preview.
 */
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  Group,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from 'three';

import { VIDEO_ATTRIBUTION } from '../branding.ts';
import {
  outroCardOpacity,
  type AttributionBillboardPlacement,
  type AttributionLayout,
  type AttributionVec3,
} from './AttributionLayout.ts';

const GOLD = '#ffc53d';
const GOLD_DARK = '#8d5c00';
const INK = '#05090b';
const PAPER = '#f4f0e6';
const MUTED = '#aeb7b5';
const FONT = 'Arial Narrow, Arial, sans-serif';

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width * 0.5, height * 0.5);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function fittedFont(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  startPx: number,
  minimumPx: number,
  weight: number,
): string {
  let size = startPx;
  while (size > minimumPx) {
    context.font = `${weight} ${size}px ${FONT}`;
    if (context.measureText(text).width <= maxWidth) break;
    size -= 2;
  }
  return `${weight} ${size}px ${FONT}`;
}

function makeCanvas(
  width: number,
  height = width,
): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable for video attribution');
  return [canvas, context];
}

function finishTexture(canvas: HTMLCanvasElement, anisotropy: number): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = Math.max(1, anisotropy);
  texture.needsUpdate = true;
  return texture;
}

function buildBillboardTexture(anisotropy: number): CanvasTexture {
  const [canvas, context] = makeCanvas(1024, 512);
  context.clearRect(0, 0, 1024, 512);

  const gradient = context.createLinearGradient(0, 0, 1024, 512);
  gradient.addColorStop(0, '#10191b');
  gradient.addColorStop(1, INK);
  roundedRect(context, 18, 18, 988, 476, 48);
  context.fillStyle = gradient;
  context.fill();
  context.lineWidth = 18;
  context.strokeStyle = GOLD;
  context.stroke();

  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = GOLD;
  context.font = fittedFont(context, VIDEO_ATTRIBUTION.billboardTitle, 850, 150, 72, 800);
  context.fillText(VIDEO_ATTRIBUTION.billboardTitle, 512, 256);

  return finishTexture(canvas, anisotropy);
}

function buildEndCardTexture(anisotropy: number): CanvasTexture {
  const [canvas, context] = makeCanvas(1024);
  context.clearRect(0, 0, 1024, 1024);

  const gradient = context.createLinearGradient(110, 90, 900, 940);
  gradient.addColorStop(0, '#152124');
  gradient.addColorStop(1, INK);
  roundedRect(context, 72, 72, 880, 880, 80);
  context.fillStyle = gradient;
  context.fill();
  context.lineWidth = 14;
  context.strokeStyle = GOLD;
  context.stroke();
  context.lineWidth = 3;
  context.strokeStyle = GOLD_DARK;
  roundedRect(context, 100, 100, 824, 824, 58);
  context.stroke();

  // A tiny marble mark, drawn rather than loaded, keeps the card self-contained.
  context.beginPath();
  context.arc(512, 272, 74, 0, Math.PI * 2);
  context.fillStyle = GOLD;
  context.fill();
  context.beginPath();
  context.arc(486, 244, 19, 0, Math.PI * 2);
  context.fillStyle = '#fff8d7';
  context.fill();

  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = GOLD;
  context.font = fittedFont(context, VIDEO_ATTRIBUTION.brand, 800, 120, 62, 800);
  context.fillText(VIDEO_ATTRIBUTION.brand, 512, 455);

  context.fillStyle = PAPER;
  context.font = fittedFont(context, VIDEO_ATTRIBUTION.credit, 720, 54, 32, 700);
  context.fillText(VIDEO_ATTRIBUTION.credit, 512, 592);

  context.fillStyle = MUTED;
  context.font = fittedFont(context, VIDEO_ATTRIBUTION.url, 740, 42, 28, 600);
  context.fillText(VIDEO_ATTRIBUTION.url, 512, 690);

  context.fillStyle = GOLD;
  roundedRect(context, 282, 782, 460, 9, 5);
  context.fill();

  return finishTexture(canvas, anisotropy);
}

const vector = (value: AttributionVec3): Vector3 => new Vector3(value.x, value.y, value.z);

function billboardTransform(
  placement: AttributionBillboardPlacement,
  face: boolean,
  matrix: Matrix4,
  basis: Matrix4,
  quaternion: Quaternion,
): Matrix4 {
  const right = vector(placement.right);
  const up = vector(placement.up);
  const normal = vector(placement.normal);
  basis.makeBasis(right, up, normal);
  quaternion.setFromRotationMatrix(basis);
  const position = vector(placement.position);
  if (face) position.addScaledVector(normal, placement.depth * 0.46);
  const scale = face
    ? new Vector3(placement.width, placement.height, 1)
    : new Vector3(placement.width, placement.height, placement.depth * 0.9);
  return matrix.compose(position, quaternion, scale);
}

export interface AttributionParts {
  billboards: Group;
  endCard: Group;
  update(time: number, endTime: number, finished: boolean): void;
  resize(cameraAspect: number): void;
  dispose(): void;
}

export function buildAttribution(layout: AttributionLayout, maxAnisotropy: number): AttributionParts {
  const billboards = new Group();
  billboards.name = 'video-attribution-billboards';

  const billboardTexture = buildBillboardTexture(Math.min(8, maxAnisotropy));
  const faceGeometry = new PlaneGeometry(1, 1);
  const faceMaterial = new MeshBasicMaterial({
    map: billboardTexture,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const backingGeometry = new BoxGeometry(1, 1, 1);
  const backingMaterial = new MeshBasicMaterial({ color: new Color(GOLD), toneMapped: false });

  const matrix = new Matrix4();
  const basis = new Matrix4();
  const quaternion = new Quaternion();
  const faces = new InstancedMesh(
    faceGeometry,
    faceMaterial,
    Math.max(1, layout.billboards.length),
  );
  const backs = new InstancedMesh(
    backingGeometry,
    backingMaterial,
    Math.max(1, layout.billboards.length),
  );
  faces.name = 'attribution-sign-faces';
  backs.name = 'attribution-sign-backs';
  faces.count = layout.billboards.length;
  backs.count = layout.billboards.length;
  for (let i = 0; i < layout.billboards.length; i++) {
    const placement = layout.billboards[i];
    faces.setMatrixAt(i, billboardTransform(placement, true, matrix, basis, quaternion));
    backs.setMatrixAt(i, billboardTransform(placement, false, matrix, basis, quaternion));
  }
  faces.instanceMatrix.needsUpdate = true;
  backs.instanceMatrix.needsUpdate = true;
  faces.computeBoundingSphere();
  backs.computeBoundingSphere();
  billboards.add(backs, faces);

  const endCard = new Group();
  endCard.name = 'video-attribution-outro';
  endCard.visible = false;

  const scrimGeometry = new PlaneGeometry(8, 8);
  const scrimMaterial = new MeshBasicMaterial({
    color: 0x020607,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const scrim = new Mesh(scrimGeometry, scrimMaterial);
  scrim.position.z = -2.2;
  scrim.renderOrder = 10_000;
  scrim.frustumCulled = false;
  endCard.add(scrim);

  const endTexture = buildEndCardTexture(Math.min(4, maxAnisotropy));
  const endGeometry = new PlaneGeometry(1.5, 1.5);
  const endMaterial = new MeshBasicMaterial({
    map: endTexture,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const card = new Mesh(endGeometry, endMaterial);
  card.position.z = -2;
  card.renderOrder = 10_001;
  card.frustumCulled = false;
  endCard.add(card);

  return {
    billboards,
    endCard,
    update: (time, endTime, finished) => {
      const opacity = outroCardOpacity(time, endTime, finished);
      endCard.visible = opacity > 0;
      scrimMaterial.opacity = opacity * 0.72;
      endMaterial.opacity = opacity;
    },
    resize: (cameraAspect) => {
      // A square scene card stays comfortably title-safe on portrait phones.
      const scale = Math.min(1, Math.max(0.5, cameraAspect / 0.86));
      card.scale.setScalar(scale);
    },
    dispose: () => {
      faceGeometry.dispose();
      faceMaterial.dispose();
      backingGeometry.dispose();
      backingMaterial.dispose();
      billboardTexture.dispose();
      scrimGeometry.dispose();
      scrimMaterial.dispose();
      endGeometry.dispose();
      endMaterial.dispose();
      endTexture.dispose();
    },
  };
}
