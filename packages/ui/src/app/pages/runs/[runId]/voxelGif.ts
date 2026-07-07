/// <reference path="../../../../gifenc.d.ts" />
import * as THREE from "three";
import type { AnimationSpec, ModelSpec } from "@test-cabinet/run-record";
import type { PartMesh } from "@test-cabinet/voxel-runtime";
import { VoxelRig } from "@test-cabinet/voxel-runtime/three";
import { GIFEncoder, quantize, applyPalette } from "gifenc";
import {
  AMBIENT_INTENSITY,
  CAMERA_FOV,
  FILL_LIGHT,
  KEY_LIGHT,
  cameraPosition,
  framing,
  type Vec3,
} from "./voxelScene";

// The exported GIF's square pixel size, capture rate, and a cap on total frames
// (so a long loop stays a reasonable download rather than tens of MB). The GIF is
// held at the loop's true duration regardless of the cap: the per-frame delay is
// derived from periodMs / frameCount, so a capped capture just samples the loop
// more coarsely instead of playing too fast.
const SIZE = 360;
const FPS = 24;
const MAX_FRAMES = 96;

export type VoxelGifInput = {
  /** The produced geometry, keyed by part name (or a single {@link PartMesh}). */
  meshes: Record<string, PartMesh> | PartMesh;
  /** The rig to pose (parts + joints). */
  rig: ModelSpec;
  /** The animation to bake (or null to bake the rig's `autoPlay` idle). */
  animation: AnimationSpec | null;
  /** Static caller-joint values held while the animation plays (it overrides only
   * the joints it drives). */
  callerJoints: Record<string, number>;
  /** The loop length in ms — the animation's `periodMs`. */
  periodMs: number;
  /** Solid background color (the preview panel's color), composited behind the
   * model so anti-aliased edges stay clean (a GIF's 1-bit alpha can't). */
  background: string;
};

/** Even frame count across one loop, and the ms each frame is held. */
export function voxelGifTiming(periodMs: number): {
  frameCount: number;
  stepMs: number;
  delayMs: number;
} {
  const ideal = Math.ceil((periodMs / 1000) * FPS);
  const frameCount = Math.max(2, Math.min(MAX_FRAMES, ideal));
  const stepMs = periodMs / frameCount;
  return { frameCount, stepMs, delayMs: Math.round(stepMs) };
}

/**
 * The minimal posable-rig surface the offscreen bake drives: a scene node to add
 * under the capture's centering pivot, a deterministic {@link seek} to an absolute
 * time, and a {@link dispose}. Both {@link VoxelRig} and
 * `@test-cabinet/voxel-runtime`'s `SkinnedVoxelRig` satisfy it, so the rigid and
 * skinned GIF encoders share one renderer/encoder core.
 */
export interface PosableRig {
  /** The scene node to add under the capture's centering pivot. */
  readonly root: THREE.Object3D;
  /** Seek the playback clock to an absolute time (ms) and re-pose. */
  seek(timeMs: number): void;
  /** Release GPU geometry and detach. */
  dispose(): void;
}

/**
 * Bake one posed rig's animation into a looping GIF on an offscreen three.js renderer
 * that mirrors the interactive preview's camera framing and lighting (see
 * {@link framing} and the shared light constants) so the download looks like what the
 * reviewer saw.
 *
 * The rig — already built, posed, and cued to its animation by {@link buildRig} — is
 * stepped deterministically with {@link PosableRig.seek} at evenly spaced times across
 * one period, each pose rendered over a solid background and quantized into a GIF
 * frame. Using a separate, disposed-immediately renderer keeps the page's single
 * shared WebGL context (and the live preview) untouched.
 *
 * Shared by {@link encodeVoxelGif} (rigid per-part meshes) and `encodeSkinnedGif`
 * (one skinned mesh); the only per-family differences are which rig class is built and
 * which geometry is measured for framing, both passed in.
 *
 * Throws if a WebGL context can't be created.
 */
