// How the miner moves, and what stops it (specs/character.md).

import { describe, expect, it } from "vitest";
import {
  CLIMB_CAP_FLOOR,
  FALL_TERMINAL_EMPTY,
  FALL_TERMINAL_LOADED,
  GRAVITY,
  JETPACK_EMPTY_CLIMB,
  JETPACK_LIFT_LIMIT,
  LIFE_SUPPORT_BURN,
  MINER_H,
  MINER_W,
  ORES,
  TILE,
  WALK_SPEED,
} from "./constants";
import {
  emptyGame,
  hold,
  placeAt,
  run,
  setTile,
  standOn,
} from "./test-support";

describe("falling", () => {
  it("accelerates at GRAVITY with open space below", () => {
    const game = emptyGame();
    placeAt(game, 5 * TILE, 40 * TILE);
    hold(game, {});
    run(game, 0.5, 30);
    expect(game.miner.vy).toBeCloseTo(GRAVITY * 0.5, 0);
  });

  it("caps an empty fall at FALL_TERMINAL_EMPTY", () => {
    const game = emptyGame();
    placeAt(game, 5 * TILE, 40 * TILE);
    hold(game, {});
    run(game, 3, 180);
    expect(game.miner.vy).toBeCloseTo(FALL_TERMINAL_EMPTY, 5);
  });

  it("raises the terminal speed with the load, to FALL_TERMINAL_LOADED at the limit", () => {
    const game = emptyGame();
    // Enough Ferron to sit exactly at the tier-1 lift limit.
    game.cargo.ferron = JETPACK_LIFT_LIMIT[0]! / ORES.ferron.weightKg;
    expect(game.loadFraction()).toBeCloseTo(1, 6);
    expect(game.fallTerminal()).toBeCloseTo(FALL_TERMINAL_LOADED, 6);
  });

  it("costs no fuel to fall beyond what life support burns", () => {
    const game = emptyGame();
    placeAt(game, 5 * TILE, 40 * TILE);
    game.miner.fuel = 50;
    hold(game, {});
    run(game, 0.2, 12);
    expect(game.miner.fuel).toBeCloseTo(50 - LIFE_SUPPORT_BURN * 0.2, 6);
  });

  it("costs nothing at all to fall above the surface, where life support is idle", () => {
    const game = emptyGame();
    placeAt(game, 5 * TILE, -10 * TILE);
    game.miner.fuel = 50;
    hold(game, {});
    run(game, 0.2, 12);
    expect(game.miner.fuel).toBe(50);
  });
});

describe("walking", () => {
  it("moves at WALK_SPEED along the ground", () => {
    const game = emptyGame();
    standOn(game, 5, 20);
    setTile(game, 5, 20, "rock");
    hold(game, { right: true });
    run(game, 1, 60);
    // A short acceleration ramp comes off the distance a whole second would cover.
    expect(game.miner.vx).toBeCloseTo(WALK_SPEED, 3);
  });

  it("is stopped by a wall", () => {
    const game = emptyGame();
    standOn(game, 5, 20);
    setTile(game, 5, 20, "rock");
    setTile(game, 6, 19, "stone");
    hold(game, { right: true });
    run(game, 2, 120);
    expect(game.miner.x + MINER_W).toBeLessThanOrEqual(6 * TILE + 0.01);
  });

  it("rests on top of a solid cell", () => {
    const game = emptyGame();
    setTile(game, 5, 20, "rock");
    placeAt(game, 5 * TILE + 12, 17 * TILE);
    hold(game, {});
    run(game, 2, 120);
    expect(game.miner.y + MINER_H).toBeCloseTo(20 * TILE, 0);
  });
});

describe("the jetpack", () => {
  it("climbs to the tier's empty cap while thrust is held", () => {
    const game = emptyGame();
    placeAt(game, 5 * TILE, 40 * TILE);
    game.miner.fuel = 500;
    hold(game, { thrust: true });
    run(game, 3, 180);
    expect(-game.miner.vy).toBeCloseTo(JETPACK_EMPTY_CLIMB[0]!, 5);
  });

  it("throttles the climb cap to CLIMB_CAP_FLOOR of the empty one at the lift limit", () => {
    const game = emptyGame();
    game.cargo.ferron = JETPACK_LIFT_LIMIT[0]! / ORES.ferron.weightKg;
    expect(game.climbCap()).toBeCloseTo(
      JETPACK_EMPTY_CLIMB[0]! * CLIMB_CAP_FLOOR,
      6,
    );
  });

  it("produces no climb at all once the load meets the lift limit", () => {
    const game = emptyGame();
    game.cargo.ferron = JETPACK_LIFT_LIMIT[0]! / ORES.ferron.weightKg;
    expect(game.overloaded()).toBe(true);
    expect(game.climbAccel()).toBe(0);
    placeAt(game, 5 * TILE, 40 * TILE);
    game.miner.fuel = 500;
    const y0 = game.miner.y;
    hold(game, { thrust: true });
    run(game, 2, 120);
    expect(game.miner.y).toBeGreaterThanOrEqual(y0);
  });

  it("arrests the fall's acceleration while overloaded rather than adding to it", () => {
    const game = emptyGame();
    game.cargo.ferron = JETPACK_LIFT_LIMIT[0]! / ORES.ferron.weightKg;
    placeAt(game, 5 * TILE, 40 * TILE);
    game.miner.fuel = 500;
    game.miner.vy = 300;
    hold(game, { thrust: true });
    run(game, 1, 60);
    expect(game.miner.vy).toBeCloseTo(300, 5);
  });

  it("climbs into the open sky above the camp with no ceiling", () => {
    const game = emptyGame();
    game.miner.fuel = 500;
    hold(game, { thrust: true });
    run(game, 2, 120);
    expect(game.miner.y).toBeLessThan(-TILE * 4);
  });
});

describe("the travel faculty", () => {
  it("holds the body where it stands, whatever is held", () => {
    const game = emptyGame();
    placeAt(game, 5 * TILE, 40 * TILE);
    game.miner.travel = false;
    game.miner.vy = 120;
    game.miner.fuel = 500;
    hold(game, { right: true, thrust: true });
    run(game, 2, 120);
    expect(game.miner.x).toBe(5 * TILE);
    expect(game.miner.y).toBe(40 * TILE);
    expect(game.miner.vy).toBe(120);
  });

  it("still reads as grounded from the cells beneath its box", () => {
    const game = emptyGame();
    setTile(game, 5, 20, "rock");
    standOn(game, 5, 20);
    game.miner.travel = false;
    expect(game.snapshot().miner.grounded).toBe(true);
  });
});
