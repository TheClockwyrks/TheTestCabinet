// The six field supplies, and jettisoning the Core Sample (specs/items.md).

import { describe, expect, it } from "vitest";
import {
  DYNAMITE_RADIUS,
  EMERGENCY_FUEL,
  ITEMS,
  MINER_H,
  MINER_W,
  NANOBOT_HULL,
  PLASTIC_EXPLOSIVES_RADIUS,
  SURFACE_Y,
  TELEPORT_HEIGHT_TILES_MAX,
  TELEPORT_HEIGHT_TILES_MIN,
  TELEPORT_SPEED_MAX,
  TELEPORT_SPEED_MIN,
  TILE,
} from "./constants";
import { maxFuel, maxHull } from "./figures";
import { buyItem, coreGround, jettisonCoreSample, useItem } from "./items";
import { writeTile } from "./state";
import type { DeepcoreState } from "./game";
import { bareState, posing, posedAt, runFrames, holding } from "./test-support";
import { ITEM_BY_ID, itemForHotkey, itemHotkey } from "./tuning";
import { colCenterX, makeOreTile, makeTile } from "./world";

/** Stand the miner on top of a cell, centered on its column. */
function standing(d: DeepcoreState, col: number, row: number): void {
  posedAt(d, colCenterX(col, MINER_W), row * TILE - MINER_H);
}

describe("buying", () => {
  it("deducts the price and increments the count", () => {
    const after = posing(bareState(), (d) => {
      d.credits = ITEM_BY_ID.dynamite.price;
      expect(buyItem(d, "dynamite")).toBe(true);
    });
    expect(after.items.dynamite).toBe(1);
    expect(after.credits).toBe(0);
  });

  it("refuses a supply it cannot afford", () => {
    const after = posing(bareState(), (d) => {
      d.credits = ITEM_BY_ID.dynamite.price - 1;
      expect(buyItem(d, "dynamite")).toBe(false);
    });
    expect(after.items.dynamite).toBe(0);
  });

  it("binds the six supplies to the number keys in order", () => {
    for (const item of ITEMS) {
      expect(itemForHotkey(itemHotkey(item.id))).toBe(item.id);
    }
    expect(itemForHotkey(7)).toBeNull();
  });
});

