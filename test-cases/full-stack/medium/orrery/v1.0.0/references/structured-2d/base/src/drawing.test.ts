// Orrery — the picture the build puts on the canvas (specs/ui.md,
// specs/editor.md, specs/assets.md).
//
// Two halves, because the frame has two. The first drives a REAL ENGINE
// through `src/harness.ts` and reads the pixels its pipeline produced, so what
// is checked is the layer order `src/actors.ts` spreads the field across and
// the draw components the engine collected. The second calls
// `src/fielddraw.ts` straight, over a stand-in sprite store, so the draw path
// that uses the produced sprites is exercised where the produced files
// themselves cannot be decoded — a test runs in Node, which has no image
// decoder.

import { describe, expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";

import { installAssets, NO_SPRITES, spritePaths, type Sprites } from "./assets";
import { STAGE_H, STAGE_W } from "./constants";
import { createDebugApi } from "./debug";
import { drawFieldScreen } from "./fielddraw";
import { Bench, createHarness, type Harness } from "./harness";

/**
 * How much of the frame the engine drew is appreciably brighter than the sky.
 * The sky is the darkest thing on the stage, so anything above the threshold is
 * something the frame put there.
 */
function painted(harness: Harness): number {
  const data = harness.ctx.getImageData(0, 0, STAGE_W, STAGE_H).data;
  let lit = 0;
  for (let at = 0; at < data.length; at += 4) {
    if (data[at] + data[at + 1] + data[at + 2] > 120) lit += 1;
  }
  return lit;
}

/** A real 2D context at the stage's logical size, from `@napi-rs/canvas`. */
function stage(): {
  ctx: CanvasRenderingContext2D;
  lit: () => number;
} {
  const canvas = createCanvas(STAGE_W, STAGE_H);
  const ctx = canvas.getContext("2d");
  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    lit: () => {
      const data = ctx.getImageData(0, 0, STAGE_W, STAGE_H).data;
      let count = 0;
      for (let at = 0; at < data.length; at += 4) {
        if (data[at] + data[at + 1] + data[at + 2] > 120) count += 1;
      }
      return count;
    },
  };
}

/**
 * A sprite store answering every path with one small painted tile, so the draw
 * path that uses the produced sprites is exercised where the produced files
 * themselves cannot be decoded — a test runs in Node, which has no `Image`.
 */
function stubSprites(): Sprites {
  const tile = createCanvas(48, 48);
  const ctx = tile.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(4, 4, 40, 40);
  return { get: () => tile as unknown as CanvasImageSource };
}

/** Every produced sprite path, answered by one painted tile. */
function stubImages(): Map<string, CanvasImageSource> {
  const tile = createCanvas(48, 48);
  const ctx = tile.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(4, 4, 40, 40);
  const images = new Map<string, CanvasImageSource>();
  for (const path of spritePaths()) {
    images.set(path, tile as unknown as CanvasImageSource);
  }
  return images;
}

