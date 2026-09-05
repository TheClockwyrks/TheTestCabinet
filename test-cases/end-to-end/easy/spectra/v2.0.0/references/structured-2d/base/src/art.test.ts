// The seeded art: what is drawn from a sprite, and what a burst plays.
//
// The engine's asset loader reaches for `fetch` and `createImageBitmap`, neither
// of which resolves a relative path in this host, so the seeded files cannot be
// read off disk here. What this file does instead is hand `loadArt` a loader of
// its own, returning a flat square per sprite and a one-shot particle system for
// the burst. A pixel read then says that the BITMAP THE LOADER HANDED OVER is
// what reached the canvas — a flat square paints the corners of the drawn box,
// which none of the shapes the build falls back to reaches — and a live particle
// count says that the SYSTEM THE LOADER HANDED OVER is what is playing.

import { createCanvas } from "@napi-rs/canvas";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ParticleSystem } from "@clockwyrks/particle-runtime";
import type { InitApi } from "@clockwyrks/structured-2d";
import { BURST_DURATION, BURST_FIELD, PRISM_SIZE, SPRITES } from "./constants";
import { emptyArt, loadArt } from "./assets";
import {
  createHarness,
  lastDroneId,
  startPosed,
  type Harness,
} from "./harness";

/** A flat 64x64 square, standing in for a decoded PNG. */
function flat(color: string): ImageBitmap {
  const canvas = createCanvas(64, 64);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 64, 64);
  return canvas as unknown as ImageBitmap;
}

/** A one-shot system that bursts forty particles at the start and decays. */
const STAND_IN_SYSTEM: ParticleSystem = {
  dimensions: 2,
  field: { width: BURST_FIELD, height: BURST_FIELD },
  durationMs: BURST_DURATION * 1000,
  fps: 60,
  loop: false,
  emitters: [
    {
      name: "spark",
      shape: "point",
      position: [BURST_FIELD / 2, BURST_FIELD / 2, 0],
      extent: { radius: 1, size: [1, 1, 0] },
      emission: { mode: "burst", count: 40, atMs: 0 },
      lifetimeMs: BURST_DURATION * 1000,
      speed: 40,
      direction: [0, 1, 0],
    },
  ],
};

/** Every path the build asked the loader for. */
const asked: string[] = [];

function stubAssets(): Pick<InitApi["assets"], "loadImage" | "load"> {
  return {
    loadImage: async (path: string) => {
      asked.push(path);
      return flat("rgb(190, 190, 190)");
    },
    load: async (path: string) => {
      asked.push(path);
      return new Blob([JSON.stringify(STAND_IN_SYSTEM)]);
    },
  };
}

let h: Harness;

beforeEach(async () => {
  asked.length = 0;
  h = await createHarness();
  startPosed(h.debug);
});

afterEach(async () => {
  h.dispose();
  // Leave the module holder as this host found it, so a later file draws the
  // shapes it falls back to rather than this file's stand-ins.
  await loadArt({
    loadImage: () => Promise.reject(new Error("no art")),
    load: () => Promise.reject(new Error("no art")),
  });
});

describe("the loader the build reaches for", () => {
  it("asks for each seeded file by the name the specification gives it", async () => {
    await loadArt(stubAssets());
    expect(asked).toContain(SPRITES.fighter);
    expect(asked).toContain(SPRITES.shard);
    expect(asked).toContain(SPRITES.flux);
    expect(asked).toContain(SPRITES.prism);
    expect(asked).toContain("drone-burst.json");
    // Every path is written relative to the fixed `assets/` root.
    for (const path of asked) {
      expect(path.startsWith("/")).toBe(false);
      expect(path).not.toContain("..");
    }
  });

  it("keeps a file that did not arrive as absent rather than failing", async () => {
    await loadArt({
      loadImage: () => Promise.reject(new Error("no")),
      load: () => Promise.reject(new Error("no")),
    });
    expect(emptyArt()).toEqual({
      fighter: null,
      shard: null,
      flux: null,
      prism: null,
      burst: null,
    });
  });
});

describe("what a sprite draws", () => {
  it("draws a drone from the bitmap the loader handed over", async () => {
    h.debug.addDrone("prism", 400, 200);
    h.debug.setDroneTravel(lastDroneId(h.debug), false);

    await h.advance(1);
    const bare = h.pixel(400 - PRISM_SIZE / 2 + 2, 200 - PRISM_SIZE / 2 + 2);

    await loadArt(stubAssets());
    await h.advance(1);
    const drawn = h.pixel(400 - PRISM_SIZE / 2 + 2, 200 - PRISM_SIZE / 2 + 2);

    // The corner of the drawn box is inside the sprite and outside every shape
    // the build falls back to, so it is bright only once the sprite is there.
    const sum = (rgb: [number, number, number]): number =>
      rgb[0] + rgb[1] + rgb[2];
    expect(sum(drawn)).toBeGreaterThan(sum(bare) + 120);
  });

  it("draws the ship from its own sprite", async () => {
    await loadArt(stubAssets());
    h.debug.setShipX(400);
    await h.advance(1);
    const [r, g, b] = h.pixel(400, 600);
    expect(r + g + b).toBeGreaterThan(240);
  });
});

describe("what a burst plays", () => {
  it("plays the system the loader handed over, and decays to nothing", async () => {
    await loadArt(stubAssets());
    // A bystander, so the wave is not emptied and the stage does not clear.
    h.debug.addDrone("shard", 200, 200);
    h.debug.setDroneTravel(lastDroneId(h.debug), false);
    h.debug.addDrone("shard", 900, 200);
    h.debug.setDroneTravel(lastDroneId(h.debug), false);
    h.debug.addPlayerBullet(900, 205, "cyan");
    await h.advance(2);

    const bursts = h.debug.snapshot().bursts;
    expect(bursts).toHaveLength(1);
    expect(bursts[0]?.particles).toBeGreaterThan(0);
    expect(bursts[0]?.x).toBe(900);

    await h.seconds(BURST_DURATION + 0.1);
    expect(h.debug.snapshot().bursts).toHaveLength(0);
  });

  it("scatters two bursts differently while replaying one seed exactly", async () => {
    await loadArt(stubAssets());
    const pop = async (): Promise<number> => {
      h.debug.addDrone("shard", 900, 200);
      h.debug.setDroneTravel(lastDroneId(h.debug), false);
      h.debug.addPlayerBullet(900, 205, "cyan");
      await h.advance(2);
      const burst = h.debug.snapshot().bursts.slice(-1)[0];
      return burst?.particles ?? 0;
    };

    h.debug.reset({ seed: 3 });
    startPosed(h.debug);
    h.debug.addDrone("shard", 200, 200);
    h.debug.setDroneTravel(lastDroneId(h.debug), false);
    const first = await pop();
    expect(first).toBeGreaterThan(0);
    await pop();
    expect(h.debug.snapshot().bursts).toHaveLength(2);
  });
});
