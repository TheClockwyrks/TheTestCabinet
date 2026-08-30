// The bodies on the strait: how one is made, where it stands, what it is standing
// on, and how a bear is taken off the strait.

import { describe, expect, it } from "vitest";
import {
  ROW_MEDIAN,
  ROW_NEAR,
  START_COL,
  TILE,
  WATER_TOP,
  bearIceSpeed,
  bearSwimSpeed,
  tileCX,
  tileCY,
  tileLeft,
} from "./constants";
import {
  bearById,
  bearSpeed,
  bearSwimming,
  critterCol,
  critterFooting,
  critterRow,
  dropAllBears,
  dropBear,
  facingBetween,
  footingAt,
  freshCritter,
  isSettled,
  makeBear,
  makeCritter,
  placeCenter,
} from "./entities";
import { createState } from "./game";
import { addItem } from "./lanes";

describe("the critter", () => {
  it("is made settled on its tile, facing up and ready to hop", () => {
    const critter = makeCritter(7, 12);
    expect([critter.x, critter.y]).toEqual([tileCX(7), tileCY(12)]);
    expect([critter.prevX, critter.prevY]).toEqual([critter.x, critter.y]);
    expect(critter.present).toBe(true);
    expect(critter.facing).toBe("up");
    expect(critter.hopCooldown).toBe(0);
    expect(critter.bestRow).toBe(12);
  });

  it("begins a fresh crossing on the near shore at the start column", () => {
    const critter = freshCritter();
    expect(critterCol(critter)).toBe(START_COL);
    expect(critterRow(critter)).toBe(ROW_NEAR);
    expect(critter.bestRow).toBe(ROW_NEAR);
  });

  it("reads its tile off its centre, wherever a floe has carried it", () => {
    const critter = makeCritter(10, 5);
    critter.x = tileCX(10) + TILE * 2 + 3;
    expect(critterCol(critter)).toBe(12);
    expect(critterRow(critter)).toBe(5);
  });
});

describe("placing a body", () => {
  it("leaves no interpolation trail behind it", () => {
    const critter = makeCritter(1, 1);
    placeCenter(critter, 500, 300);
    expect([critter.x, critter.y, critter.prevX, critter.prevY]).toEqual([
      500, 300, 500, 300,
    ]);
  });
});

describe("footing", () => {
  it("is solid off the water band and water on it, until a floe covers it", () => {
    const state = createState();
    state.floes = [];
    expect(footingAt(state, tileCX(4), ROW_NEAR)).toBe("solid");
    expect(footingAt(state, tileCX(4), ROW_MEDIAN)).toBe("solid");
    expect(footingAt(state, tileCX(4), 11)).toBe("solid");
    expect(footingAt(state, tileCX(4), WATER_TOP)).toBe("water");

    addItem(state, state.floes, WATER_TOP, "raft3", tileLeft(3));
    expect(footingAt(state, tileCX(3), WATER_TOP)).toBe("floe");
    expect(footingAt(state, tileCX(5), WATER_TOP)).toBe("floe");
    expect(footingAt(state, tileCX(6), WATER_TOP)).toBe("water");
  });

  it("reads the critter's own footing off its centre", () => {
    const state = createState();
    state.floes = [];
    state.critter = makeCritter(20, WATER_TOP);
    expect(critterFooting(state)).toBe("water");
    addItem(state, state.floes, WATER_TOP, "pan", tileLeft(20));
    expect(critterFooting(state)).toBe("floe");
  });
});

describe("a bear", () => {
  it("is made settled on its tile, hunting it, every faculty on", () => {
    const state = createState();
    const bear = makeBear(state, 6, ROW_MEDIAN);
    expect([bear.col, bear.row, bear.stepCol, bear.stepRow]).toEqual([
      6,
      ROW_MEDIAN,
      6,
      ROW_MEDIAN,
    ]);
    expect([bear.x, bear.y]).toEqual([tileCX(6), tileCY(ROW_MEDIAN)]);
    expect(bear.facing).toBe("up");
    expect(bear.target).toEqual({ col: 6, row: ROW_MEDIAN });
    expect([bear.sense, bear.routing, bear.travel]).toEqual([true, true, true]);
    expect(isSettled(bear)).toBe(true);
  });

  it("takes an id no other live entity carries", () => {
    const state = createState();
    const first = makeBear(state, 1, 1);
    const second = makeBear(state, 2, 2);
    expect(second.id).not.toBe(first.id);
    state.bears = [first, second];
    expect(bearById(state, first.id)).toBe(first);
    expect(bearById(state, 9999)).toBe(null);
  });

  it("swims where the tile it is entering is water no floe covers", () => {
    const state = createState();
    state.floes = [];
    const bear = makeBear(state, 20, WATER_TOP);
    expect(bearSwimming(state, bear)).toBe(true);
    expect(bearSpeed(state, bear)).toBeCloseTo(bearSwimSpeed(1) * TILE, 9);

    addItem(state, state.floes, WATER_TOP, "pan", tileLeft(20));
    expect(bearSwimming(state, bear)).toBe(false);
    expect(bearSpeed(state, bear)).toBeCloseTo(bearIceSpeed(1) * TILE, 9);
  });

  it("reads its footing off the tile it is entering, not the one it left", () => {
    const state = createState();
    state.floes = [];
    const bear = makeBear(state, 20, ROW_MEDIAN);
    bear.stepRow = WATER_TOP + 7;
    expect(bearSwimming(state, bear)).toBe(true);
    expect(isSettled(bear)).toBe(false);
  });

  it("speeds up with the level, on ice and swimming alike", () => {
    const state = createState();
    state.floes = [];
    const bear = makeBear(state, 20, ROW_MEDIAN);
    state.level = 8;
    expect(bearSpeed(state, bear)).toBeCloseTo(bearIceSpeed(8) * TILE, 9);
  });

  it("empties the slot it filled when it is taken off the strait", () => {
    const state = createState();
    const bear = makeBear(state, 3, ROW_NEAR);
    state.bears = [bear];
    state.slots = [{ bearId: bear.id, emptyFor: 5 }];
    dropBear(state, bear.id);
    expect(state.bears).toEqual([]);
    expect(state.slots[0]).toEqual({ bearId: null, emptyFor: 0 });
  });

  it("empties every slot when the whole hunt is cleared", () => {
    const state = createState();
    const first = makeBear(state, 3, ROW_NEAR);
    const second = makeBear(state, 4, ROW_NEAR);
    state.bears = [first, second];
    state.slots = [
      { bearId: first.id, emptyFor: 1 },
      { bearId: second.id, emptyFor: 2 },
    ];
    dropAllBears(state);
    expect(state.bears).toEqual([]);
    expect(state.slots).toEqual([
      { bearId: null, emptyFor: 0 },
      { bearId: null, emptyFor: 0 },
    ]);
  });

  it("leaves a slot alone when another bear is taken off", () => {
    const state = createState();
    const bear = makeBear(state, 3, ROW_NEAR);
    state.bears = [bear];
    state.slots = [{ bearId: bear.id, emptyFor: 4 }];
    dropBear(state, 12345);
    expect(state.bears).toEqual([bear]);
    expect(state.slots[0].bearId).toBe(bear.id);
  });
});

describe("the facing between two tiles", () => {
  it("names the direction a step takes", () => {
    expect(facingBetween(5, 5, 5, 4)).toBe("up");
    expect(facingBetween(5, 5, 5, 6)).toBe("down");
    expect(facingBetween(5, 5, 4, 5)).toBe("left");
    expect(facingBetween(5, 5, 6, 5)).toBe("right");
  });
});
