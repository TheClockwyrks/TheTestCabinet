/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import { readFileSync } from "node:fs";
import type { ParticleSystem } from "@clockwyrks/particle-runtime";

import { installAssets, spritePaths } from "./assets";
import { PARTICLE_PATHS } from "./constants";
import { createDebugApi } from "./debug";
import { PARTICLE_NAMES, type ParticleSystemName } from "./figures";
import { FxLayer, pageCanvas, type CanvasSource } from "./fx";
import { advanceFrame } from "./flow";
import { Bench } from "./harness";
import { hexCenter } from "./hex";

/** A canvas source backed by `@napi-rs/canvas`, so a test can play an effect. */
const scratch = (): HTMLCanvasElement =>
  createCanvas(1, 1) as unknown as HTMLCanvasElement;

/** The three produced systems, read off the committed files. */
function committedSystems(): Map<ParticleSystemName, ParticleSystem> {
  const systems = new Map<ParticleSystemName, ParticleSystem>();
  for (const name of PARTICLE_NAMES) {
    const raw = readFileSync(`assets/${PARTICLE_PATHS[name]}`, "utf8");
    systems.set(name, JSON.parse(raw) as ParticleSystem);
  }
  return systems;
}

/** A layer with the committed systems installed behind it. */
function layer(source: CanvasSource = scratch): FxLayer {
  installAssets(new Map(), committedSystems());
  return new FxLayer(source);
}

describe("the produced particle systems (specs/assets.md)", () => {
  it("commits all three, as documents the player can play", () => {
    for (const [, system] of committedSystems()) {
      const shape = system as unknown as {
        durationMs: number;
        loop: boolean;
        emitters: unknown[];
      };
      expect(shape.durationMs).toBeGreaterThan(0);
      // Each is authored one-shot, so it decays to empty rather than settling.
      expect(shape.loop).toBe(false);
      expect(shape.emitters.length).toBeGreaterThan(0);
    }
  });

  it("names a sprite path for every produced still and sheet frame", () => {
    const paths = spritePaths();
    expect(new Set(paths).size).toBe(paths.length);
    // Fifteen motes, two filaments, twelve sigils, ten instructions, six part
    // pieces, and two six-frame aperture sheets.
    expect(paths).toHaveLength(15 + 2 + 12 + 10 + 6 + 12);
  });
});

describe("the effects layer (specs/assets.md)", () => {
  it("plays an effect, advances it, and retires it when it is spent", () => {
    const fx = layer();
    fx.fire({ system: "deliver", at: { x: 100, y: 100 } });
    expect(fx.count).toBe(1);
    for (let frame = 0; frame < 120; frame += 1) fx.tick(1 / 60);
    expect(fx.count).toBe(0);
  });

  it("composites onto the context it is handed, and clears on demand", () => {
    const fx = layer();
    const canvas = createCanvas(64, 64);
    const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
    fx.fire({ system: "complete", at: { x: 32, y: 32 } });
    fx.tick(1 / 60);
    expect(() =>
      fx.draw({ ctx } as unknown as Parameters<FxLayer["draw"]>[0]),
    ).not.toThrow();
    fx.clear();
    expect(fx.count).toBe(0);
  });

  it("plays nothing where there is no canvas to scratch on", () => {
    const fx = layer(() => null);
    fx.fire({ system: "fault", at: { x: 0, y: 0 } });
    expect(fx.count).toBe(0);
    // The page's own source answers `null` under a test, where there is no DOM.
    expect(pageCanvas()).toBeNull();
  });

  it("plays nothing for a system this build has not loaded", () => {
    installAssets(new Map(), new Map());
    const fx = new FxLayer(scratch);
    fx.fire({ system: "deliver", at: { x: 0, y: 0 } });
    expect(fx.count).toBe(0);
  });
});

describe("what raises an effect (specs/assets.md)", () => {
  it("raises a delivery on each set that took a constellation", () => {
    const game = new Bench();
    const api = createDebugApi(() => game);
    api.openChallenge("extras", 0);
    api.placeSet(0, 2, 0, 0);
    api.startRun();
    game.drainEffects();
    api.spawnMote(2, 0, "sol");
    api.setCycle(0);
    advanceFrame(game, 1 / 3);
    const raised = game.drainEffects();
    expect(raised.map((event) => event.system)).toContain("deliver");
    expect(raised[0].at).toEqual(hexCenter({ q: 2, r: 0 }));
  });

  it("raises the completion over the middle of the field", () => {
    const game = new Bench();
    const api = createDebugApi(() => game);
    api.openChallenge("extras", 0);
    api.placeSet(0, 2, 0, 0);
    api.startRun();
    api.setTally(0, 6);
    game.drainEffects();
    advanceFrame(game, 1 / 3);
    const raised = game.drainEffects();
    const complete = raised.find((event) => event.system === "complete");
    expect(complete?.at).toEqual(hexCenter({ q: 0, r: 0 }));
  });

  it("raises the fault where the run halted", () => {
    const game = new Bench();
    const api = createDebugApi(() => game);
    api.openChallenge("extras", 0);
    api.placePart("wheel", 0, 0, 0);
    const wheel = game.state.editor.parts[0].id;
    api.setTapeCell(wheel, 0, "grab");
    api.startRun();
    game.drainEffects();
    advanceFrame(game, 1);
    expect(game.state.sim?.status).toBe("faulted");
    const raised = game.drainEffects();
    const fault = raised.find((event) => event.system === "fault");
    // The fault names the part, not a mote, so it plays on the part's anchor.
    expect(fault?.at).toEqual(hexCenter({ q: 0, r: 0 }));
  });
});
