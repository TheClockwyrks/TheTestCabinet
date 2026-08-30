// The yard's grid, its tile states, and the never-seal rule (specs/yard.md,
// specs/pathing.md).

import { describe, expect, it } from "vitest";

import { boardOf, platformTiles, Board } from "./board";
import { MAPS, TILE } from "./constants";
import { footprintCenter, tileCenter } from "./tables";
import type { Structure } from "./types";

describe("the tile grid", () => {
  it("centres a tile where the grid says", () => {
    expect(tileCenter(0, 0)).toEqual({ x: 10, y: 66 });
    expect(tileCenter(49, 32)).toEqual({ x: 990, y: 706 });
    expect(TILE).toBe(20);
  });

  it("centres a footprint on the meeting point of its four tiles", () => {
    expect(footprintCenter(0, 0)).toEqual({ x: 20, y: 76 });
    expect(footprintCenter(10, 10)).toEqual({ x: 220, y: 276 });
  });
});

describe("waypoint platforms", () => {
  it("covers four tiles, with the stem pointing at the grid's centre", () => {
    const high = platformTiles(20, 4);
    expect(high).toHaveLength(4);
    expect(high).toContainEqual({ col: 19, row: 4 });
    expect(high).toContainEqual({ col: 21, row: 4 });
    expect(high).toContainEqual({ col: 20, row: 5 });
    expect(platformTiles(20, 28)).toContainEqual({ col: 20, row: 27 });
  });

  it("refuses a footprint that would cover any platform tile", () => {
    const board = boardOf("substation");
    for (const wp of board.map.waypoints) {
      for (const t of platformTiles(wp.col, wp.row)) {
        for (const dc of [0, -1]) {
          for (const dr of [0, -1]) {
            const col = t.col + dc;
            const row = t.row + dr;
            if (!board.anchorInBounds(col, row)) continue;
            expect(board.canPlace(col, row, [], [])).toBe(false);
          }
        }
      }
    }
  });
});

describe("the never-seal rule", () => {
  it("leaves every map's chain open on an empty yard", () => {
    for (const map of MAPS) {
      const board = boardOf(map.id);
      expect(board.chainOpen(board.occupancy([]))).toBe(true);
    }
  });

  it("keeps every map's chain open however the yard is walled", () => {
    // Walling the whole yard one legal placement at a time can never seal a leg: each
    // placement is refused when it would, so the route survives an exhaustive
    // build-out. That is thousands of route solves, so it is given room beyond the
    // default budget.
    for (const map of MAPS) {
      const board: Board = boardOf(map.id);
      const structures: Structure[] = [];
      let id = 1;
      for (let row = 0; row <= 31; row += 2) {
        for (let col = 0; col <= 48; col += 2) {
          if (board.canPlace(col, row, structures, [])) {
            structures.push({ id: id++, kind: "blocker", col, row });
          }
        }
      }
      expect(structures.length).toBeGreaterThan(50);
      expect(board.chainOpen(board.occupancy(structures))).toBe(true);
    }
  }, 30_000);
});

describe("route length", () => {
  const lengthOf = (path: readonly { x: number; y: number }[]): number => {
    let len = 0;
    for (let i = 1; i < path.length; i++) {
      len +=
        Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y) /
        TILE;
    }
    return len;
  };

  it("measures a diagonal step as the root of two", () => {
    const board = boardOf("substation");
    const path = board.pathTiles(
      { col: 0, row: 0 },
      { col: 3, row: 3 },
      board.occupancy([]),
    );
    expect(path).not.toBeNull();
    expect(lengthOf(path!)).toBeCloseTo(3 * Math.SQRT2, 6);
  });

  it("refuses to cut the corner between two diagonally touching walls", () => {
    const board = boardOf("substation");
    const structures: Structure[] = [
      { id: 1, kind: "blocker", col: 10, row: 10 },
      { id: 2, kind: "blocker", col: 12, row: 12 },
    ];
    const occ = board.occupancy(structures);
    const path = board.pathTiles(
      { col: 11, row: 12 },
      { col: 12, row: 11 },
      occ,
    );
    expect(path).not.toBeNull();
    // A single diagonal would be the root of two; the route must go round instead.
    expect(lengthOf(path!)).toBeGreaterThan(Math.SQRT2 + 0.01);
  });
});
