// The picture, sprites or no sprites: every screen draws through a real 2D
// context from the code fallbacks, the ball's spin frame runs on simulation
// time (specs/assets.md "The ball sheet"), and the committed particle
// systems play through the particle runtime.

import { createCanvas, type Canvas } from "@napi-rs/canvas";
import { readFileSync } from "node:fs";
import { ParticleCanvasPlayer } from "@clockwyrks/particle-runtime/canvas";
import type { ParticleSystem } from "@clockwyrks/particle-runtime";
import { describe, expect, it } from "vitest";
import { kesslerAssets } from "./assets";
import {
  BALL_FRAME_TICKS,
  BALL_SPIN_FRAMES,
  PARTICLE_PATHS,
  STAGE_W,
  STAGE_H,
  type Screen,
} from "./constants";
import { poseScreen, startFreshSession } from "./flow";
import { KesslerState } from "./game";
import {
  ballFrameIndex,
  drawBackdrop,
  drawBall,
  drawDeflector,
  drawHud,
  drawPlanetAndShield,
  drawPod,
  drawTarget,
} from "./render";
import { drawScreenChrome } from "./screens";

/** The committed particle systems, parsed straight off the repository. */
function committedSystem(name: keyof typeof PARTICLE_PATHS): ParticleSystem {
  return JSON.parse(
    readFileSync(
      new URL(`../assets/${PARTICLE_PATHS[name]}`, import.meta.url),
      "utf8",
    ),
  ) as ParticleSystem;
}

function stageContext() {
  const canvas = createCanvas(STAGE_W, STAGE_H);
  return {
    canvas,
    ctx: canvas.getContext("2d") as unknown as CanvasRenderingContext2D,
  };
}

/** How many pixels differ from the flat stage ground. */
function paintedPixels(canvas: Canvas): number {
  const data = canvas
    .getContext("2d")
    .getImageData(0, 0, STAGE_W, STAGE_H).data;
  let painted = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] !== 0x05 || data[i + 1] !== 0x07 || data[i + 2] !== 0x0d) {
      painted += 1;
    }
  }
  return painted;
}

/** Draw a whole frame of `state` from the code fallbacks alone. */
function drawFrame(state: KesslerState) {
  const { canvas, ctx } = stageContext();
  const assets = kesslerAssets();
  drawBackdrop(ctx, state);
  for (let ring = 0; ring < 3; ring += 1) {
    for (let slot = 0; slot < state.rings[ring].targets.length; slot += 1) {
      drawTarget(ctx, state, ring, slot);
    }
  }
  drawPlanetAndShield(ctx, state, assets);
  drawDeflector(ctx, state);
  for (const pod of state.pods) drawPod(ctx, pod, assets);
  for (const ball of state.balls) drawBall(ctx, ball, state, assets);
  drawScreenChrome(ctx, state, assets);
  return canvas;
}

describe("the ball's spin clock", () => {
  it("advances one frame per 5 ticks, wrapping 0..5, from the spawn tick", () => {
    expect(ballFrameIndex(0, 0)).toBe(0);
    expect(ballFrameIndex(BALL_FRAME_TICKS - 1, 0)).toBe(0);
    expect(ballFrameIndex(BALL_FRAME_TICKS, 0)).toBe(1);
    expect(ballFrameIndex(BALL_FRAME_TICKS * BALL_SPIN_FRAMES, 0)).toBe(0);
    // Phase counts from the ball's own spawn tick.
    expect(ballFrameIndex(BALL_FRAME_TICKS * 3 + 7, BALL_FRAME_TICKS * 3)).toBe(
      1,
    );
  });
});

describe("every screen draws", () => {
  const screens: Screen[] = [
    "title",
    "howto",
    "playing",
    "waveclear",
    "paused",
    "gameover",
  ];
  for (const screen of screens) {
    it(`paints the ${screen} screen with no sprite loaded`, () => {
      const state = new KesslerState();
      startFreshSession(state);
      if (screen !== "playing") poseScreen(state, screen);
      const canvas = drawFrame(state);
      expect(paintedPixels(canvas)).toBeGreaterThan(20000);
    });
  }

  it("draws the shield ring while one is active", () => {
    const state = new KesslerState();
    startFreshSession(state);
    const bare = paintedPixels(drawFrame(state));
    state.effects.shieldActive = true;
    expect(paintedPixels(drawFrame(state))).toBeGreaterThan(bare);
  });

  it("draws the HUD's effect readout when effects are in force", () => {
    const state = new KesslerState();
    startFreshSession(state);
    const hudPixels = (): number => {
      const { canvas, ctx } = stageContext();
      ctx.fillStyle = "#05070d";
      ctx.fillRect(0, 0, STAGE_W, STAGE_H);
      drawHud(ctx, state, kesslerAssets());
      return paintedPixels(canvas);
    };
    const bare = hudPixels();
    state.effects.widenTicks = 300;
    state.effects.pierceTicks = 100;
    state.effects.shieldActive = true;
    expect(hudPixels()).toBeGreaterThan(bare);
  });
});

describe("the committed particle systems", () => {
  for (const name of ["burst", "spark", "burnup"] as const) {
    it(`plays ${name} through the particle runtime's canvas binding`, () => {
      const system = committedSystem(name);
      expect(system.durationMs).toBeGreaterThan(0);
      const { canvas, ctx } = stageContext();
      const player = new ParticleCanvasPlayer(system, ctx, {
        composite: "lighter",
        clear: false,
        seed: 7,
      });
      let peak = 0;
      for (let step = 0; step < 30; step += 1) {
        player.update(1 / 30);
        peak = Math.max(peak, player.simulator.liveCount);
      }
      // The system actually emitted...
      expect(peak).toBeGreaterThan(0);
      // ...and left visible light on the canvas at some point.
      expect(paintedPixels(canvas)).toBeGreaterThan(0);
      // A one-shot runs out within its stated duration plus particle life.
      for (let step = 0; step < 300; step += 1) player.update(1 / 30);
      expect(player.simulator.liveCount).toBe(0);
    });
  }
});
