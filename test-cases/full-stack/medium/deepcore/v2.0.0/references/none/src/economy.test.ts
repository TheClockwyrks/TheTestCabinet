// Selling, the Fuel Depot, and the upgrade tracks (specs/gameplay.md, specs/upgrades.md).

import { describe, expect, it } from "vitest";
import {
  CARGO_CAPACITY,
  FUEL_BUY_INCREMENT,
  FUEL_PRICE,
  FUEL_TANK_MAX,
  HULL_MAX,
  ORES,
  REPAIR_BUY_INCREMENT,
  REPAIR_PRICE,
  UPGRADE_PRICES,
  maxTierFor,
} from "./constants";
import {
  buyFuel,
  buyRepair,
  buyUpgrade,
  cargoValue,
  dropOre,
  fillFuel,
  repairFull,
  sellCargo,
} from "./economy";
import { emptyGame } from "./test-support";

describe("selling", () => {
  it("pays each ore's value and empties the bay", () => {
    const game = emptyGame();
    game.cargo.ferron = 3;
    game.cargo.aurite = 1;
    const worth = 3 * ORES.ferron.value + ORES.aurite.value;
    expect(cargoValue(game.cargo)).toBe(worth);
    expect(sellCargo(game)).toBe(worth);
    expect(game.credits).toBe(worth);
    expect(game.creditsEarned).toBe(worth);
    expect(game.slotsUsed()).toBe(0);
  });

  it("counts a gemstone as one slot and its own weight, exactly as an ore", () => {
    const game = emptyGame();
    game.cargo.verdite = 2;
    expect(game.slotsUsed()).toBe(2);
    expect(game.loadKg()).toBe(2 * ORES.verdite.weightKg);
  });

  it("loses a dropped unit rather than selling it", () => {
    const game = emptyGame();
    game.cargo.ferron = 2;
    expect(dropOre(game, "ferron")).toBe(true);
    expect(game.cargo.ferron).toBe(1);
    expect(game.credits).toBe(0);
    game.cargo.ferron = 0;
    expect(dropOre(game, "ferron")).toBe(false);
  });
});

describe("the Fuel Depot", () => {
  it("buys FUEL_BUY_INCREMENT units at FUEL_PRICE each", () => {
    const game = emptyGame();
    game.credits = 100;
    game.miner.fuel = 10;
    expect(buyFuel(game)).toBe(FUEL_BUY_INCREMENT);
    expect(game.miner.fuel).toBe(10 + FUEL_BUY_INCREMENT);
    expect(game.credits).toBe(100 - FUEL_BUY_INCREMENT * FUEL_PRICE);
  });

  it("buys nothing when the increment is unaffordable", () => {
    const game = emptyGame();
    game.credits = 1;
    game.miner.fuel = 10;
    expect(buyFuel(game)).toBe(0);
    expect(game.credits).toBe(1);
    expect(game.miner.fuel).toBe(10);
  });

  it("fills to full, paying only for what is missing", () => {
    const game = emptyGame();
    game.credits = 1000;
    game.miner.fuel = 40;
    const missing = FUEL_TANK_MAX[0]! - 40;
    expect(fillFuel(game)).toBe(missing);
    expect(game.miner.fuel).toBe(FUEL_TANK_MAX[0]!);
    expect(game.credits).toBe(1000 - missing * FUEL_PRICE);
  });

  it("fills only as far as the Credits reach", () => {
    const game = emptyGame();
    game.credits = 10;
    game.miner.fuel = 0;
    expect(fillFuel(game)).toBe(10);
    expect(game.miner.fuel).toBe(10);
    expect(game.credits).toBe(0);
  });

  it("repairs the increment at REPAIR_PRICE per point, and to full on the same terms", () => {
    const game = emptyGame();
    game.credits = 1000;
    game.miner.hull = 10;
    expect(buyRepair(game)).toBe(REPAIR_BUY_INCREMENT);
    expect(game.credits).toBe(1000 - REPAIR_BUY_INCREMENT * REPAIR_PRICE);
    const missing = HULL_MAX[0]! - game.miner.hull;
    const before = game.credits;
    expect(repairFull(game)).toBe(missing);
    expect(game.miner.hull).toBe(HULL_MAX[0]!);
    expect(game.credits).toBe(before - missing * REPAIR_PRICE);
  });
});

describe("the Upgrade Shop", () => {
  it("charges the shared ladder and applies the tier at once", () => {
    const game = emptyGame();
    game.credits = UPGRADE_PRICES[1]!;
    expect(buyUpgrade(game, "cargo")).toBe(true);
    expect(game.tiers.cargo).toBe(2);
    expect(game.cargoCap()).toBe(CARGO_CAPACITY[1]!);
    expect(game.credits).toBe(0);
  });

  it("refuses a track it cannot afford", () => {
    const game = emptyGame();
    game.credits = UPGRADE_PRICES[1]! - 1;
    expect(buyUpgrade(game, "drill")).toBe(false);
    expect(game.tiers.drill).toBe(1);
  });

  it("adds the new capacity to the fuel held rather than filling the tank", () => {
    const game = emptyGame();
    game.credits = UPGRADE_PRICES[1]!;
    game.miner.fuel = 30;
    buyUpgrade(game, "fuel");
    expect(game.maxFuel()).toBe(FUEL_TANK_MAX[1]!);
    expect(game.miner.fuel).toBe(30 + (FUEL_TANK_MAX[1]! - FUEL_TANK_MAX[0]!));
  });

  it("adds the new capacity to the hull held in the same way", () => {
    const game = emptyGame();
    game.credits = UPGRADE_PRICES[1]!;
    game.miner.hull = 40;
    buyUpgrade(game, "hull");
    expect(game.miner.hull).toBe(40 + (HULL_MAX[1]! - HULL_MAX[0]!));
  });

  it("stops the scanner at its third tier and the rest at their fifth", () => {
    expect(maxTierFor("scanner")).toBe(3);
    for (const track of [
      "fuel",
      "drill",
      "cargo",
      "hull",
      "jetpack",
      "radiator",
    ] as const) {
      expect(maxTierFor(track)).toBe(5);
    }
    const game = emptyGame();
    game.credits = 100000;
    for (let i = 0; i < 5; i++) buyUpgrade(game, "scanner");
    expect(game.tiers.scanner).toBe(3);
    // Only the two purchasable rungs were charged.
    expect(game.credits).toBe(100000 - UPGRADE_PRICES[1]! - UPGRADE_PRICES[2]!);
  });
});
