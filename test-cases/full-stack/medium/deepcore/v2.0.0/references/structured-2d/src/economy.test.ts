// Selling, the Fuel Depot, and the upgrade tracks (specs/gameplay.md,
// specs/upgrades.md).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CARGO_TIERS,
  FUEL_BUY_INCREMENT,
  FUEL_PRICE,
  FUEL_TIERS,
  HULL_TIERS,
  MAX_TIER,
  REPAIR_BUY_INCREMENT,
  REPAIR_PRICE,
  UPGRADE_PRICES,
} from "./constants";
import {
  cargoCap,
  cargoValue,
  loadKg,
  maxFuel,
  mineral,
  slotsUsed,
} from "./figures";
import {
  createHarness,
  installStorage,
  openScene,
  type Harness,
} from "./test-support";

let h: Harness;

beforeEach(async () => {
  installStorage();
  h = await createHarness();
  openScene(h);
});

afterEach(() => {
  h.dispose();
});

describe("selling", () => {
  it("pays each mineral's value and empties the bay", () => {
    h.debug.setCargo("ferron", 3);
    h.debug.setCargo("aurite", 1);
    const worth = 3 * mineral("ferron").value + mineral("aurite").value;
    expect(cargoValue(h.state.cargo)).toBe(worth);
    h.debug.sell();
    const snapshot = h.debug.snapshot();
    expect(snapshot.credits).toBe(worth);
    expect(snapshot.creditsEarned).toBe(worth);
    expect(snapshot.cargo.slotsUsed).toBe(0);
  });

  it("counts a gemstone as one slot and its own weight, exactly as an ore", () => {
    h.debug.setCargo("verdite", 2);
    expect(slotsUsed(h.state.cargo)).toBe(2);
    expect(loadKg(h.state.cargo)).toBe(2 * mineral("verdite").weightKg);
  });

  it("loses a dropped unit rather than selling it", () => {
    h.debug.setCargo("ferron", 2);
    h.debug.dropOre("ferron");
    const snapshot = h.debug.snapshot();
    expect(snapshot.cargo.ore.ferron).toBe(1);
    expect(snapshot.credits).toBe(0);
  });
});

describe("the Fuel Depot", () => {
  it("buys FUEL_BUY_INCREMENT units at FUEL_PRICE each", () => {
    h.debug.setCredits(100);
    h.debug.setFuel(10);
    h.debug.buyFuel();
    const snapshot = h.debug.snapshot();
    expect(snapshot.miner.fuel).toBe(10 + FUEL_BUY_INCREMENT);
    expect(snapshot.credits).toBe(100 - FUEL_BUY_INCREMENT * FUEL_PRICE);
  });

  it("buys nothing when the increment is unaffordable", () => {
    h.debug.setCredits(1);
    h.debug.setFuel(10);
    h.debug.buyFuel();
    const snapshot = h.debug.snapshot();
    expect(snapshot.credits).toBe(1);
    expect(snapshot.miner.fuel).toBe(10);
  });

  it("fills to full, paying only for what is missing", () => {
    h.debug.setCredits(1000);
    h.debug.setFuel(40);
    const missing = FUEL_TIERS[0] - 40;
    h.debug.fillFuel();
    const snapshot = h.debug.snapshot();
    expect(snapshot.miner.fuel).toBe(FUEL_TIERS[0]);
    expect(snapshot.credits).toBe(1000 - missing * FUEL_PRICE);
  });

  it("fills only as far as the Credits reach", () => {
    h.debug.setCredits(10);
    h.debug.setFuel(0);
    h.debug.fillFuel();
    const snapshot = h.debug.snapshot();
    expect(snapshot.miner.fuel).toBe(10);
    expect(snapshot.credits).toBe(0);
  });

  it("repairs the increment, and to full on the same terms", () => {
    h.debug.setCredits(1000);
    h.debug.setHull(10);
    h.debug.buyRepair();
    let snapshot = h.debug.snapshot();
    expect(snapshot.credits).toBe(1000 - REPAIR_BUY_INCREMENT * REPAIR_PRICE);
    const missing = HULL_TIERS[0] - snapshot.miner.hull;
    const before = snapshot.credits;
    h.debug.repairFull();
    snapshot = h.debug.snapshot();
    expect(snapshot.miner.hull).toBe(HULL_TIERS[0]);
    expect(snapshot.credits).toBe(before - missing * REPAIR_PRICE);
  });
});

