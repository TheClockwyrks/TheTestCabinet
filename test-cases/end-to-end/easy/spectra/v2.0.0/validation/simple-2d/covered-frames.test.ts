// covered-frames — self-checks for the harness's frame clear.
//
// This file decides nothing about the build. It proves the two properties
// `covered-frames.ts` is only worth having if it has, because both are invisible
// from inside a validator and wrong in ways nothing else catches:
//
//   1. IT NEVER CHANGES A PIXEL. Every scene below is drawn twice, once through
//      the real context and once through the wrapper, and the two are compared as
//      encoded bytes. A wrapper that cleared a fill which did not really cover the
//      canvas would erase part of the picture every check reads and every still a
//      reviewer looks at.
//   2. IT ACTUALLY MAKES THE CANVAS FORGET. A run of filtered draws over an
//      opaque background costs what one frame costs rather than what every frame
//      ever drawn costs. That is the whole point, and it is a property of the
//      canvas implementation rather than of this code, so it is measured.
//
// No review item names this file, so a run never loads it. It runs with the whole
// project:
//
//   npx vitest run --config validation/vitest.config.ts

import { createCanvas, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import { expect, it } from "vitest";
import { clearBeforeCoveringFills } from "./covered-frames";

/** The stage the scenes are drawn on, big enough for the filter to cost. */
const W = 640;
const H = 360;

/** A tint chain of the kind a build colours a seeded sprite with. */
const TINT =
  "grayscale(1) brightness(1.100) sepia(1) hue-rotate(290deg) saturate(7)";

/** A small sprite with a transparent corner, so alpha is in play. */
function art(): Canvas {
  const canvas = createCanvas(32, 32);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#7c4a8d";
  ctx.fillRect(0, 0, 32, 32);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(8, 8, 16, 16);
  ctx.clearRect(0, 0, 6, 6);
  return canvas;
}

const SPRITE = art();

/** Draw `count` tinted sprites, as a frame of the game would. */
function sprites(ctx: SKRSContext2D, frame: number, count: number): void {
  ctx.imageSmoothingEnabled = false;
  for (let i = 0; i < count; i += 1) {
    ctx.filter = TINT;
    ctx.drawImage(
      SPRITE,
      (i * 53 + frame) % (W - 32),
      (frame * 7 + i * 31) % (H - 32),
      21,
      21,
    );
    ctx.filter = "none";
  }
}

/** Run `scene` for `frames` frames, and answer the PNG it left. */
function draw(
  scene: (ctx: SKRSContext2D, frame: number) => void,
  frames: number,
  wrapped: boolean,
): { png: Buffer; encodeMs: number } {
  const canvas = createCanvas(W, H);
  const real = canvas.getContext("2d");
  const ctx = wrapped ? clearBeforeCoveringFills(real) : real;
  for (let frame = 0; frame < frames; frame += 1) scene(ctx, frame);
  const started = performance.now();
  const png = canvas.toBuffer("image/png");
  return { png, encodeMs: performance.now() - started };
}

/**
 * Every way a frame can open, including the ones the wrapper must leave alone.
 *
 * A scene that the wrapper is expected to clear and a scene it is expected to
 * refuse are proved the same way, because the property being proved is the same
 * one: the picture is what the build drew.
 *
 * The first eighteen are the table `validation/none/raster-init.test.ts` runs
 * against the browser implementation, scene for scene, so that one rule is held
 * to one set of cases on all three engines. The eighteenth is where the two
 * implementations part: this wrapper refuses to clear under an open `save` and
 * the browser one clears anyway, and both tables prove the frame comes out the
 * same either way.
 */
const scenes: Record<string, (ctx: SKRSContext2D, frame: number) => void> = {
  "an opaque background fill": (ctx, frame) => {
    ctx.fillStyle = "#05070f";
    ctx.fillRect(0, 0, W, H);
    sprites(ctx, frame, 6);
  },
  "an opaque fill under a scaled transform": (ctx, frame) => {
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.fillStyle = "#05070f";
    ctx.fillRect(0, 0, W, H);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    sprites(ctx, frame, 6);
  },
  "a fill that covers all but a strip": (ctx, frame) => {
    ctx.fillStyle = "#05070f";
    ctx.fillRect(0, 0, W - 24, H);
    sprites(ctx, frame, 6);
  },
  "a translucent fade over the frame before": (ctx, frame) => {
    ctx.fillStyle = "rgba(5, 7, 15, 0.25)";
    ctx.fillRect(0, 0, W, H);
    sprites(ctx, frame, 3);
  },
  "a gradient background": (ctx, frame) => {
    const wash = ctx.createLinearGradient(0, 0, 0, H);
    wash.addColorStop(0, "#05070f");
    wash.addColorStop(1, "#101830");
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, W, H);
    sprites(ctx, frame, 3);
  },
  "a background fill under a reduced alpha": (ctx, frame) => {
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = "#05070f";
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
    sprites(ctx, frame, 3);
  },
  "a background fill under a filter": (ctx, frame) => {
    ctx.filter = "opacity(0.3)";
    ctx.fillStyle = "#05070f";
    ctx.fillRect(0, 0, W, H);
    ctx.filter = "none";
    sprites(ctx, frame, 3);
  },
  "a background fill under a blending operator": (ctx, frame) => {
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = "#8890a0";
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
    sprites(ctx, frame, 3);
  },
  "a background fill inside a clip": (ctx, frame) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(40, 40, 300, 200);
    ctx.clip();
    ctx.fillStyle = "#05070f";
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    sprites(ctx, frame, 3);
  },
  "a clip left in force at the base of the stack": (ctx, frame) => {
    if (frame === 0) {
      ctx.beginPath();
      ctx.rect(0, 0, W - 60, H - 40);
      ctx.clip();
    }
    ctx.fillStyle = "#05070f";
    ctx.fillRect(0, 0, W, H);
    sprites(ctx, frame, 3);
  },
  "a clip taken and given back before the fill": (ctx, frame) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, 120, 120);
    ctx.clip();
    ctx.restore();
    ctx.fillStyle = "#05070f";
    ctx.fillRect(0, 0, W, H);
    sprites(ctx, frame, 6);
  },
  "a named colour background": (ctx, frame) => {
    ctx.fillStyle = "midnightblue";
    ctx.fillRect(0, 0, W, H);
    sprites(ctx, frame, 6);
  },
  "a background colour with an alpha channel": (ctx, frame) => {
    ctx.fillStyle = "#05070f80";
    ctx.fillRect(0, 0, W, H);
    sprites(ctx, frame, 3);
  },
  "a frame that clears nothing at all": (ctx, frame) => {
    sprites(ctx, frame, 2);
  },
  "a frame opened with a clear": (ctx, frame) => {
    ctx.clearRect(0, 0, W, H);
    sprites(ctx, frame, 6);
  },
  "a restore with nothing under it": (ctx, frame) => {
    ctx.restore();
    ctx.fillStyle = "#05070f";
    ctx.fillRect(0, 0, W, H);
    sprites(ctx, frame, 6);
  },
  "a background fill under an open save": (ctx, frame) => {
    ctx.save();
    ctx.fillStyle = "#05070f";
    ctx.fillRect(0, 0, W, H);
    sprites(ctx, frame, 6);
    ctx.restore();
  },
  "text and paths drawn through the tint": (ctx, frame) => {
    ctx.fillStyle = "#05070f";
    ctx.fillRect(0, 0, W, H);
    ctx.filter = TINT;
    ctx.fillStyle = "#ffffff";
    ctx.font = "24px sans-serif";
    ctx.fillText(`wave ${frame}`, 24, 40);
    ctx.beginPath();
    ctx.arc(200, 200, 40, 0, Math.PI * 2);
    ctx.fill();
    ctx.filter = "none";
    sprites(ctx, frame, 3);
  },

  // ---- The shapes a proof must refuse, or prove exactly ---------------------

  "a clip opened and then dropped by a reset": (ctx, frame) => {
    ctx.beginPath();
    ctx.rect(0, 0, 100, 100);
    ctx.clip();
    ctx.reset();
    ctx.fillStyle = "#05070f";
    ctx.fillRect(0, 0, W, H);
    sprites(ctx, frame, 6);
  },
  "a background fill under the copy operator": (ctx, frame) => {
    ctx.globalCompositeOperation = "copy";
    ctx.fillStyle = "#05070f";
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
    sprites(ctx, frame, 6);
  },
  "a background fill given as a negative rectangle": (ctx, frame) => {
    ctx.fillStyle = "#05070f";
    ctx.fillRect(W, H, -W, -H);
    sprites(ctx, frame, 6);
  },
  "a background fill under a half-turn": (ctx, frame) => {
    ctx.setTransform(-1, 0, 0, -1, W, H);
    ctx.fillStyle = "#05070f";
    ctx.fillRect(0, 0, W, H);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    sprites(ctx, frame, 6);
  },
  "a background fill under a rotation": (ctx, frame) => {
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(Math.PI / 6);
    ctx.fillStyle = "#05070f";
    ctx.fillRect(-W, -H, W * 2, H * 2);
    ctx.restore();
    sprites(ctx, frame, 6);
  },
  "a background fill casting a shadow": (ctx, frame) => {
    ctx.shadowColor = "#ff0000";
    ctx.shadowBlur = 12;
    ctx.fillStyle = "#05070f";
    ctx.fillRect(0, 0, W, H);
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    sprites(ctx, frame, 6);
  },
  "a canvas resized after a clip was taken": (ctx, frame) => {
    if (frame === 0) {
      ctx.beginPath();
      ctx.rect(0, 0, 80, 80);
      ctx.clip();
      ctx.canvas.width = W - 40;
      ctx.canvas.height = H - 20;
    }
    ctx.fillStyle = "#05070f";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    sprites(ctx, frame, 6);
  },
};

for (const [name, scene] of Object.entries(scenes)) {
  it(`leaves the same picture for ${name}`, () => {
    const plain = draw(scene, 24, false);
    const wrapped = draw(scene, 24, true);
    expect(wrapped.png.equals(plain.png)).toBe(true);
  });
}

it("costs one frame to encode rather than every frame ever drawn", () => {
  const frames = 100;
  const scene = scenes["an opaque background fill"];
  const plain = draw(scene, frames, false);
  const wrapped = draw(scene, frames, true);

  expect(wrapped.png.equals(plain.png)).toBe(true);
  // The measured ratio on this machine is around a hundred; the bar is a fifth of
  // that, so the check reports a wrapper that stopped working rather than a
  // machine that was busy.
  expect(plain.encodeMs).toBeGreaterThan(wrapped.encodeMs * 5);
});