describe("the frame the engine renders (specs/ui.md)", () => {
  it("draws the title screen", async () => {
    const harness = await createHarness();
    await harness.step(1);
    expect(painted(harness)).toBeGreaterThan(1000);
    harness.dispose();
  });

  it("draws every how-to page", async () => {
    const harness = await createHarness();
    harness.debug.setScreen("howto");
    for (let page = 0; page < 5; page += 1) {
      harness.debug.setHowtoPage(page);
      await harness.step(1);
      expect(painted(harness), `page ${page}`).toBeGreaterThan(1000);
    }
    harness.dispose();
  });

  it("draws both select screens", async () => {
    for (const mode of ["campaign", "extras"] as const) {
      const harness = await createHarness();
      harness.debug.setMode(mode);
      harness.debug.setScreen("select");
      await harness.step(1);
      expect(painted(harness), mode).toBeGreaterThan(1000);
      harness.dispose();
    }
  });

  it("draws the editor over a challenge, its machine, and its run", async () => {
    const harness = await createHarness();
    const api = harness.debug;
    api.openChallenge("extras", 0);
    api.placeRise(0, -2, 0, 0);
    api.placeSet(0, 2, 0, 0);
    api.placePart("arm", 0, 0, 3);
    const arm = harness.state.editor.parts[2].id;
    api.setTapeCell(arm, 0, "grab");
    api.setTapeCell(arm, 1, "rotate-cw");
    api.setSelected(arm);
    await harness.step(1);
    expect(painted(harness)).toBeGreaterThan(5000);

    api.startRun();
    await harness.step(12);
    expect(painted(harness)).toBeGreaterThan(5000);
    harness.dispose();
  });

  it("draws the fault display over a halted run", async () => {
    const harness = await createHarness();
    const api = harness.debug;
    api.openChallenge("extras", 0);
    api.placePart("wheel", 0, 0, 0);
    api.setTapeCell(harness.state.editor.parts[0].id, 0, "grab");
    api.startRun();
    await harness.step(60);
    expect(harness.state.sim?.status).toBe("faulted");
    expect(painted(harness)).toBeGreaterThan(1000);
    harness.dispose();
  });

  it("draws the solved panel over a completed run", async () => {
    const harness = await createHarness();
    const api = harness.debug;
    api.openChallenge("extras", 0);
    api.placeSet(0, 2, 0, 0);
    api.startRun();
    api.setTally(0, 6);
    await harness.step(60);
    expect(harness.state.sim?.status).toBe("complete");
    expect(painted(harness)).toBeGreaterThan(1000);
    harness.dispose();
  });

  it("draws a live drag's ghost, and a move drag's", async () => {
    const harness = await createHarness();
    const api = harness.debug;
    api.openChallenge("extras", 0);
    api.pointerDown(20, 60);
    api.pointerMove(616, 304);
    expect(harness.state.editor.drag).not.toBeNull();
    await harness.step(1);
    expect(painted(harness)).toBeGreaterThan(1000);
    api.pointerUp();

    api.placePart("arm", 0, 2, 0);
    api.pointerDown(616 + 48, 304 + 48 * Math.sqrt(3));
    api.pointerMove(616 + 96, 304 + 48 * Math.sqrt(3));
    expect(harness.state.editor.drag?.kind).toBe("move");
    await harness.step(1);
    expect(painted(harness)).toBeGreaterThan(1000);
    api.pointerUp();
    harness.dispose();
  });

  it("draws the produced sprites when they have loaded", async () => {
    const harness = await createHarness();
    const api = harness.debug;
    api.openChallenge("campaign", 10);
    api.placeRise(0, -4, 2, 0);
    api.placeSet(0, 3, 0, 0);
    api.placePart("wheel", -2, -1, 0);
    api.placePart("triune", 1, 2, 0);
    api.placePart("arm", 0, 0, 0);
    api.startRun();
    await harness.step(1);
    const plain = painted(harness);

    installAssets(stubImages(), new Map());
    await harness.step(1);
    const withSprites = painted(harness);
    installAssets(new Map(), new Map());
    // Every sprite is a bright tile, so a frame drawn with them is far brighter
    // than the same frame drawn on its code-drawn fallbacks alone.
    expect(withSprites).toBeGreaterThan(plain);
    harness.dispose();
  });
});

describe("the field's own drawing (specs/assets.md)", () => {
  it("draws every produced sprite the field calls for, and its fallbacks", () => {
    const game = new Bench();
    const api = createDebugApi(() => game);
    api.openChallenge("campaign", 10);
    api.placeRise(0, -4, 2, 0);
    api.placeSet(0, 3, 0, 0);
    api.placePart("wheel", -2, -1, 0);
    api.placePart("triune", 1, 2, 0);
    api.placePart("manifold", -1, -3, 0);
    api.placePart("arm", 0, 0, 0);
    api.startRun();
    api.spawnMote(0, 2, "nova");
    api.spawnMote(1, 2, "nova");
    const motes = game.state.sim?.motes ?? [];
    api.linkMotes(motes[motes.length - 2].id, motes[motes.length - 1].id, 3);

    const plain = stage();
    drawFieldScreen(plain.ctx, game.state, NO_SPRITES);
    const painted_ = stage();
    drawFieldScreen(painted_.ctx, game.state, stubSprites());
    expect(painted_.lit()).toBeGreaterThan(plain.lit());
    expect(plain.lit()).toBeGreaterThan(1000);
  });
});
