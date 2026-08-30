// The route metric of specs/mazing.md, measured against the floor directly.
//
// Every figure here is computed from the step rule rather than read off a
// reference: an orthogonal step costs 1 tile and a diagonal sqrt(2), a diagonal
// needs both of the tiles it cuts past open, and a route runs from a tile to
// any open opening tile of an exhaust.

import { describe, expect, it } from "vitest";
import { COLS, ROWS, TILE, tileCX, tileCY } from "./constants";
import { tileIndex } from "./geometry";
import {
  blockedOf,
  nextStep,
  routesFromBlocked,
  routesOf,
  stepAllowed,
} from "./routes";
import { remainingOf } from "./surge";
import type { TowerState } from "./game";

function tower(
  id: number,
  type: TowerState["type"],
  col: number,
  row: number,
): TowerState {
  return {
    id,
    type,
    col,
    row,
    rotation: 0,
    level: 1,
    heat: 0,
    tripped: false,
    tripTimer: 0,
    fireClock: 0,
    targeting: null,
    firing: false,
    kills: 0,
    damageDealt: 0,
    spent: 0,
    fresh: true,
    firingEnabled: true,
    thermalEnabled: true,
  };
}

describe("the open floor", () => {
  it("routes each vent straight across to its opposite exhaust", () => {
    const routes = routesOf([]);
    expect(routes.leftLength).toBeCloseTo(COLS - 1, 9);
    expect(routes.topLength).toBeCloseTo(ROWS - 1, 9);
  });

  it("measures a diagonal at sqrt(2) and an orthogonal step at 1", () => {
    const routes = routesOf([]);
    // The right exhaust spans rows 16..19, so a tile one row off the run needs
    // one diagonal step and then the straight run in.
    const straight = routes.right[tileIndex(40, 17)];
    const offset = routes.right[tileIndex(40, 15)];
    expect(straight).toBeCloseTo(9, 9);
    expect(offset).toBeCloseTo(Math.SQRT2 + 8, 9);
  });
});

describe("towers are walls", () => {
  it("lengthens a route when one is dropped across the corridor", () => {
    const open = routesOf([]);
    const walled = routesOf([tower(1, "arc", 24, 16), tower(2, "arc", 24, 18)]);
    expect(walled.leftLength).toBeGreaterThan(open.leftLength);
  });

  it("returns the route to its open length when the wall is removed", () => {
    const open = routesOf([]);
    const walled = routesOf([tower(1, "arc", 24, 16)]);
    void walled;
    expect(routesOf([]).leftLength).toBeCloseTo(open.leftLength, 9);
  });

  it("refuses a diagonal between two diagonally touching towers", () => {
    const blocked = blockedOf([
      tower(1, "arc", 10, 10),
      tower(2, "arc", 12, 12),
    ]);
    // (11, 11) is the corner of the first; the step to (12, 12) cuts past
    // (12, 11) and (11, 12), which the two towers hold.
    expect(stepAllowed(blocked, 11, 11, 1, 1)).toBe(false);
    // With nothing there at all the same step is legal.
    expect(stepAllowed(new Uint8Array(COLS * ROWS), 11, 11, 1, 1)).toBe(true);
  });

  it("never lets a route pass through a footprint", () => {
    const routes = routesOf([tower(1, "lance", 20, 16)]);
    for (let c = 20; c < 24; c += 1) {
      for (let r = 16; r < 20; r += 1) {
        expect(routes.right[tileIndex(c, r)]).toBe(Infinity);
      }
    }
    expect(Number.isFinite(routes.leftLength)).toBe(true);
  });

  it("reports a sealed floor as unreachable", () => {
    const blocked = new Uint8Array(COLS * ROWS);
    for (let r = 0; r < ROWS; r += 1) blocked[tileIndex(10, r)] = 1;
    const routes = routesFromBlocked(blocked);
    expect(Number.isFinite(routes.leftLength)).toBe(false);
    expect(Number.isFinite(routes.topLength)).toBe(true);
  });
});

describe("a unit's own route", () => {
  it("reads the route from the tile it stands on", () => {
    const routes = routesOf([]);
    const unit = {
      type: "mote" as const,
      x: tileCX(40),
      y: tileCY(17),
      vent: "left" as const,
    };
    expect(remainingOf(unit, routes)).toBeCloseTo(9, 9);
  });

  it("measures a flyer's route as the straight line to its exhaust", () => {
    const routes = routesOf([]);
    const unit = {
      type: "drift" as const,
      x: tileCX(40),
      y: tileCY(17),
      vent: "left" as const,
    };
    // The right exhaust's opening midpoint sits between rows 17 and 18.
    const dx = tileCX(COLS - 1) - tileCX(40);
    const dy = (tileCY(16) + tileCY(19)) / 2 - tileCY(17);
    expect(remainingOf(unit, routes)).toBeCloseTo(Math.hypot(dx, dy) / TILE, 9);
  });

  it("steps toward the exhaust and stops on it", () => {
    const routes = routesOf([]);
    expect(nextStep(routes, "right", 40, 17)).toEqual({ col: 41, row: 17 });
    expect(nextStep(routes, "right", COLS - 1, 17)).toBeNull();
  });
});
