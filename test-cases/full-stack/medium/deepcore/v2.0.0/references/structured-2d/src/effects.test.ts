// The produced particle systems, and the pool that plays them
// (specs/assets.md).
//
// The systems are read off disk here rather than through the engine's loader,
// because a Node process has no page to fetch them from; what they are handed to
// is the very pool the game plays them through, so a file that is not a system,
// or a system that emits nothing, fails here.

import { createCanvas } from "@napi-rs/canvas";
import { readFileSync } from "node:fs";
import { describe, expect, it, afterEach } from "vitest";
import type { ParticleSystem } from "@test-cabinet/particle-runtime";
import { MINER_H, MINER_W, STAGE_H, STAGE_W, TILE } from "./constants";
import {
  advanceEffects,
  clearEffects,
  drawEffects,
  FX_KINDS,
  installSystems,
  liveEffectCount,
  spawnEffects,
} from "./effects";
import type { FxKind } from "./effects";
import { createHarness, installStorage } from "./test-support";

/** The produced systems, read from the committed files. */
function produced(): Partial<Record<FxKind, ParticleSystem>> {
  const systems: Partial<Record<FxKind, ParticleSystem>> = {};
  for (const kind of FX_KINDS) {
    const raw = readFileSync(
      new URL(`../assets/fx/${kind}.json`, import.meta.url),
      "utf8",
    );
    systems[kind] = JSON.parse(raw) as ParticleSystem;
  }
  return systems;
}

afterEach(() => {
  clearEffects();
});

describe("the produced systems", () => {
  it("declares all twelve, and each of them emits", () => {
    const systems = produced();
    expect(Object.keys(systems).sort()).toEqual([...FX_KINDS].sort());
    installSystems(systems);
    for (const kind of FX_KINDS) {
      clearEffects();
      spawnEffects([{ kind, x: 0, y: 0 }]);
      expect(liveEffectCount()).toBe(1);
      // Step it far enough into its own duration to have spawned particles.
      for (let i = 0; i < 30; i += 1) advanceEffects(1 / 60);
      expect(liveEffectCount()).toBeGreaterThan(0);
    }
  });
});

describe("the pool", () => {
  it("spawns nothing for a system that was never produced", () => {
    installSystems({});
    spawnEffects([{ kind: "drill-debris", x: 0, y: 0 }]);
    expect(liveEffectCount()).toBe(0);
  });

  it("draws every live burst into the context it is given", () => {
    installSystems(produced());
    const canvas = createCanvas(STAGE_W, STAGE_H);
    const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
    // Each particle is one filled disc, so counting the arcs counts them.
    let arcs = 0;
    const drawArc = ctx.arc.bind(ctx);
    ctx.arc = (...args: Parameters<CanvasRenderingContext2D["arc"]>): void => {
      arcs += 1;
      drawArc(...args);
    };
    spawnEffects([{ kind: "gas-explosion", x: 400, y: 300, scale: 2 }]);
    for (let i = 0; i < 10; i += 1) advanceEffects(1 / 60);
    drawEffects(ctx);
    expect(arcs).toBeGreaterThan(0);
  });

  it("retires a burst once it has played out", () => {
    installSystems(produced());
    spawnEffects([{ kind: "impact-dust", x: 0, y: 0 }]);
    expect(liveEffectCount()).toBe(1);
    for (let i = 0; i < 60 * 20; i += 1) advanceEffects(1 / 60);
    expect(liveEffectCount()).toBe(0);
  });
});

describe("through the engine", () => {
  it("spawns and steps a burst as the game raises one", async () => {
    installStorage();
    const h = await createHarness();
    try {
      h.debug.reset();
      h.debug.clearMine();
      h.debug.setScreen("in-mine");
      // The loader has no page to fetch from in Node, so the produced systems
      // are installed here; everything else is the game's own wiring.
      installSystems(produced());
      h.debug.setTile(5, 200, "rock");
      h.debug.setTile(5, 201, "rock");
      h.debug.setMinerPosition(
        5 * TILE + (TILE - MINER_W) / 2,
        200 * TILE - MINER_H,
      );
      h.debug.setMinerVelocity(0, 0);
      h.debug.setFuel(100);
      expect(liveEffectCount()).toBe(0);
      h.hold("down");
      await h.seconds(1);
      h.release("down");
      // The drill's debris burst is live, and the frames that followed stepped
      // it rather than leaving it at zero age.
      expect(liveEffectCount()).toBeGreaterThan(0);
      const before = liveEffectCount();
      await h.seconds(8);
      expect(liveEffectCount()).toBeLessThan(before);
    } finally {
      h.dispose();
    }
  });
});
