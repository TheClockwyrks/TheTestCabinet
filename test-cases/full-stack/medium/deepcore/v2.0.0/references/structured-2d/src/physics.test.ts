// How the miner moves, and what stops it (specs/character.md).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CLIMB_CAP_FLOOR,
  FALL_TERMINAL_EMPTY,
  FALL_TERMINAL_LOADED,
  GRAVITY,
  JETPACK_TIERS,
  LIFE_SUPPORT_BURN,
  MINER_H,
  MINER_W,
  TILE,
  WALK_SPEED,
} from "./constants";
import {
  climbAccel,
  climbCap,
  fallTerminal,
  loadFraction,
  mineral,
  overloaded,
} from "./figures";
import { emptyCargo, startingTiers } from "./game";
import type { Cargo } from "./game";
import {
  createHarness,
  installStorage,
  layFloor,
  openScene,
  placeAt,
  standOn,
  type Harness,
} from "./test-support";

/** A bay loaded to exactly the tier-1 lift limit, in Ferron. */
function atTheLiftLimit(): Cargo {
  const cargo = emptyCargo();
  cargo.ferron = JETPACK_TIERS[0].liftLimitKg / mineral("ferron").weightKg;
  return cargo;
}

let h: Harness;

beforeEach(async () => {
  installStorage();
  h = await createHarness();
  openScene(h);
});

afterEach(() => {
  h.dispose();
});

describe("falling", () => {
  it("accelerates at GRAVITY with open space below", async () => {
    placeAt(h, 5 * TILE, 40 * TILE);
    await h.seconds(0.5);
    expect(h.debug.snapshot().miner.vy).toBeCloseTo(GRAVITY * 0.5, 0);
  });

  it("caps an empty fall at FALL_TERMINAL_EMPTY", async () => {
    placeAt(h, 5 * TILE, 40 * TILE);
    await h.seconds(3);
    expect(h.debug.snapshot().miner.vy).toBeCloseTo(FALL_TERMINAL_EMPTY, 5);
  });

  it("raises the terminal speed with the load, to FALL_TERMINAL_LOADED at the limit", () => {
    const cargo = atTheLiftLimit();
    const tiers = startingTiers();
    expect(loadFraction(cargo, tiers)).toBeCloseTo(1, 6);
    expect(fallTerminal(cargo, tiers)).toBeCloseTo(FALL_TERMINAL_LOADED, 6);
  });

  it("costs no fuel to fall beyond what life support burns", async () => {
    placeAt(h, 5 * TILE, 40 * TILE);
    h.debug.setFuel(50);
    await h.seconds(0.2);
    expect(h.debug.snapshot().miner.fuel).toBeCloseTo(
      50 - LIFE_SUPPORT_BURN * 0.2,
      4,
    );
  });

  it("costs nothing at all above the surface, where life support is idle", async () => {
    placeAt(h, 5 * TILE, -10 * TILE);
    h.debug.setFuel(50);
    await h.seconds(0.2);
    expect(h.debug.snapshot().miner.fuel).toBe(50);
  });
});

describe("walking", () => {
  it("moves at WALK_SPEED along the ground", async () => {
    layFloor(h, 20);
    standOn(h, 5, 20);
    h.debug.setMinerDrill(false);
    h.hold("right");
    await h.seconds(1);
    h.release("right");
    expect(h.debug.snapshot().miner.vx).toBeCloseTo(WALK_SPEED, 3);
  });

  it("is stopped by a wall", async () => {
    layFloor(h, 20);
    standOn(h, 5, 20);
    h.debug.setMinerDrill(false);
    h.debug.setTile(6, 19, "stone");
    h.hold("right");
    await h.seconds(2);
    h.release("right");
    expect(h.debug.snapshot().miner.x + MINER_W).toBeLessThanOrEqual(
      6 * TILE + 0.01,
    );
  });

  it("rests on top of a solid cell", async () => {
    h.debug.setTile(5, 20, "rock");
    placeAt(h, 5 * TILE + 12, 17 * TILE);
    h.debug.setMinerDrill(false);
    await h.seconds(2);
    expect(h.debug.snapshot().miner.y + MINER_H).toBeCloseTo(20 * TILE, 0);
  });
});

describe("the jetpack", () => {
  it("climbs to the tier's empty cap while thrust is held", async () => {
    placeAt(h, 5 * TILE, 40 * TILE);
    h.debug.setFuel(100);
    h.hold("up");
    await h.seconds(3);
    h.release("up");
    expect(-h.debug.snapshot().miner.vy).toBeCloseTo(
      JETPACK_TIERS[0].emptyClimb,
      5,
    );
  });

  it("throttles the climb cap to CLIMB_CAP_FLOOR of the empty one at the limit", () => {
    expect(climbCap(atTheLiftLimit(), startingTiers())).toBeCloseTo(
      JETPACK_TIERS[0].emptyClimb * CLIMB_CAP_FLOOR,
      6,
    );
  });

  it("produces no climb at all once the load meets the lift limit", async () => {
    const tiers = startingTiers();
    expect(overloaded(atTheLiftLimit(), tiers)).toBe(true);
    expect(climbAccel(atTheLiftLimit(), tiers)).toBe(0);

    h.debug.setCargo(
      "ferron",
      JETPACK_TIERS[0].liftLimitKg / mineral("ferron").weightKg,
    );
    placeAt(h, 5 * TILE, 40 * TILE);
    h.debug.setFuel(100);
    const before = h.debug.snapshot().miner.y;
    h.hold("up");
    await h.seconds(2);
    h.release("up");
    expect(h.debug.snapshot().miner.y).toBeGreaterThanOrEqual(before);
  });

  it("arrests the fall's acceleration while overloaded rather than adding to it", async () => {
    h.debug.setCargo(
      "ferron",
      JETPACK_TIERS[0].liftLimitKg / mineral("ferron").weightKg,
    );
    placeAt(h, 5 * TILE, 40 * TILE);
    h.debug.setMinerVelocity(0, 300);
    h.debug.setFuel(100);
    h.hold("up");
    await h.seconds(1);
    h.release("up");
    expect(h.debug.snapshot().miner.vy).toBeCloseTo(300, 5);
  });

  it("climbs into the open sky above the camp, with no ceiling", async () => {
    h.debug.setFuel(100);
    h.hold("up");
    await h.seconds(2);
    h.release("up");
    expect(h.debug.snapshot().miner.y).toBeLessThan(-TILE * 4);
  });
});

describe("the travel faculty", () => {
  it("holds the body where it stands, whatever is held", async () => {
    placeAt(h, 5 * TILE, 40 * TILE);
    h.debug.setMinerVelocity(0, 120);
    h.debug.setFuel(100);
    h.debug.setMinerTravel(false);
    h.hold("right");
    h.hold("up");
    await h.seconds(2);
    h.release("right");
    h.release("up");
    const { miner } = h.debug.snapshot();
    expect(miner.x).toBe(5 * TILE);
    expect(miner.y).toBe(40 * TILE);
    expect(miner.vy).toBe(120);
  });

  it("still reads as grounded from the cells beneath its box", () => {
    h.debug.setTile(5, 20, "rock");
    standOn(h, 5, 20);
    h.debug.setMinerTravel(false);
    expect(h.debug.snapshot().miner.grounded).toBe(true);
  });
});
