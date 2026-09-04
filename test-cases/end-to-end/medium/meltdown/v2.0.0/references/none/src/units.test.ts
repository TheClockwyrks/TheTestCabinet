// A surge unit's derived reads (specs/surge.md, specs/mazing.md).

import { describe, expect, it } from "vitest";
import {
  BOTTOM_EXHAUST_COLS,
  COLS,
  LEFT_VENT_ROWS,
  ROWS,
  TILE,
  TOP_VENT_COLS,
  tileCX,
  tileCY,
} from "./constants";
import { SURGE_DEFS } from "./defs";
import { Floor, colOf, footprintTiles, rowOf } from "./grid";
import {
  atExhaust,
  baseSpeedOf,
  createUnit,
  entryTile,
  exhaustOf,
  exhaustPoint,
  fliesOf,
  remainingOf,
  speedOf,
  tileOf,
  unitById,
} from "./units";
import type { Unit } from "./state";

function unit(over: Partial<Unit> = {}): Unit {
  return {
    id: 1,
    type: "mote",
    x: tileCX(0),
    y: tileCY(17),
    hp: 40,
    maxHp: 40,
    slowFactor: 0,
    slowTimer: 0,
    vent: "left",
    motion: true,
    ...over,
  };
}

describe("the assignment", () => {
  it("sends every unit to its vent's fixed opposite exhaust", () => {
    expect(exhaustOf(unit({ vent: "left" }))).toBe("right");
    expect(exhaustOf(unit({ vent: "top" }))).toBe("bottom");
  });

  it("reads flight off the type, and the Drift alone flies", () => {
    for (const type of ["mote", "sprint", "hulk", "swarm", "core"] as const) {
      expect(fliesOf(unit({ type }))).toBe(false);
    }
    expect(fliesOf(unit({ type: "drift" }))).toBe(true);
  });
});

describe("speed", () => {
  it("is the type's speed with no slow on it", () => {
    for (const type of Object.keys(SURGE_DEFS) as Array<
      keyof typeof SURGE_DEFS
    >) {
      const live = unit({ type });
      expect(baseSpeedOf(live)).toBe(SURGE_DEFS[type].speed);
      expect(speedOf(live)).toBe(SURGE_DEFS[type].speed);
    }
  });

  it("falls by exactly the fraction the live slow removes", () => {
    const live = unit({ slowFactor: 0.55, slowTimer: 1 });
    expect(speedOf(live)).toBeCloseTo(60 * 0.45, 9);
  });

  it("stops the unit dead at a slow of one", () => {
    expect(speedOf(unit({ slowFactor: 1 }))).toBe(0);
  });
});

describe("the tile a unit stands on", () => {
  it("is the one containing its centre", () => {
    expect(tileOf(unit({ x: tileCX(7), y: tileCY(9) }))).toEqual({
      c: 7,
      r: 9,
    });
  });

  it("reads off the grid where the centre has left the floor", () => {
    const { c } = tileOf(unit({ x: -20 }));
    expect(c).toBeLessThan(0);
  });
});

describe("reaching an exhaust", () => {
  it("is standing on one of the assigned exhaust's opening tiles", () => {
    const walker = unit({ x: tileCX(COLS - 1), y: tileCY(17) });
    expect(atExhaust(walker)).toBe(true);
  });

  it("is not the nearer opening of the other pair", () => {
    // The left vent's units are assigned the RIGHT exhaust, never the bottom.
    const walker = unit({
      vent: "left",
      x: tileCX(BOTTOM_EXHAUST_COLS[0]),
      y: tileCY(ROWS - 1),
    });
    expect(atExhaust(walker)).toBe(false);
  });

  it("is false while the centre is off the grid entirely", () => {
    expect(atExhaust(unit({ x: -50, y: -50 }))).toBe(false);
  });
});

describe("the point a flyer aims at", () => {
  it("is the midpoint of its exhaust opening's run of tile centres", () => {
    const right = exhaustPoint("right");
    expect(right.x).toBe(tileCX(COLS - 1));
    expect(right.y).toBe((tileCY(16) + tileCY(19)) / 2);
    const bottom = exhaustPoint("bottom");
    expect(bottom.y).toBe(tileCY(ROWS - 1));
    expect(bottom.x).toBe((tileCX(22) + tileCX(29)) / 2);
  });
});

