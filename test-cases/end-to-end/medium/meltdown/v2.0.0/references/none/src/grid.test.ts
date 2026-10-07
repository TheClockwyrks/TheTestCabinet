import { describe, expect, it } from "vitest";
import { COLS } from "./constants";
import {
  Floor,
  OPENING_TILES,
  colOf,
  footprintTiles,
  idx,
  perimeterEdges,
  rowOf,
} from "./grid";

describe("tile addressing", () => {
  it("round-trips a tile through its index", () => {
    for (const [c, r] of [
      [0, 0],
      [49, 35],
      [22, 17],
    ]) {
      const i = idx(c, r);
      expect(colOf(i)).toBe(c);
      expect(rowOf(i)).toBe(r);
    }
  });

  it("covers a footprint's whole square", () => {
    expect(footprintTiles(3, 4, 2)).toEqual([
      idx(3, 4),
      idx(4, 4),
      idx(3, 5),
      idx(4, 5),
    ]);
    expect(footprintTiles(0, 0, 4)).toHaveLength(16);
  });

  it("gives a face one edge-tile per tile of the footprint's side", () => {
    const edges = perimeterEdges(5, 5, 3);
    expect(edges).toHaveLength(12);
    expect(edges.filter((e) => e.side === "N")).toHaveLength(3);
    expect(edges.filter((e) => e.side === "W")).toHaveLength(3);
    // The tile just outside the north face is one row above the footprint.
    expect(edges.find((e) => e.side === "N")?.or).toBe(4);
  });
});

describe("the open floor", () => {
  it("opens on the two straight vent-to-exhaust corridors", () => {
    const floor = new Floor();
    expect(floor.routeLength("left")).toBeCloseTo(49, 10);
    expect(floor.routeLength("top")).toBeCloseTo(35, 10);
  });

  it("blocks every tile of a footprint and reopens them all", () => {
    const floor = new Floor([{ id: 1, col: 10, row: 10, size: 3 }]);
    expect(floor.isOpen(10, 10)).toBe(false);
    expect(floor.isOpen(12, 12)).toBe(false);
    expect(floor.isOpen(13, 12)).toBe(true);
    expect(floor.owner[idx(11, 11)]).toBe(1);
    floor.rebuild([]);
    expect(floor.isOpen(10, 10)).toBe(true);
    expect(floor.owner[idx(11, 11)]).toBe(-1);
  });

  it("lengthens a route rather than losing it when a wall goes up", () => {
    const wall = Array.from({ length: 8 }, (_v, i) => ({
      id: i + 1,
      col: 24,
      row: 14 + i * 2,
      size: 2,
    }));
    const floor = new Floor(wall);
    expect(floor.routeLength("left")).toBeGreaterThan(49);
    expect(Number.isFinite(floor.routeLength("left"))).toBe(true);
  });

  it("refuses a diagonal that would squeeze between two corners", () => {
    // Two 2x2 towers touching only at a corner, with the gap on the diagonal.
    const floor = new Floor([
      { id: 1, col: 10, row: 10, size: 2 },
      { id: 2, col: 12, row: 12, size: 2 },
    ]);
    const field = floor.distanceField([idx(13, 11)]);
    // The tile diagonally through the pinch is reachable, but not by cutting
    // the corner: the route round it is longer than one diagonal step.
    expect(field[idx(11, 13)]).toBeGreaterThan(Math.SQRT2 + 1);
  });

  it("counts a diagonal as sqrt(2) and an orthogonal step as one", () => {
    const floor = new Floor();
    const field = floor.distanceField([idx(10, 10)]);
    expect(field[idx(11, 10)]).toBeCloseTo(1, 10);
    expect(field[idx(11, 11)]).toBeCloseTo(Math.SQRT2, 10);
    expect(field[idx(13, 10)]).toBeCloseTo(3, 10);
  });

  it("reports an unreachable route rather than pretending one exists", () => {
    const sealed = Array.from({ length: 2 }, (_v, i) => ({
      id: i + 1,
      col: 0,
      row: 16 + i * 2,
      size: 2,
    }));
    const floor = new Floor(sealed);
    expect(floor.openOpeningTiles("left")).toHaveLength(0);
    expect(floor.routeLength("left")).toBe(Infinity);
  });

  it("steps downhill toward the exhaust", () => {
    const floor = new Floor();
    const field = floor.field("right");
    const next = floor.bestNext(10, 17, field);
    expect(next).not.toBeNull();
    expect(field[idx(next!.c, next!.r)]).toBeLessThan(field[idx(10, 17)]);
  });

  it("floods only what a candidate placement leaves open", () => {
    const floor = new Floor();
    const extra = new Set(Array.from({ length: 36 }, (_v, r) => idx(30, r)));
    const reach = floor.reachable(OPENING_TILES.right, extra);
    expect(reach[idx(40, 17)]).toBe(1);
    expect(reach[idx(10, 17)]).toBe(0);
  });

  it("lists an opening's four or eight edge tiles", () => {
    expect(OPENING_TILES.left).toHaveLength(4);
    expect(OPENING_TILES.right).toHaveLength(4);
    expect(OPENING_TILES.top).toHaveLength(8);
    expect(OPENING_TILES.bottom).toHaveLength(8);
    expect(OPENING_TILES.right.every((t) => colOf(t) === COLS - 1)).toBe(true);
  });
});
