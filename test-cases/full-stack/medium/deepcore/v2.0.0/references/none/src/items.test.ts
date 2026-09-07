// The six field supplies, and jettisoning the Core Sample (specs/items.md).

import { describe, expect, it } from "vitest";
import {
  DYNAMITE_RADIUS,
  EMERGENCY_FUEL,
  ITEMS,
  ITEM_BY_ID,
  MINER_H,
  MINER_W,
  NANOBOT_HULL,
  PLASTIC_RADIUS,
  QUANTUM_DROP_MAX_TILES,
  QUANTUM_DROP_MIN_TILES,
  QUANTUM_VEL_MAX,
  QUANTUM_VEL_MIN,
  SURFACE_Y,
  TILE,
} from "./constants";
import { buyItem, itemForHotkey, useItem } from "./items";
import {
  emptyGame,
  hold,
  run,
  setOreTile,
  setTile,
  standOn,
} from "./test-support";
import { colCenterX } from "./world";

describe("buying", () => {
  it("deducts the price and increments the count", () => {
    const game = emptyGame();
    game.credits = ITEM_BY_ID.dynamite.price;
    expect(buyItem(game, "dynamite")).toBe(true);
    expect(game.items.dynamite).toBe(1);
    expect(game.credits).toBe(0);
  });

  it("refuses a supply it cannot afford", () => {
    const game = emptyGame();
    game.credits = ITEM_BY_ID.dynamite.price - 1;
    expect(buyItem(game, "dynamite")).toBe(false);
    expect(game.items.dynamite).toBe(0);
  });

  it("binds the six supplies to the number keys in order", () => {
    for (const def of ITEMS) expect(itemForHotkey(def.hotkey)).toBe(def.id);
    expect(itemForHotkey(7)).toBeNull();
  });
});

describe("using", () => {
  it("consumes nothing when none is held", () => {
    const game = emptyGame();
    expect(useItem(game, "nanobots")).toBe(false);
    expect(game.items.nanobots).toBe(0);
  });

  it("consumes nothing when the effect would change nothing", () => {
    const game = emptyGame();
    game.items.nanobots = 1;
    game.items["emergency-fuel"] = 1;
    game.miner.hull = game.maxHull();
    game.miner.fuel = game.maxFuel();
    expect(useItem(game, "nanobots")).toBe(false);
    expect(useItem(game, "emergency-fuel")).toBe(false);
    expect(game.items.nanobots).toBe(1);
    expect(game.items["emergency-fuel"]).toBe(1);
  });

  it("repairs NANOBOT_HULL hull and adds EMERGENCY_FUEL fuel, capped at the maxima", () => {
    const game = emptyGame();
    game.items.nanobots = 2;
    game.items["emergency-fuel"] = 2;
    game.miner.hull = 10;
    game.miner.fuel = 10;
    expect(useItem(game, "nanobots")).toBe(true);
    expect(game.miner.hull).toBe(10 + NANOBOT_HULL);
    expect(useItem(game, "emergency-fuel")).toBe(true);
    expect(game.miner.fuel).toBe(10 + EMERGENCY_FUEL);
    game.miner.hull = game.maxHull() - 1;
    useItem(game, "nanobots");
    expect(game.miner.hull).toBe(game.maxHull());
  });

  it("clears the 3x3 and the 5x5 block, destroying the ore in it", () => {
    for (const [id, radius] of [
      ["dynamite", DYNAMITE_RADIUS],
      ["plastic-explosives", PLASTIC_RADIUS],
    ] as const) {
      const game = emptyGame();
      game.items[id] = 1;
      standOn(game, 10, 200);
      for (let r = 199 - radius; r <= 199 + radius; r++) {
        for (let c = 10 - radius; c <= 10 + radius; c++)
          setOreTile(game, c, r, "ferron");
      }
      expect(useItem(game, id)).toBe(true);
      for (let r = 199 - radius; r <= 199 + radius; r++) {
        for (let c = 10 - radius; c <= 10 + radius; c++) {
          expect(game.tileAt(c, r).kind).toBe("tunnel");
        }
      }
      expect(game.cargo.ferron).toBe(0);
      expect(game.items[id]).toBe(0);
    }
  });

  it("drops the miner over the camp at a height and speed within their bounds", () => {
    const game = emptyGame();
    game.items["quantum-teleporter"] = 1;
    standOn(game, 10, 300);
    expect(useItem(game, "quantum-teleporter")).toBe(true);
    const feet = game.miner.y + MINER_H;
    const tiles = (SURFACE_Y - feet) / TILE;
    expect(tiles).toBeGreaterThanOrEqual(QUANTUM_DROP_MIN_TILES);
    expect(tiles).toBeLessThanOrEqual(QUANTUM_DROP_MAX_TILES);
    expect(game.miner.vy).toBeGreaterThanOrEqual(QUANTUM_VEL_MIN);
    expect(game.miner.vy).toBeLessThanOrEqual(QUANTUM_VEL_MAX);
    expect(game.miner.state).toBe("fall");
  });

  it("sets the miner down on the camp ground at rest", () => {
    const game = emptyGame();
    game.items["matter-transmitter"] = 1;
    standOn(game, 10, 300);
    game.miner.vy = 900;
    expect(useItem(game, "matter-transmitter")).toBe(true);
    expect(game.miner.y + MINER_H).toBe(SURFACE_Y);
    expect(game.miner.vy).toBe(0);
    expect(game.miner.hull).toBe(game.maxHull());
  });

  it("refuses to fire outside live play", () => {
    const game = emptyGame();
    game.items.dynamite = 1;
    game.screen = "paused";
    expect(useItem(game, "dynamite")).toBe(false);
    expect(game.items.dynamite).toBe(1);
  });
});

describe("jettisoning the Core Sample", () => {
  it("drops it on the miner's cell and keeps the timer running", () => {
    const game = emptyGame();
    game.miner.x = colCenterX(9, MINER_W);
    game.miner.y = 200 * TILE - MINER_H;
    game.satchel.coreSample = true;
    game.coreTimer = 40;
    game.tryJettison();
    expect(game.satchel.coreSample).toBe(false);
    expect(game.coreGround()).toEqual({
      kind: "core-sample",
      col: 9,
      row: 199,
    });
    expect(game.coreTimer).toBe(40);
    hold(game, {});
    run(game, 1, 10);
    expect(game.coreTimer).toBeCloseTo(39, 5);
  });

  it("cannot be picked back up by standing over it", () => {
    const game = emptyGame();
    setTile(game, 9, 200, "rock");
    standOn(game, 9, 200);
    game.satchel.coreSample = true;
    game.coreTimer = 40;
    game.tryJettison();
    hold(game, {});
    run(game, 1, 30);
    expect(game.satchel.coreSample).toBe(false);
    expect(game.coreGround()).not.toBeNull();
  });

  it("does nothing while no Sample is carried", () => {
    const game = emptyGame();
    game.tryJettison();
    expect(game.coreGround()).toBeNull();
  });
});
