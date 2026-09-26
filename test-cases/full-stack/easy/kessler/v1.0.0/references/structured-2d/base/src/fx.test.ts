/// <reference types="node" />
// The effects layer through the engine: a destruction spawns the committed
// burst system into the layer, the layer composites it frame by frame on the
// game's tick clock, and a finished play leaves the layer empty. The stub
// loader below hands `loadAssets` the committed `system.json` files straight
// off the repository, which is the one way a Node process can give the layer
// real systems to play.

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fxOf } from "./actors";
import { loadAssets } from "./assets";
import { createHarness, type Harness } from "./harness";
import { pointAt } from "./polar";
import type { InitApi } from "@clockwyrks/structured-2d";

/** A loader over the repository's own files: systems load, images do not. */
const diskApi: Pick<InitApi, "assets"> = {
  assets: {
    loadImage: () => Promise.reject(new Error("no images in this process")),
    loadAudio: () => Promise.reject(new Error("no audio in this process")),
    load: (path: string) =>
      Promise.resolve(
        new Blob([readFileSync(new URL(`../assets/${path}`, import.meta.url))]),
      ),
    resolve: (path: string) => `assets/${path}`,
  },
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  await loadAssets(diskApi);
});

afterEach(async () => {
  h.dispose();
  // Put the module holder back the way an asset-less process leaves it.
  await loadAssets({
    assets: {
      ...diskApi.assets,
      load: () => Promise.reject(new Error("unavailable")),
    },
  });
});

describe("the effects layer", () => {
  it("plays the burst of a destruction and runs it out", async () => {
    h.debug.setScreen("playing");
    h.debug.setPodSpawn(false);
    h.debug.clearTargets();
    h.debug.spawnTarget(1, 0, 1);
    h.debug.clearBalls();
    const at = pointAt(332, 15);
    const heading = pointAt(1, 195); // radially inward at angle 15
    h.debug.spawnBall(
      at.x,
      at.y,
      (heading.x - 500) * 240,
      (heading.y - 500) * 240,
    );
    await h.step(4);
    expect(h.debug.snapshot().rings[0].targets).toEqual([]);
    const fx = fxOf(h.engine.world);
    expect(fx.count).toBeGreaterThan(0);
    // The one-shot runs out well within a few seconds of frames.
    await h.step(600);
    expect(fx.count).toBe(0);
  });

  it("is emptied by a debug reset", async () => {
    h.debug.setScreen("playing");
    h.debug.setShield(true);
    h.debug.clearBalls();
    const at = pointAt(110, 90);
    h.debug.spawnBall(at.x, at.y, 0, -240);
    await h.step(4);
    expect(h.cues).toContain("shield-reflect");
    expect(fxOf(h.engine.world).count).toBeGreaterThan(0);
    h.debug.reset();
    expect(fxOf(h.engine.world).count).toBe(0);
  });
});
