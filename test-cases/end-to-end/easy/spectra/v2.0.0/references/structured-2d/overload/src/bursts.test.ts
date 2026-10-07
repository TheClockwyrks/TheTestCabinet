import { describe, expect, it } from "vitest";
import {
  BURST_DURATION,
  BURST_FIELD,
  MAX_BURSTS,
  PRISM_SIZE,
  SHARD_SIZE,
} from "./constants";
import { advanceBursts, removeBurst, startBurst } from "./bursts";
import { addPlayerBulletTo } from "./bullets";
import { resolveContacts } from "./contacts";
import { noCues } from "./audio";
import { liveState, poseDrone, run } from "./fixtures";
import { burstSystem, burstSystemLoaded, loadArt } from "./sprites";
import { installAssetHost } from "./harness";
import type { InitApi } from "@clockwyrks/structured-2d";

/** The engine's asset loaders, over this project's own `assets/` directory. */
function loader(): InitApi["assets"] {
  installAssetHost();
  const resolve = (path: string): string => `assets/${path}`;
  return {
    resolve,
    load: async (path: string) => {
      const response = await fetch(resolve(path));
      return response.blob();
    },
    loadImage: async (path: string) => {
      const response = await fetch(resolve(path));
      return createImageBitmap(await response.blob());
    },
    loadAudio: async () => {
      throw new Error("no audio in this test");
    },
  };
}

describe("the seeded system", () => {
  it("is what a burst plays", async () => {
    await loadArt(loader());
    expect(burstSystemLoaded()).toBe(true);
    const system = burstSystem();
    expect(system.field.width).toBe(BURST_FIELD);
    expect(system.durationMs).toBeCloseTo(BURST_DURATION * 1000, 6);
    expect(system.loop).toBe(false);
    expect(system.emitters.length).toBeGreaterThan(1);
  });

  it("holds a live particle count its own emitters explain", async () => {
    await loadArt(loader());
    const state = liveState();
    const burst = startBurst(state, 400, 200, SHARD_SIZE);
    const declared = burstSystem()
      .emitters.filter((emitter) => emitter.emission.mode === "burst")
      .reduce(
        (total, emitter) =>
          total +
          (emitter.emission.mode === "burst" ? emitter.emission.count : 0),
        0,
      );
    run(state, 0.1);
    expect(burst.sim.liveCount).toBeGreaterThan(declared * 0.5);
    expect(burst.sim.liveCount).toBeLessThanOrEqual(declared);
    expect(burst.sim.capture().length).toBe(burst.sim.liveCount);
  });
});

describe("a pop", () => {
  it("starts one burst at the drone's centre, at its footprint", () => {
    const state = liveState();
    poseDrone(state, "prism", 500, 240, { shellAlive: false, band: "magenta" });
    addPlayerBulletTo(state, 500, 240, "cyan");
    resolveContacts(state, noCues());
    expect(state.bursts).toHaveLength(1);
    expect(state.bursts[0]).toMatchObject({ x: 500, y: 240 });
    expect(state.bursts[0].size).toBeLessThan(PRISM_SIZE);
  });

  it("plays twice for a Prism: once for its shell and once for its core", () => {
    const state = liveState();
    poseDrone(state, "prism", 400, 200);
    addPlayerBulletTo(state, 400, 200, "cyan");
    resolveContacts(state, noCues());
    expect(state.bursts).toHaveLength(1);
    expect(state.bursts[0].size).toBe(PRISM_SIZE);
    addPlayerBulletTo(state, 400, 200, "magenta");
    resolveContacts(state, noCues());
    expect(state.bursts).toHaveLength(2);
  });

  it("is a one-shot: it plays its span and is gone", () => {
    const state = liveState();
    startBurst(state, 400, 200, SHARD_SIZE);
    run(state, BURST_DURATION * 0.5);
    expect(state.bursts).toHaveLength(1);
    run(state, BURST_DURATION * 0.6);
    expect(state.bursts).toHaveLength(0);
  });

  it("scatters differently each time, from the game's own generator", () => {
    const state = liveState();
    const first = startBurst(state, 400, 200, SHARD_SIZE);
    const second = startBurst(state, 400, 200, SHARD_SIZE);
    advanceBursts(state, 0.05);
    const shape = (burst: typeof first) =>
      burst.sim
        .capture()
        .slice(0, 12)
        .map((particle) => particle.position[0].toFixed(3))
        .join(",");
    expect(shape(second)).not.toBe(shape(first));
  });

  it("caps how many play at once, keeping the newest", () => {
    const state = liveState();
    for (let index = 0; index < MAX_BURSTS + 5; index += 1) {
      startBurst(state, 100 + index, 200, SHARD_SIZE);
    }
    expect(state.bursts).toHaveLength(MAX_BURSTS);
    expect(state.bursts[state.bursts.length - 1].x).toBe(100 + MAX_BURSTS + 4);
  });

  it("removes one by id and leaves the rest playing", () => {
    const state = liveState();
    const first = startBurst(state, 100, 200, SHARD_SIZE);
    const second = startBurst(state, 200, 200, SHARD_SIZE);
    removeBurst(state, first.id);
    expect(state.bursts).toEqual([second]);
  });
});
