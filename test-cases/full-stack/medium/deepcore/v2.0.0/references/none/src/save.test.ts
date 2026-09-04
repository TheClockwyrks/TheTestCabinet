// The single-slot expedition save (specs/gameplay.md, specs/modes.md).
//
// The slot lives in the browser's storage, so these run against a stand-in that
// behaves like it, plus one that is not there at all, because the game has to run
// correctly without it.

import { afterEach, describe, expect, it, vi } from "vitest";
import { CORE_TIMER, MINER_H, SURFACE_Y, TILE } from "./constants";
import { Game } from "./game";
import { clearSave, hasSave } from "./save";
import { emptyGame, hold, run, setTile, standOn } from "./test-support";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A game at the camp with a slot to write into. */
function saveable(): Game {
  vi.stubGlobal("localStorage", memoryStorage());
  const game = emptyGame();
  game.miner.y = SURFACE_Y - MINER_H;
  game.miner.x = 4 * TILE;
  return game;
}

describe("the Save Pad", () => {
  it("writes the slot at the camp and restores it exactly", () => {
    const game = saveable();
    game.credits = 4200;
    game.tiers.drill = 3;
    game.cargo.argenite = 4;
    game.satchel.resonite = 1;
    game.items.dynamite = 2;
    game.installed = new Set(["hull-frame"]);
    game.miner.fuel = 61;
    game.miner.hull = 42;
    expect(game.trySave()).toBe(true);
    expect(hasSave()).toBe(true);

    const restored = new Game();
    expect(restored.loadExpedition()).toBe(true);
    expect(restored.credits).toBe(4200);
    expect(restored.tiers.drill).toBe(3);
    expect(restored.cargo.argenite).toBe(4);
    expect(restored.satchel.resonite).toBe(1);
    expect(restored.items.dynamite).toBe(2);
    expect([...restored.installed]).toEqual(["hull-frame"]);
    expect(restored.miner.fuel).toBe(61);
    expect(restored.miner.hull).toBe(42);
    expect(restored.screen).toBe("in-mine");
    // A restore places the miner back on the surface.
    expect(restored.miner.y + MINER_H).toBe(SURFACE_Y);
    // A live Core Sample is never persisted.
    expect(restored.satchel.coreSample).toBe(false);
    expect(restored.coreTimer).toBeNull();
  });

  it("refuses to save away from the camp", () => {
    const game = saveable();
    setTile(game, 5, 200, "rock");
    standOn(game, 5, 200);
    expect(game.trySave()).toBe(false);
    expect(hasSave()).toBe(false);
  });

  it("refuses to save while a Core Sample's timer runs, carried or on the ground", () => {
    const carried = saveable();
    carried.satchel.coreSample = true;
    carried.coreTimer = CORE_TIMER;
    expect(carried.canSave()).toBe(false);
    expect(carried.trySave()).toBe(false);

    const ground = saveable();
    ground.groundItems.push({ kind: "core-sample", col: 4, row: 10 });
    ground.coreTimer = CORE_TIMER;
    expect(ground.canSave()).toBe(false);
  });

  it("is overwritten by the next save, and abandoned by a new expedition", () => {
    const game = saveable();
    game.credits = 100;
    game.trySave();
    game.credits = 900;
    game.trySave();
    const restored = new Game();
    restored.loadExpedition();
    expect(restored.credits).toBe(900);
    restored.newExpedition("standard", "quick");
    expect(hasSave()).toBe(false);
  });
});

describe("what a death costs", () => {
  it("keeps the save in Standard, so the expedition can be restored", () => {
    const game = saveable();
    game.credits = 500;
    game.trySave();
    game.mode = "standard";
    setTile(game, 5, 200, "rock");
    standOn(game, 5, 200);
    game.miner.hull = 0;
    hold(game, {});
    run(game, 2, 60);
    expect(game.screen).toBe("game-over");
    expect(hasSave()).toBe(true);
  });

  it("deletes the save in Hardcore", () => {
    const game = saveable();
    game.credits = 500;
    game.trySave();
    game.mode = "hardcore";
    setTile(game, 5, 200, "rock");
    standOn(game, 5, 200);
    game.miner.hull = 0;
    hold(game, {});
    run(game, 2, 60);
    expect(game.screen).toBe("game-over");
    expect(hasSave()).toBe(false);
  });

  it("consumes the save on a victory", () => {
    const game = saveable();
    game.trySave();
    game.installed = new Set([
      "hull-frame",
      "fuel-cells",
      "guidance",
      "thruster",
      "ignition",
    ]);
    game.startLaunch();
    hold(game, {});
    run(game, 4, 60);
    expect(game.screen).toBe("victory");
    expect(hasSave()).toBe(false);
  });
});

describe("with no storage at all", () => {
  it("runs correctly, simply without saving", () => {
    vi.stubGlobal("localStorage", undefined);
    const game = emptyGame();
    game.miner.y = SURFACE_Y - MINER_H;
    expect(hasSave()).toBe(false);
    expect(game.trySave()).toBe(false);
    expect(game.loadExpedition()).toBe(false);
    expect(() => clearSave()).not.toThrow();
    hold(game, {});
    run(game, 1, 30);
    expect(game.screen).toBe("in-mine");
  });
});
