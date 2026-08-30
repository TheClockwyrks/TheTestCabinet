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
    h.pose((debug, state) => debug.setCargo(state, "ferron", 3));
    h.pose((debug, state) => debug.setCargo(state, "aurite", 1));
    const worth = 3 * mineral("ferron").value + mineral("aurite").value;
    expect(cargoValue(h.state.cargo)).toBe(worth);
    h.pose((debug, state) => debug.sell(state));
    const snapshot = h.debug.snapshot(h.state);
    expect(snapshot.credits).toBe(worth);
    expect(snapshot.creditsEarned).toBe(worth);
    expect(snapshot.cargo.slotsUsed).toBe(0);
  });

  it("counts a gemstone as one slot and its own weight, exactly as an ore", () => {
    h.pose((debug, state) => debug.setCargo(state, "verdite", 2));
    expect(slotsUsed(h.state.cargo)).toBe(2);
    expect(loadKg(h.state.cargo)).toBe(2 * mineral("verdite").weightKg);
  });

  it("loses a dropped unit rather than selling it", () => {
    h.pose((debug, state) => debug.setCargo(state, "ferron", 2));
    h.pose((debug, state) => debug.dropOre(state, "ferron"));
    const snapshot = h.debug.snapshot(h.state);
    expect(snapshot.cargo.ore.ferron).toBe(1);
    expect(snapshot.credits).toBe(0);
  });
});

describe("the Fuel Depot", () => {
  it("buys FUEL_BUY_INCREMENT units at FUEL_PRICE each", () => {
    h.pose((debug, state) => debug.setCredits(state, 100));
    h.pose((debug, state) => debug.setFuel(state, 10));
    h.pose((debug, state) => debug.buyFuel(state));
    const snapshot = h.debug.snapshot(h.state);
    expect(snapshot.miner.fuel).toBe(10 + FUEL_BUY_INCREMENT);
    expect(snapshot.credits).toBe(100 - FUEL_BUY_INCREMENT * FUEL_PRICE);
  });

  it("buys nothing when the increment is unaffordable", () => {
    h.pose((debug, state) => debug.setCredits(state, 1));
    h.pose((debug, state) => debug.setFuel(state, 10));
    h.pose((debug, state) => debug.buyFuel(state));
    const snapshot = h.debug.snapshot(h.state);
    expect(snapshot.credits).toBe(1);
    expect(snapshot.miner.fuel).toBe(10);
  });

  it("fills to full, paying only for what is missing", () => {
    h.pose((debug, state) => debug.setCredits(state, 1000));
    h.pose((debug, state) => debug.setFuel(state, 40));
    const missing = FUEL_TIERS[0] - 40;
    h.pose((debug, state) => debug.fillFuel(state));
    const snapshot = h.debug.snapshot(h.state);
    expect(snapshot.miner.fuel).toBe(FUEL_TIERS[0]);
    expect(snapshot.credits).toBe(1000 - missing * FUEL_PRICE);
  });

  it("fills only as far as the Credits reach", () => {
    h.pose((debug, state) => debug.setCredits(state, 10));
    h.pose((debug, state) => debug.setFuel(state, 0));
    h.pose((debug, state) => debug.fillFuel(state));
    const snapshot = h.debug.snapshot(h.state);
    expect(snapshot.miner.fuel).toBe(10);
    expect(snapshot.credits).toBe(0);
  });

  it("repairs the increment, and to full on the same terms", () => {
    h.pose((debug, state) => debug.setCredits(state, 1000));
    h.pose((debug, state) => debug.setHull(state, 10));
    h.pose((debug, state) => debug.buyRepair(state));
    let snapshot = h.debug.snapshot(h.state);
    expect(snapshot.credits).toBe(1000 - REPAIR_BUY_INCREMENT * REPAIR_PRICE);
    const missing = HULL_TIERS[0] - snapshot.miner.hull;
    const before = snapshot.credits;
    h.pose((debug, state) => debug.repairFull(state));
    snapshot = h.debug.snapshot(h.state);
    expect(snapshot.miner.hull).toBe(HULL_TIERS[0]);
    expect(snapshot.credits).toBe(before - missing * REPAIR_PRICE);
  });
});

