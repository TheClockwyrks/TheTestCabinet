// The routes: the step rule, the metric, and the never-seal predicate.

import { describe, expect, it } from "vitest";
import { COLS, ROWS } from "./constants";
import { tileIndex } from "./geometry";
import {
  DIAGONAL_COST,
  distanceField,
  nextStep,
  remainingFrom,
  routesFor,
} from "./routes";

function openFloor(): Uint8Array {
  return new Uint8Array(COLS * ROWS);
}

function block(blocked: Uint8Array, col: number, row: number): void {
  blocked[tileIndex(col, row)] = 1;
}

describe("the step rule", () => {
  it("costs an orthogonal step 1 and a diagonal sqrt(2)", () => {
    const field = distanceField(openFloor(), [{ col: 10, row: 10 }]);
    expect(field[tileIndex(10, 11)]).toBeCloseTo(1, 10);
    expect(field[tileIndex(11, 10)]).toBeCloseTo(1, 10);
    expect(field[tileIndex(11, 11)]).toBeCloseTo(DIAGONAL_COST, 10);
  });

  it("refuses a diagonal when either tile it cuts past is blocked", () => {
    const blocked = openFloor();
    block(blocked, 11, 10);
    const field = distanceField(blocked, [{ col: 11, row: 11 }]);
    expect(field[tileIndex(10, 10)]).toBeGreaterThan(DIAGONAL_COST + 1e-6);

    const other = openFloor();
    block(other, 10, 11);
    const second = distanceField(other, [{ col: 11, row: 11 }]);
    expect(second[tileIndex(10, 10)]).toBeGreaterThan(DIAGONAL_COST + 1e-6);
  });

  it("allows a diagonal while both tiles it cuts past stay open", () => {
    const blocked = openFloor();
    // A block that is neither of the two tiles the step cuts past.
    block(blocked, 12, 12);
    const field = distanceField(blocked, [{ col: 11, row: 11 }]);
    expect(field[tileIndex(10, 10)]).toBeCloseTo(DIAGONAL_COST, 10);
  });
});

describe("the two vent routes", () => {
  it("runs each vent to its opposite exhaust across the open floor", () => {
    const routes = routesFor(openFloor());
    // Left vent column 0 to right exhaust column 49: 49 orthogonal steps.
    expect(routes.lengths.left).toBeCloseTo(49, 10);
    // Top vent row 0 to bottom exhaust row 35: 35 orthogonal steps.
    expect(routes.lengths.top).toBeCloseTo(35, 10);
  });

  it("lengthens a route when a wall is built across it", () => {
    const blocked = openFloor();
    for (let row = 0; row < 30; row += 1) block(blocked, 25, row);
    const routes = routesFor(blocked);
    expect(routes.lengths.left).toBeGreaterThan(49);
    expect(Number.isFinite(routes.lengths.left)).toBe(true);
  });

  it("reports an unreachable exhaust as infinite, which is a seal", () => {
    const blocked = openFloor();
    for (let row = 0; row < ROWS; row += 1) block(blocked, 48, row);
    expect(routesFor(blocked).lengths.left).toBe(Infinity);
  });
});

describe("reading a route from a tile", () => {
  it("steps toward the cheapest neighbour", () => {
    const routes = routesFor(openFloor());
    const step = nextStep(routes, "right", 10, 16);
    expect(step).toEqual({ col: 11, row: 16 });
  });

  it("reads a route off a tile a tower was dropped onto", () => {
    const blocked = openFloor();
    block(blocked, 10, 16);
    const routes = routesFor(blocked);
    const left = remainingFrom(routes, "right", 10, 16);
    expect(Number.isFinite(left)).toBe(true);
    expect(left).toBeGreaterThan(0);
  });

  it("has no step off the grid", () => {
    const routes = routesFor(openFloor());
    expect(nextStep(routes, "right", -1, 0)).toBeNull();
    expect(remainingFrom(routes, "right", -1, 0)).toBe(Infinity);
  });
});
