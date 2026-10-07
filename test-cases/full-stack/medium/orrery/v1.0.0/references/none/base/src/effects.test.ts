import { describe, expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";

import { particleSystem, spritePaths } from "./assets";
import { PARTICLE_PATHS, type ParticleSystemName } from "./constants";
import { createStateOps } from "./debug";
import { Effects, pageCanvas } from "./effects";
import { Game } from "./game";
import { hexCenter } from "./hex";

/** A canvas source backed by `@napi-rs/canvas`, so a test can play an effect. */
const scratch = () => createCanvas(1, 1) as unknown as HTMLCanvasElement;

describe("the produced particle systems (specs/assets.md)", () => {
  it("bundles all three, as documents the player can play", () => {
    for (const name of Object.keys(PARTICLE_PATHS) as ParticleSystemName[]) {
      const system = particleSystem(name) as {
        durationMs: number;
        loop: boolean;
        emitters: unknown[];
      } | null;
      expect(system).not.toBeNull();
      expect(system?.durationMs).toBeGreaterThan(0);
      // Each is authored one-shot, so it decays to empty rather than settling.
      expect(system?.loop).toBe(false);
      expect(system?.emitters.length).toBeGreaterThan(0);
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
    const effects = new Effects(scratch);
    effects.fire({ system: "deliver", at: { x: 100, y: 100 } });
    expect(effects.count).toBe(1);
    for (let frame = 0; frame < 120; frame += 1) effects.update(1 / 60);
    expect(effects.count).toBe(0);
  });

  it("composites onto the context it is handed, and clears on demand", () => {
    const effects = new Effects(scratch);
    const canvas = createCanvas(64, 64);
    const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
    effects.fire({ system: "complete", at: { x: 32, y: 32 } });
    effects.update(1 / 60);
    expect(() => effects.draw(ctx)).not.toThrow();
    effects.clear();
    expect(effects.count).toBe(0);
  });

  it("plays nothing where there is no canvas to scratch on", () => {
    const effects = new Effects(() => null);
    effects.fire({ system: "fault", at: { x: 0, y: 0 } });
    expect(effects.count).toBe(0);
    // The page's own source answers `null` under a test, where there is no DOM.
    expect(pageCanvas()).toBeNull();
  });
});

describe("what raises an effect (specs/assets.md)", () => {
  it("raises a delivery on each set that took a constellation", () => {
    const game = new Game();
    const api = createStateOps(game);
    api.openChallenge("extras", 0);
    api.placeSet(0, 2, 0, 0);
    api.startRun();
    game.drainEffects();
    api.spawnMote(2, 0, "sol");
    api.setCycle(0);
    game.update(1 / 3);
    const raised = game.drainEffects();
    expect(raised.map((event) => event.system)).toContain("deliver");
    expect(raised[0].at).toEqual(hexCenter({ q: 2, r: 0 }));
  });

  it("raises the completion over the middle of the field", () => {
    const game = new Game();
    const api = createStateOps(game);
    api.openChallenge("extras", 0);
    api.placeSet(0, 2, 0, 0);
    api.startRun();
    api.setTally(0, 6);
    game.drainEffects();
    game.update(1 / 3);
    const raised = game.drainEffects();
    const complete = raised.find((event) => event.system === "complete");
    expect(complete?.at).toEqual(hexCenter({ q: 0, r: 0 }));
  });

  it("raises the fault where the run halted", () => {
    const game = new Game();
    const api = createStateOps(game);
    api.openChallenge("extras", 0);
    api.placePart("wheel", 0, 0, 0);
    const wheel = game.state.editor.parts[0].id;
    api.setTapeCell(wheel, 0, "grab");
    api.startRun();
    game.drainEffects();
    game.update(1);
    expect(game.state.sim?.status).toBe("faulted");
    const raised = game.drainEffects();
    const fault = raised.find((event) => event.system === "fault");
    // The fault names the part, not a mote, so it plays on the part's anchor.
    expect(fault?.at).toEqual(hexCenter({ q: 0, r: 0 }));
  });

  it("keeps the queue bounded when nothing ever drains it", () => {
    const game = new Game();
    for (let raised = 0; raised < 40; raised += 1) {
      game.effect("deliver", { x: raised, y: 0 });
    }
    expect(game.drainEffects().length).toBeLessThanOrEqual(16);
  });
});
