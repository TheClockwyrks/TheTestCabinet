/// <reference types="node" />
// The renderer draws every screen through a real 2D context, sprites or no
// sprites, and the ball's spin frame runs on simulation time
// (specs/assets.md "The ball sheet").

import { createCanvas, type Canvas } from "@napi-rs/canvas";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Assets } from "./assets";
import { POD_KINDS, STAGE_SIZE, type PodKind } from "./constants";
import { Fx } from "./fx";
import { Game } from "./game";
import { drawOverlay } from "./overlay";
import { Diagnostics } from "./diagnostics";
import { ballFrameIndex, render } from "./render";

/** An asset set with nothing loaded: every draw falls back to code. */
export function bareAssets(): Assets {
  const pods = {} as Record<PodKind, HTMLImageElement | null>;
  for (const kind of POD_KINDS) pods[kind] = null;
  return {
    planet: null,
    pods,
    ball: [null, null, null, null, null, null],
    systems: {},
    audio: {} as Assets["audio"],
  };
}

/** The committed particle systems, parsed straight off the repository. */
export function committedSystems(): Assets["systems"] {
  const load = (name: string): unknown =>
    JSON.parse(
      readFileSync(
        new URL(`../assets/particles/${name}.json`, import.meta.url),
        "utf8",
      ),
    );
  return {
    burst: load("burst") as Assets["systems"]["burst"],
    spark: load("spark") as Assets["systems"]["spark"],
    burnup: load("burnup") as Assets["systems"]["burnup"],
  };
}

function draw(game: Game): Canvas {
  const canvas = createCanvas(STAGE_SIZE, STAGE_SIZE);
  const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
  const assets = bareAssets();
  render(ctx, game, assets, new Fx(assets), 0);
  return canvas;
}

/** How many pixels differ from the flat stage ground. */
function paintedPixels(canvas: Canvas): number {
  const ctx = canvas.getContext("2d");
  const data = ctx.getImageData(0, 0, STAGE_SIZE, STAGE_SIZE).data;
  let painted = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] !== 0x05 || data[i + 1] !== 0x07 || data[i + 2] !== 0x0d) {
      painted += 1;
    }
  }
  return painted;
}

describe("render", () => {
  it("draws a populated field on every screen without a single sprite", () => {
    const game = new Game();
    for (const screen of [
      "title",
      "howto",
      "playing",
      "waveclear",
      "paused",
      "gameover",
    ] as const) {
      game.poseScreen(screen);
      const canvas = draw(game);
      // Every screen paints a substantial share of the stage.
      expect(paintedPixels(canvas)).toBeGreaterThan(30000);
    }
  });

  it("draws the effects readout, pods, shield, and damage states", () => {
    const game = new Game();
    game.poseScreen("playing");
    game.session.effects.widenTicks = 300;
    game.session.effects.pierceTicks = 120;
    game.session.effects.shieldActive = true;
    game.session.pods.push({
      kind: "narrow",
      r: 250,
      angleDeg: 45,
      spawnTick: 0,
    });
    game.session.rings[1].targets[0] = 1; // a damaged ring 2 target
    expect(() => draw(game)).not.toThrow();
  });

  it("draws the diagnostics overlay", () => {
    const canvas = createCanvas(STAGE_SIZE, STAGE_SIZE);
    const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
    const diagnostics = new Diagnostics();
    diagnostics.register("screen", () => "title");
    diagnostics.register("score", () => "0");
    expect(() => drawOverlay(ctx, diagnostics)).not.toThrow();
    expect(diagnostics.lines()).toEqual([
      { label: "screen", value: "title" },
      { label: "score", value: "0" },
    ]);
  });
});

describe("ballFrameIndex", () => {
  it("advances one frame per 5 ticks and wraps at 6", () => {
    expect(ballFrameIndex(0, 0)).toBe(0);
    expect(ballFrameIndex(4, 0)).toBe(0);
    expect(ballFrameIndex(5, 0)).toBe(1);
    expect(ballFrameIndex(29, 0)).toBe(5);
    expect(ballFrameIndex(30, 0)).toBe(0);
  });

  it("counts each ball's phase from its own spawn tick", () => {
    expect(ballFrameIndex(12, 10)).toBe(0);
    expect(ballFrameIndex(17, 10)).toBe(1);
  });
});