describe("what remains of the route", () => {
  const floor = new Floor();

  it("is the walker's field value, in tiles", () => {
    const walker = unit({ x: tileCX(0), y: tileCY(17) });
    // An open floor: 49 orthogonal steps from column 0 to column 49.
    expect(remainingOf(walker, floor)).toBeCloseTo(COLS - 1, 9);
  });

  it("rises when a wall is built across the way", () => {
    const walker = unit({ x: tileCX(0), y: tileCY(17) });
    const open = remainingOf(walker, floor);
    const walled = new Floor([{ id: 1, col: 10, row: 10, size: 4 }]);
    const around = remainingOf(walker, walled);
    expect(around).toBeGreaterThanOrEqual(open);
  });

  it("is the flyer's straight line, in tiles, and ignores the floor", () => {
    const flyer = unit({ type: "drift", x: tileCX(0), y: tileCY(17) });
    const goal = exhaustPoint("right");
    const expected = Math.hypot(goal.x - flyer.x, goal.y - flyer.y) / TILE;
    expect(remainingOf(flyer, floor)).toBeCloseTo(expected, 9);
    const walled = new Floor([{ id: 1, col: 10, row: 10, size: 4 }]);
    expect(remainingOf(flyer, walled)).toBeCloseTo(expected, 9);
  });

  it("is nothing at all where the unit stands in a sealed pocket", () => {
    const pocket = new Floor([
      { id: 1, col: 1, row: 0, size: 2 },
      { id: 2, col: 1, row: 2, size: 2 },
      { id: 3, col: 0, row: 2, size: 2 },
    ]);
    const walker = unit({ x: tileCX(0), y: tileCY(0) });
    expect(remainingOf(walker, pocket)).toBe(Infinity);
  });
});

describe("entering the floor", () => {
  it("appears on the centre of one of the vent's opening tiles", () => {
    const floor = new Floor();
    for (const vent of ["left", "top"] as const) {
      const live = createUnit(1, "mote", vent, floor, 1, 0);
      const { c, r } = tileOf(live);
      const opening = vent === "left" ? LEFT_VENT_ROWS : TOP_VENT_COLS;
      if (vent === "left") {
        expect(c).toBe(0);
        expect(opening).toContain(r);
      } else {
        expect(r).toBe(0);
        expect(opening).toContain(c);
      }
      expect(live.x).toBe(tileCX(c));
      expect(live.y).toBe(tileCY(r));
    }
  });

  it("never appears on an opening tile a footprint has covered", () => {
    // Three of the left vent's four rows walled: only row 19 is left.
    const floor = new Floor([
      { id: 1, col: 0, row: 16, size: 2 },
      { id: 2, col: 0, row: 18, size: 1 },
    ]);
    for (let spread = 0; spread < 6; spread += 1) {
      const tile = entryTile(floor, "left", spread);
      expect(rowOf(tile)).toBe(19);
      expect(colOf(tile)).toBe(0);
    }
  });

  it("spreads a wave across the opening rather than stacking it", () => {
    const floor = new Floor();
    const rows = [0, 1, 2, 3].map((spread) =>
      rowOf(entryTile(floor, "left", spread)),
    );
    expect(new Set(rows).size).toBe(LEFT_VENT_ROWS.length);
  });

  it("still has somewhere to stand on a posed floor with the vent sealed", () => {
    const sealed = new Floor([
      { id: 1, col: 0, row: 16, size: 4 },
      ...footprintTiles(0, 16, 4).map((_tile, i) => ({
        id: 2 + i,
        col: 0,
        row: 16,
        size: 4,
      })),
    ]);
    expect(() => entryTile(sealed, "left", 0)).not.toThrow();
    expect(LEFT_VENT_ROWS).toContain(rowOf(entryTile(sealed, "left", 0)));
  });

  it("starts at full hp, scaled for the wave, with its motion on", () => {
    const floor = new Floor();
    const live = createUnit(4, "hulk", "top", floor, 2.24, 0);
    expect(live.id).toBe(4);
    expect(live.maxHp).toBeCloseTo(220 * 2.24, 9);
    expect(live.hp).toBe(live.maxHp);
    expect(live.motion).toBe(true);
    expect(live.slowFactor).toBe(0);
    expect(live.slowTimer).toBe(0);
  });
});

describe("finding a unit", () => {
  it("takes the one holding that id, and nothing for an id nothing answers", () => {
    const roster = [unit({ id: 3 }), unit({ id: 8 })];
    expect(unitById(roster, 8)?.id).toBe(8);
    expect(unitById(roster, 4)).toBeNull();
    expect(unitById(roster, null)).toBeNull();
  });
});
