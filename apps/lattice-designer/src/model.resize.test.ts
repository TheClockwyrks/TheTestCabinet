// Tests for resizing the board.
//
// A resize is the only edit in this tool that changes many components at once, and
// there is no undo behind it, so the property under test is that it never loses
// anything: what does not fit is set aside and comes back when the board does.

import { describe, expect, it } from "vitest";
import {
  inBounds,
  resizeBoard,
  type AsideEntity,
  type Design,
  type DesignEntity,
} from "./model";

function belt(x: number, y: number): DesignEntity {
  return { type: "belt", x, y, dir: "E", tier: "fast" };
}

function board(width: number, height: number, ...xs: number[]): Design {
  return { grid: { width, height }, entities: xs.map((x) => belt(x, 1)) };
}

describe("shrinking the board", () => {
  it("sets aside what no longer fits instead of deleting it", () => {
    const shrunk = resizeBoard(board(24, 8, 2, 10, 20), [], 6, 8);
    expect(shrunk.design.entities.map((e) => e.x)).toEqual([2]);
    expect(shrunk.setAside).toBe(2);
    expect(shrunk.aside.map((a) => a.entity.x)).toEqual([10, 20]);
  });

  it("gives everything back when the board grows again", () => {
    const shrunk = resizeBoard(board(24, 8, 2, 10, 20), [], 6, 8);
    const grown = resizeBoard(shrunk.design, shrunk.aside, 24, 8);
    expect(grown.design.entities.map((e) => e.x)).toEqual([2, 10, 20]);
    expect(grown.restored).toBe(2);
    expect(grown.aside).toEqual([]);
  });

  it("restores placement order, which the canonical state is keyed on", () => {
    // The survivor sits LAST in the order, so appending the returning components
    // would reorder the design and change every checksum the case grades on.
    const start: Design = {
      grid: { width: 24, height: 8 },
      entities: [belt(10, 1), belt(20, 1), belt(2, 1)],
    };
    const shrunk = resizeBoard(start, [], 6, 8);
    const grown = resizeBoard(shrunk.design, shrunk.aside, 24, 8);
    expect(grown.design.entities).toEqual(start.entities);
  });

  it("keeps a multi-tile footprint whose far edge falls outside", () => {
    const start: Design = {
      grid: { width: 24, height: 12 },
      entities: [{ type: "assembler", x: 8, y: 1, recipe: "iron-gear" }],
    };
    // The 3×3 block runs x=8..10, so a 10-wide board cuts its last column.
    const shrunk = resizeBoard(start, [], 10, 12);
    expect(shrunk.design.entities).toEqual([]);
    expect(shrunk.aside).toHaveLength(1);
    const grown = resizeBoard(shrunk.design, shrunk.aside, 24, 12);
    expect(grown.design.entities).toEqual(start.entities);
  });
});

describe("restoring onto a board that was built on meanwhile", () => {
  it("leaves a standing component where it is and keeps the blocked one aside", () => {
    const start: Design = {
      grid: { width: 24, height: 12 },
      entities: [{ type: "assembler", x: 8, y: 1, recipe: "iron-gear" }],
    };
    const shrunk = resizeBoard(start, [], 10, 12);
    // With the assembler away, its first two columns are free real estate.
    const builtOn: Design = {
      grid: shrunk.design.grid,
      entities: [...shrunk.design.entities, belt(8, 1)],
    };
    const grown = resizeBoard(builtOn, shrunk.aside, 24, 12);
    expect(grown.design.entities).toEqual([belt(8, 1)]);
    expect(grown.restored).toBe(0);
    expect(grown.aside.map((a) => a.entity.type)).toEqual(["assembler"]);
    // Deleting what blocks it is enough to get it back on the next resize.
    const cleared: Design = { grid: grown.design.grid, entities: [] };
    const again = resizeBoard(cleared, grown.aside, 24, 12);
    expect(again.design.entities).toEqual(start.entities);
  });
});

describe("the destructive resize this replaced", () => {
  it("would have deleted every component outside the smaller board", () => {
    // The negative control: the entities really are outside a 6-wide board, so the
    // tests above are measuring a rescue and not a resize that changed nothing.
    const start = board(24, 8, 2, 10, 20);
    const grid = { width: 6, height: 8 };
    expect(start.entities.filter((e) => inBounds(e, grid))).toHaveLength(1);
  });
});

describe("carrying the set-aside components through other edits", () => {
  it("puts a returning component back near its slot after later placements", () => {
    const shrunk = resizeBoard(board(24, 8, 2, 10, 20), [], 6, 8);
    const placed: Design = {
      grid: shrunk.design.grid,
      entities: [...shrunk.design.entities, belt(4, 1)],
    };
    const aside: AsideEntity[] = shrunk.aside;
    const grown = resizeBoard(placed, aside, 24, 8);
    expect(grown.design.entities.map((e) => e.x).sort((a, b) => a - b)).toEqual(
      [2, 4, 10, 20],
    );
    expect(grown.aside).toEqual([]);
  });
});
