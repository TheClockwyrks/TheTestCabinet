// What the haul costs the climb home (specs/character.md, specs/mining.md).
//
// The bay caps ore by SLOT COUNT and the jetpack is throttled by its WEIGHT, and
// the two are deliberately different limits: a bay of light ore fills its slots
// long before it stops flying, and a bay of heavy ore stops flying long before it
// fills.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CARGO_TIERS, JETPACK_TIERS, MINER_W, TILE } from "./constants";
import {
  cargoCap,
  climbAccel,
  climbCap,
  loadFraction,
  loadKg,
  mineral,
  overloaded,
  slotsUsed,
} from "./figures";
import { emptyCargo, startingTiers } from "./game";
import type { Cargo } from "./game";
import {
  createHarness,
  installStorage,
  openScene,
  placeAt,
  type Harness,
} from "./test-support";

/** A bay holding `count` units of one mineral. */
function bayOf(id: Parameters<typeof mineral>[0], count: number): Cargo {
  const cargo = emptyCargo();
  cargo[id] = count;
  return cargo;
}

/** The units of Ferron that sit exactly at the first jetpack tier's lift limit. */
const AT_THE_LIMIT = JETPACK_TIERS[0].liftLimitKg / mineral("ferron").weightKg;

let h: Harness;

beforeEach(async () => {
  installStorage();
  h = await createHarness();
  openScene(h);
});

afterEach(() => {
  h.dispose();
});

describe("the bay's two limits", () => {
  it("counts one slot per unit whatever the unit weighs", () => {
    expect(slotsUsed(bayOf("ferron", 4))).toBe(4);
    expect(slotsUsed(bayOf("aurite", 4))).toBe(4);
    expect(loadKg(bayOf("ferron", 4))).toBe(4 * mineral("ferron").weightKg);
    expect(loadKg(bayOf("aurite", 4))).toBe(4 * mineral("aurite").weightKg);
  });

  it("takes the slot cap from the cargo tier", () => {
    const tiers = startingTiers();
    expect(cargoCap(tiers)).toBe(CARGO_TIERS[0]);
    expect(cargoCap({ ...tiers, cargo: 5 })).toBe(CARGO_TIERS[4]);
  });

  it("reads the load as a fraction of the jetpack tier's lift limit", () => {
    const tiers = startingTiers();
    expect(loadFraction(bayOf("ferron", AT_THE_LIMIT / 2), tiers)).toBeCloseTo(
      0.5,
      6,
    );
    expect(loadFraction(bayOf("ferron", AT_THE_LIMIT), tiers)).toBeCloseTo(
      1,
      6,
    );
  });
});

describe("the overload flag", () => {
  it("turns over exactly at the limit, not before it", () => {
    const tiers = startingTiers();
    expect(overloaded(bayOf("ferron", AT_THE_LIMIT - 1), tiers)).toBe(false);
    expect(overloaded(bayOf("ferron", AT_THE_LIMIT), tiers)).toBe(true);
  });

  it("is what the snapshot reports", () => {
    h.debug.setCargo("ferron", AT_THE_LIMIT - 1);
    expect(h.debug.snapshot().miner.overloaded).toBe(false);
    h.debug.setCargo("ferron", AT_THE_LIMIT);
    const snapshot = h.debug.snapshot();
    expect(snapshot.miner.overloaded).toBe(true);
    expect(snapshot.cargo.loadKg).toBe(JETPACK_TIERS[0].liftLimitKg);
    expect(snapshot.cargo.liftLimitKg).toBe(JETPACK_TIERS[0].liftLimitKg);
  });
});

describe("what the load does to the climb", () => {
  it("scales the climb's acceleration down to nothing at the limit", () => {
    const tiers = startingTiers();
    expect(climbAccel(emptyCargo(), tiers)).toBe(JETPACK_TIERS[0].emptyAccel);
    expect(climbAccel(bayOf("ferron", AT_THE_LIMIT / 2), tiers)).toBeCloseTo(
      JETPACK_TIERS[0].emptyAccel / 2,
      6,
    );
    expect(climbAccel(bayOf("ferron", AT_THE_LIMIT), tiers)).toBe(0);
  });

  it("scales the climb's cap down with the load, and no further past the limit", () => {
    const tiers = startingTiers();
    const atLimit = climbCap(bayOf("ferron", AT_THE_LIMIT), tiers);
    const past = climbCap(bayOf("ferron", AT_THE_LIMIT * 2), tiers);
    expect(climbCap(emptyCargo(), tiers)).toBe(JETPACK_TIERS[0].emptyClimb);
    expect(atLimit).toBeLessThan(JETPACK_TIERS[0].emptyClimb);
    expect(past).toBeCloseTo(atLimit, 6);
  });

  it("lets a dropped unit lift what the full bay could not", async () => {
    h.debug.setCargo("ferron", AT_THE_LIMIT);
    placeAt(h, 8 * TILE, 200 * TILE);
    h.debug.setFuel(100);
    h.hold("up");
    await h.seconds(1);
    h.release("up");
    // At the limit the jetpack cannot climb: the miner is no higher than it was.
    expect(h.debug.snapshot().miner.y).toBeGreaterThanOrEqual(200 * TILE);

    h.debug.dropOre("ferron");
    expect(h.debug.snapshot().miner.overloaded).toBe(false);
    placeAt(h, 8 * TILE, 200 * TILE);
    h.hold("up");
    await h.seconds(1);
    h.release("up");
    expect(h.debug.snapshot().miner.y).toBeLessThan(200 * TILE);
  });

  it("loses a dropped unit rather than banking it", () => {
    h.debug.setCargo("ferron", 3);
    h.debug.dropOre("ferron");
    const snapshot = h.debug.snapshot();
    expect(snapshot.cargo.ore.ferron).toBe(2);
    expect(snapshot.credits).toBe(0);
    expect(snapshot.creditsEarned).toBe(0);
  });
});

describe("the miner's box", () => {
  it("fits a one-tile shaft, so a bore is one cell wide", () => {
    expect(MINER_W).toBeLessThan(TILE);
  });
});
