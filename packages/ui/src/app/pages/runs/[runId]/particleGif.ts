/// <reference path="../../../../gifenc.d.ts" />
import * as THREE from "three";
import type { ParticleSystem } from "@test-cabinet/particle-runtime";
import { ParticleSystemPlayer } from "@test-cabinet/particle-runtime/three";
import { GIFEncoder, quantize, applyPalette } from "gifenc";
import type { ParticleBlend } from "./ParticleViewer";

// The exported GIF's square pixel size, capture rate, and a cap on total frames (so a
// long effect stays a reasonable download). Mirrors the voxel bake's budget.
const SIZE = 360;
const FPS = 24;
const MAX_FRAMES = 96;
// The reference on-screen stage size (`ParticleResultSection`'s `STAGE_SIZE`) the
// default point scale is tuned for; the capture rescales point sizes from it so the
// billboards read the same in the GIF as in the preview.
const STAGE_SIZE = 420;
// Sub-step the simulation at ~60Hz regardless of the (coarser) capture rate, so a
// particle's motion integrates as smoothly as it does in the live viewer rather than
// jumping a whole GIF frame's worth of time per step.
const SUBSTEP_MS = 1000 / 60;
// A fixed seed so a downloaded GIF is reproducible: the live preview varies play to
// play, but re-downloading the same effect should yield the same clip.
const BAKE_SEED = 1;

export type ParticleGifInput = {
  /** The authored system to simulate (the decoded `system.json`). */
  system: ParticleSystem;
  /** How the billboards blend — passed through so the GIF matches the reviewer's
   * selected on-screen blend. */
  blend: ParticleBlend;
  /** Solid background color (the preview stage's color), composited behind the
   * additively-blended points so the glow reads as it does on screen. */
  background: string;
};

/** The camera framing, mirroring {@link ParticleViewer}: a 2D effect is viewed
 * face-on, a 3D one from a raised three-quarter angle. */
function particleCamera(system: ParticleSystem): {
  extent: number;
  position: [number, number, number];
  far: number;
} {
  const extent = Math.max(
    system.field.width,
    system.field.height,
    system.field.depth ?? 0,
    1,
  );
  const distance = extent * 1.8;
  const position: [number, number, number] =
    system.dimensions === 2
      ? [0, 0, distance]
      : [distance * 0.7, distance * 0.5, distance * 0.7];
  return { extent, position, far: distance * 12 + 100 };
}

/**
 * The capture window and frame timing for a system. A **looping** effect (fire, smoke)
 * captures exactly one period, primed through a full period first so the clip opens on
 * the steady-state field a live loop shows rather than the empty ramp-up. A
 * **one-shot** (an explosion, a muzzle flash) captures from ignition through its
 * duration plus the longest particle lifetime, so the burst fully dissipates before the
 * GIF loops back to the start.
 *
 * Frame count is `~FPS` across the window, capped at {@link MAX_FRAMES} (a long effect
 * samples more coarsely rather than playing too fast — the per-frame delay holds the
 * true duration).
 */
export function particleGifPlan(system: ParticleSystem): {
  captureMs: number;
  prewarmMs: number;
  frameCount: number;
  stepMs: number;
  delayMs: number;
} {
  const maxLifetime = system.emitters.reduce(
    (max, e) => Math.max(max, e.lifetimeMs + (e.lifetimeSpread ?? 0)),
    0,
  );
  const captureMs = system.loop
    ? Math.max(system.durationMs, 1)
    : Math.max(system.durationMs + maxLifetime, 1);
  const prewarmMs = system.loop ? captureMs : 0;
  const ideal = Math.ceil((captureMs / 1000) * FPS);
  const frameCount = Math.max(2, Math.min(MAX_FRAMES, ideal));
  const stepMs = captureMs / frameCount;
  return { captureMs, prewarmMs, frameCount, stepMs, delayMs: Math.round(stepMs) };
}

/** Advance the player by `ms`, sub-stepping at {@link SUBSTEP_MS} so integration is
 * stable regardless of the (coarser) per-frame capture interval. */
function advance(player: ParticleSystemPlayer, ms: number): void {
  let remaining = ms;
  while (remaining > 1e-6) {
    const dt = Math.min(remaining, SUBSTEP_MS);
    player.update(dt / 1000);
    remaining -= dt;
  }
}

/**
 * Bake a live particle system into a looping GIF on an offscreen three.js renderer
 * that mirrors the interactive {@link ParticleViewer}'s camera, point scale, and blend
 * mode so the download looks like what the reviewer saw.
 *
 * A particle system is *simulated*, not posed, so — unlike a voxel clip — there is no
 * deterministic seek. The bake instead builds a **seeded** {@link ParticleSystemPlayer}
 * (so the download is reproducible), steps it with a fixed sub-step, and captures a
 * frame at each evenly spaced instant across the window {@link particleGifPlan}
 * chooses. The additively-blended points are rendered over the solid stage background,
 * matching how the glow composites on screen. A separate, disposed-immediately renderer
 * keeps the page's live preview and its WebGL context untouched.
 *
 * Throws if a WebGL context can't be created.
 */
export async function encodeParticleGif({
  system,
  blend,
  background,
}: ParticleGifInput): Promise<Blob> {
  const { prewarmMs, frameCount, stepMs, delayMs } = particleGifPlan(system);
  const { extent, position, far } = particleCamera(system);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(SIZE, SIZE, false);
  renderer.setClearColor(new THREE.Color(background), 1);
  // Match R3F's default output color space so the baked colors match the preview
  // (the raw point shader carries no tone-mapping/colorspace chunk of its own).
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, far);
  camera.position.set(...position);
  camera.lookAt(0, 0, 0);

  const player = new ParticleSystemPlayer(system, {
    seed: BAKE_SEED,
    blending:
      blend === "normal" ? THREE.NormalBlending : THREE.AdditiveBlending,
    // gl_PointSize is in device pixels, so a smaller capture would shrink the
    // billboards relative to the frame; rescale from the stage the default is tuned
    // for so they read the same size as in the preview.
    pixelScale: extent * 6 * (SIZE / STAGE_SIZE),
  });
  scene.add(player.points);

  // A 2D canvas to composite each rendered frame onto and read pixels back from
  // (drawing our own WebGL canvas onto it is same-origin, so it never taints).
  const readback = document.createElement("canvas");
  readback.width = SIZE;
  readback.height = SIZE;
  const ctx = readback.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    player.dispose();
    renderer.dispose();
    throw new Error("Canvas 2D context is unavailable");
  }

  const gif = GIFEncoder();
  try {
    // Prime a loop to steady state (a one-shot has no prewarm — capture its ignition).
    advance(player, prewarmMs);
    for (let frame = 0; frame < frameCount; frame++) {
      // The first frame captures the current state; each subsequent one advances a
      // step, so the window is sampled at evenly spaced instants.
      if (frame > 0) advance(player, stepMs);
      renderer.render(scene, camera);
      ctx.drawImage(renderer.domElement, 0, 0, SIZE, SIZE);
      const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
      // Opaque frames (the points composite over the solid background), so quantize
      // in rgb565 — no transparency to preserve.
      const palette = quantize(data, 256, { format: "rgb565" });
      const index = applyPalette(data, palette, "rgb565");
      gif.writeFrame(index, SIZE, SIZE, { palette, delay: delayMs });
    }
    gif.finish();
  } finally {
    player.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }

  const encoded = gif.bytes();
  const bytes = new Uint8Array(encoded.length);
  bytes.set(encoded);
  return new Blob([bytes], { type: "image/gif" });
}