export async function encodeRigGif({
  buildRig,
  framing: bounds,
  periodMs,
  background,
}: {
  /** Builds the rig to bake — already posed and cued to its animation — and returns
   * it added-ready. Called once, inside the capture, so its geometry is disposed with
   * the renderer. */
  buildRig: () => PosableRig;
  /** The camera framing (from {@link framing} over the family's geometry). */
  framing: { center: Vec3; distance: number; far: number };
  /** The loop length in ms — the animation's `periodMs`. */
  periodMs: number;
  /** Solid background color composited behind the model. */
  background: string;
}): Promise<Blob> {
  const { frameCount, stepMs, delayMs } = voxelGifTiming(periodMs);
  const { center, distance, far } = bounds;

  // Opaque solid background: no alpha needed, and it gives clean anti-aliased
  // edges the way transparency (1-bit in a GIF) can't.
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(SIZE, SIZE, false);
  renderer.setClearColor(new THREE.Color(background), 1);
  // Match R3F's defaults so the baked colors match the interactive preview.
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, AMBIENT_INTENSITY));
  const key = new THREE.DirectionalLight(0xffffff, KEY_LIGHT.intensity);
  key.position.set(...KEY_LIGHT.position);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, FILL_LIGHT.intensity);
  fill.position.set(...FILL_LIGHT.position);
  scene.add(fill);

  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, far);
  camera.position.set(...cameraPosition(distance));
  camera.lookAt(0, 0, 0);

  // Center the model at the origin (the camera looks there), matching the
  // viewer's centering group.
  const pivot = new THREE.Group();
  pivot.position.set(-center[0], -center[1], -center[2]);
  scene.add(pivot);

  const rig = buildRig();
  pivot.add(rig.root);

  // A 2D canvas to composite each rendered frame onto and read pixels back from
  // (drawing our own WebGL canvas onto it is same-origin, so it never taints).
  const readback = document.createElement("canvas");
  readback.width = SIZE;
  readback.height = SIZE;
  const ctx = readback.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    rig.dispose();
    renderer.dispose();
    throw new Error("Canvas 2D context is unavailable");
  }

  const gif = GIFEncoder();
  try {
    for (let frame = 0; frame < frameCount; frame++) {
      rig.seek(frame * stepMs);
      renderer.render(scene, camera);
      ctx.drawImage(renderer.domElement, 0, 0, SIZE, SIZE);
      const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
      // Opaque frames — no transparency to preserve, so quantize in rgb565.
      const palette = quantize(data, 256, { format: "rgb565" });
      const index = applyPalette(data, palette, "rgb565");
      gif.writeFrame(index, SIZE, SIZE, { palette, delay: delayMs });
    }
    gif.finish();
  } finally {
    // Release the model geometry and the WebGL context promptly — this renderer
    // exists only for the capture and must not linger against the context budget.
    rig.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }

  const encoded = gif.bytes();
  const bytes = new Uint8Array(encoded.length);
  bytes.set(encoded);
  return new Blob([bytes], { type: "image/gif" });
}

/**
 * Bake one voxel animation into a looping GIF (see {@link encodeRigGif}). Builds a
 * {@link VoxelRig} from the run's rig and per-part meshes, poses it at the static
 * caller joints, and cues its animation (or `null` for the rig's `autoPlay` idle).
 *
 * Throws if a WebGL context can't be created.
 */
export async function encodeVoxelGif({
  meshes,
  rig,
  animation,
  callerJoints,
  periodMs,
  background,
}: VoxelGifInput): Promise<Blob> {
  return encodeRigGif({
    buildRig: () => {
      const voxelRig = new VoxelRig(rig, meshes);
      voxelRig.pose(callerJoints);
      // A named animation to bake, or `null` to fall back to the `autoPlay` idle.
      voxelRig.playAnimation(animation);
      return voxelRig;
    },
    framing: framing(meshes),
    periodMs,
    background,
  });
}
