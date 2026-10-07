// The yard's grid, its tile states, and the never-seal rule (specs/yard.md, specs/pathing.md).

import { describe, expect, it } from "vitest";

import { Board } from "./board";
import { MAPS, TILE, mapById, tileCenter, footprintCenter } from "./constants";

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
    const board = new Board(mapById("substation"));
    const high = board.platformTiles(20, 4);
    expect(high).toHaveLength(4);
    expect(high).toContainEqual({ col: 19, row: 4 });
    expect(high).toContainEqual({ col: 21, row: 4 });
    expect(high).toContainEqual({ col: 20, row: 5 });
    const low = board.platformTiles(20, 28);
    expect(low).toContainEqual({ col: 20, row: 27 });
  });

  it("refuses a footprint that would cover any platform tile", () => {
    const board = new Board(mapById("substation"));
    for (const w of board.map.waypoints) {
      for (const t of board.platformTiles(w.col, w.row)) {
        // Every anchor whose 2 by 2 footprint covers this tile is refused.
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
      const board = new Board(map);
      expect(board.chainOpen(board.occupancy([]))).toBe(true);
    }
  });

  it("keeps every map's chain open however the yard is walled", () => {
    // Walling the whole yard one legal placement at a time can never seal a leg: each
    // placement is refused when it would, so the route survives an exhaustive build-out.
    for (const map of MAPS) {
      const board = new Board(map);
      const structures = [];
      let id = 1;
      for (let row = 0; row <= 31; row += 2) {
        for (let col = 0; col <= 48; col += 2) {
          if (board.canPlace(col, row, structures, [])) {
            structures.push({ id: id++, kind: "blocker" as const, col, row });
          }
        }
      }
      expect(structures.length).toBeGreaterThan(50);
      expect(board.chainOpen(board.occupancy(structures))).toBe(true);
    }
    // An exhaustive build-out of all three maps runs thousands of route solves, so it is
    // given room beyond the default per-test budget.
  }, 30_000);
});

describe("route length", () => {
  it("measures a diagonal step as the root of two", () => {
    const board = new Board(mapById("substation"));
    const occ = board.occupancy([]);
    const path = board.pathTiles({ col: 0, row: 0 }, { col: 3, row: 3 }, occ);
    expect(path).not.toBeNull();
    let len = 0;
    for (let i = 1; i < path!.length; i++) {
      len +=
        Math.hypot(
          path![i]!.x - path![i - 1]!.x,
          path![i]!.y - path![i - 1]!.y,
        ) / TILE;
    }
    expect(len).toBeCloseTo(3 * Math.SQRT2, 6);
  });

  it("refuses to cut the corner between two diagonally touching walls", () => {
    const board = new Board(mapById("substation"));
    // Two blockers meeting at a corner leave a diagonal gap the Load may not squeeze through.
    const structures = [
      { id: 1, kind: "blocker" as const, col: 10, row: 10 },
      { id: 2, kind: "blocker" as const, col: 12, row: 12 },
    ];
    const occ = board.occupancy(structures);
    const path = board.pathTiles(
      { col: 11, row: 12 },
      { col: 12, row: 11 },
      occ,
    );
    expect(path).not.toBeNull();
    let len = 0;
    for (let i = 1; i < path!.length; i++) {
      len +=
        Math.hypot(
          path![i]!.x - path![i - 1]!.x,
          path![i]!.y - path![i - 1]!.y,
        ) / TILE;
    }
    // A single diagonal would be 1.414; the route must go round instead.
    expect(len).toBeGreaterThan(Math.SQRT2 + 0.01);
  });
});