describe("using", () => {
  it("consumes nothing when none is held", () => {
    const after = posing(bareState(), (d) => {
      expect(useItem(d, "nanobots")).toBe(false);
    });
    expect(after.items.nanobots).toBe(0);
  });

  it("consumes nothing when the effect would change nothing", () => {
    const after = posing(bareState(), (d) => {
      d.items.nanobots = 1;
      d.items["emergency-fuel"] = 1;
      d.miner.hull = maxHull(d.tiers);
      d.miner.fuel = maxFuel(d.tiers);
      expect(useItem(d, "nanobots")).toBe(false);
      expect(useItem(d, "emergency-fuel")).toBe(false);
    });
    expect(after.items.nanobots).toBe(1);
    expect(after.items["emergency-fuel"]).toBe(1);
  });

  it("repairs NANOBOT_HULL and adds EMERGENCY_FUEL, capped at the maxima", () => {
    const after = posing(bareState(), (d) => {
      d.items.nanobots = 2;
      d.items["emergency-fuel"] = 2;
      d.miner.hull = 10;
      d.miner.fuel = 10;
      expect(useItem(d, "nanobots")).toBe(true);
      expect(d.miner.hull).toBe(10 + NANOBOT_HULL);
      expect(useItem(d, "emergency-fuel")).toBe(true);
      expect(d.miner.fuel).toBe(10 + EMERGENCY_FUEL);
      d.miner.hull = maxHull(d.tiers) - 1;
      useItem(d, "nanobots");
      expect(d.miner.hull).toBe(maxHull(d.tiers));
    });
    expect(after.items.nanobots).toBe(0);
  });

  it("clears the 3x3 and the 5x5 block, destroying the ore in it", () => {
    for (const [id, radius] of [
      ["dynamite", DYNAMITE_RADIUS],
      ["plastic-explosives", PLASTIC_EXPLOSIVES_RADIUS],
    ] as const) {
      const after = posing(bareState(), (d) => {
        d.items[id] = 1;
        standing(d, 10, 200);
        for (let r = 199 - radius; r <= 199 + radius; r += 1) {
          for (let c = 10 - radius; c <= 10 + radius; c += 1) {
            d.grid = writeTile(d.grid, c, r, makeOreTile("rockbed", "ferron"));
          }
        }
        expect(useItem(d, id)).toBe(true);
      });
      for (let r = 199 - radius; r <= 199 + radius; r += 1) {
        for (let c = 10 - radius; c <= 10 + radius; c += 1) {
          expect(after.grid[r][c].kind).toBe("tunnel");
        }
      }
      expect(after.cargo.ferron).toBe(0);
      expect(after.items[id]).toBe(0);
    }
  });

  it("drops the miner over the camp at a height and speed within their bounds", () => {
    const after = posing(bareState(), (d) => {
      d.items["quantum-teleporter"] = 1;
      standing(d, 10, 300);
      expect(useItem(d, "quantum-teleporter")).toBe(true);
    });
    const tiles = (SURFACE_Y - (after.miner.y + MINER_H)) / TILE;
    expect(tiles).toBeGreaterThanOrEqual(TELEPORT_HEIGHT_TILES_MIN);
    expect(tiles).toBeLessThanOrEqual(TELEPORT_HEIGHT_TILES_MAX);
    expect(after.miner.vy).toBeGreaterThanOrEqual(TELEPORT_SPEED_MIN);
    expect(after.miner.vy).toBeLessThanOrEqual(TELEPORT_SPEED_MAX);
    expect(after.miner.state).toBe("fall");
  });

  it("sets the miner down on the camp ground at rest", () => {
    const after = posing(bareState(), (d) => {
      d.items["matter-transmitter"] = 1;
      standing(d, 10, 300);
      d.miner.vy = 900;
      expect(useItem(d, "matter-transmitter")).toBe(true);
    });
    expect(after.miner.y + MINER_H).toBe(SURFACE_Y);
    expect(after.miner.vy).toBe(0);
  });

  it("refuses to fire outside live play", () => {
    const after = posing(bareState(), (d) => {
      d.items.dynamite = 1;
      d.screen = "paused";
      expect(useItem(d, "dynamite")).toBe(false);
    });
    expect(after.items.dynamite).toBe(1);
  });
});

describe("jettisoning the Core Sample", () => {
  it("drops it on the miner's cell and keeps the timer running", () => {
    const after = posing(bareState(), (d) => {
      posedAt(d, colCenterX(9, MINER_W), 200 * TILE - MINER_H);
      d.satchel.coreSample = true;
      d.coreTimer = 40;
      expect(jettisonCoreSample(d)).toBe(true);
    });
    expect(after.satchel.coreSample).toBe(false);
    expect(coreGround(after)).toEqual({ col: 9, row: 199 });
    expect(after.coreTimer).toBe(40);
    const run = runFrames(holding(after, {}), 1, 10);
    expect(run.state.coreTimer).toBeCloseTo(39, 5);
  });

  it("cannot be picked back up by standing over it", () => {
    const after = posing(bareState(), (d) => {
      d.grid = writeTile(d.grid, 9, 200, makeTile("rock", "rockbed"));
      standing(d, 9, 200);
      d.satchel.coreSample = true;
      d.coreTimer = 40;
      jettisonCoreSample(d);
    });
    const run = runFrames(holding(after, {}), 1, 30);
    expect(run.state.satchel.coreSample).toBe(false);
    expect(coreGround(run.state)).not.toBeNull();
  });

  it("does nothing while no Sample is carried", () => {
    const after = posing(bareState(), (d) => {
      expect(jettisonCoreSample(d)).toBe(false);
    });
    expect(coreGround(after)).toBeNull();
  });
});