describe("what the depot refuses", () => {
  it("buys nothing, at either control, when the tank and the hull are full", () => {
    h.pose((debug, state) => debug.setCredits(state, 1000));
    for (const buy of [
      "buyFuel",
      "fillFuel",
      "buyRepair",
      "repairFull",
    ] as const) {
      h.pose((debug, state) => debug[buy](state));
    }
    expect(h.debug.snapshot(h.state).credits).toBe(1000);
  });

  it("repairs nothing with no Credits at all", () => {
    h.pose((debug, state) => debug.setHull(state, 10));
    h.pose((debug, state) => debug.setCredits(state, 0));
    h.pose((debug, state) => debug.repairFull(state));
    h.pose((debug, state) => debug.buyRepair(state));
    const snapshot = h.debug.snapshot(h.state);
    expect(snapshot.miner.hull).toBe(10);
    expect(snapshot.credits).toBe(0);
  });

  it("never lets the balance go below zero", () => {
    h.pose((debug, state) => debug.setCredits(state, 5));
    h.pose((debug, state) => debug.setFuel(state, 0));
    h.pose((debug, state) => debug.fillFuel(state));
    const snapshot = h.debug.snapshot(h.state);
    expect(snapshot.credits).toBe(0);
    expect(snapshot.miner.fuel).toBe(5);
  });
});

describe("the Upgrade Shop", () => {
  it("charges the shared ladder and applies the tier at once", () => {
    h.pose((debug, state) => debug.setCredits(state, UPGRADE_PRICES[0]));
    h.pose((debug, state) => debug.buyUpgrade(state, "cargo"));
    const snapshot = h.debug.snapshot(h.state);
    expect(snapshot.tiers.cargo).toBe(2);
    expect(cargoCap(h.state.tiers)).toBe(CARGO_TIERS[1]);
    expect(snapshot.credits).toBe(0);
  });

  it("refuses a track it cannot afford", () => {
    h.pose((debug, state) => debug.setCredits(state, UPGRADE_PRICES[0] - 1));
    h.pose((debug, state) => debug.buyUpgrade(state, "drill"));
    expect(h.debug.snapshot(h.state).tiers.drill).toBe(1);
  });

  it("adds the new capacity to the fuel held rather than filling the tank", () => {
    h.pose((debug, state) => debug.setCredits(state, UPGRADE_PRICES[0]));
    h.pose((debug, state) => debug.setFuel(state, 30));
    h.pose((debug, state) => debug.buyUpgrade(state, "fuel"));
    expect(maxFuel(h.state.tiers)).toBe(FUEL_TIERS[1]);
    expect(h.debug.snapshot(h.state).miner.fuel).toBe(
      30 + (FUEL_TIERS[1] - FUEL_TIERS[0]),
    );
  });

  it("adds the new capacity to the hull held in the same way", () => {
    h.pose((debug, state) => debug.setCredits(state, UPGRADE_PRICES[0]));
    h.pose((debug, state) => debug.setHull(state, 40));
    h.pose((debug, state) => debug.buyUpgrade(state, "hull"));
    expect(h.debug.snapshot(h.state).miner.hull).toBe(
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
    h.pose((debug, state) => debug.setCredits(state, 100000));
    for (let i = 0; i < 5; i += 1) {
      h.pose((debug, state) => debug.buyUpgrade(state, "scanner"));
    }
    const snapshot = h.debug.snapshot(h.state);
    expect(snapshot.tiers.scanner).toBe(3);
    // Only the two purchasable rungs were charged.
    expect(snapshot.credits).toBe(
      100000 - UPGRADE_PRICES[0] - UPGRADE_PRICES[1],
    );
  });
});