describe("what the depot refuses", () => {
  it("buys nothing, at either control, when the tank and the hull are full", () => {
    h.debug.setCredits(1000);
    for (const buy of [
      "buyFuel",
      "fillFuel",
      "buyRepair",
      "repairFull",
    ] as const) {
      h.debug[buy]();
    }
    expect(h.debug.snapshot().credits).toBe(1000);
  });

  it("repairs nothing with no Credits at all", () => {
    h.debug.setHull(10);
    h.debug.setCredits(0);
    h.debug.repairFull();
    h.debug.buyRepair();
    const snapshot = h.debug.snapshot();
    expect(snapshot.miner.hull).toBe(10);
    expect(snapshot.credits).toBe(0);
  });

  it("never lets the balance go below zero", () => {
    h.debug.setCredits(5);
    h.debug.setFuel(0);
    h.debug.fillFuel();
    const snapshot = h.debug.snapshot();
    expect(snapshot.credits).toBe(0);
    expect(snapshot.miner.fuel).toBe(5);
  });
});

describe("the Upgrade Shop", () => {
  it("charges the shared ladder and applies the tier at once", () => {
    h.debug.setCredits(UPGRADE_PRICES[0]);
    h.debug.buyUpgrade("cargo");
    const snapshot = h.debug.snapshot();
    expect(snapshot.tiers.cargo).toBe(2);
    expect(cargoCap(h.state.tiers)).toBe(CARGO_TIERS[1]);
    expect(snapshot.credits).toBe(0);
  });

  it("refuses a track it cannot afford", () => {
    h.debug.setCredits(UPGRADE_PRICES[0] - 1);
    h.debug.buyUpgrade("drill");
    expect(h.debug.snapshot().tiers.drill).toBe(1);
  });

  it("adds the new capacity to the fuel held rather than filling the tank", () => {
    h.debug.setCredits(UPGRADE_PRICES[0]);
    h.debug.setFuel(30);
    h.debug.buyUpgrade("fuel");
    expect(maxFuel(h.state.tiers)).toBe(FUEL_TIERS[1]);
    expect(h.debug.snapshot().miner.fuel).toBe(
      30 + (FUEL_TIERS[1] - FUEL_TIERS[0]),
    );
  });

  it("adds the new capacity to the hull held in the same way", () => {
    h.debug.setCredits(UPGRADE_PRICES[0]);
    h.debug.setHull(40);
    h.debug.buyUpgrade("hull");
    expect(h.debug.snapshot().miner.hull).toBe(
      40 + (HULL_TIERS[1] - HULL_TIERS[0]),
    );
  });

  it("stops the scanner at its third tier and the rest at their fifth", () => {
    expect(MAX_TIER.scanner).toBe(3);
    for (const track of [
      "fuel",
      "drill",
      "cargo",
      "hull",
      "jetpack",
      "radiator",
    ] as const) {
      expect(MAX_TIER[track]).toBe(5);
    }
    h.debug.setCredits(100000);
    for (let i = 0; i < 5; i += 1) {
      h.debug.buyUpgrade("scanner");
    }
    const snapshot = h.debug.snapshot();
    expect(snapshot.tiers.scanner).toBe(3);
    // Only the two purchasable rungs were charged.
    expect(snapshot.credits).toBe(
      100000 - UPGRADE_PRICES[0] - UPGRADE_PRICES[1],
    );
  });
});
