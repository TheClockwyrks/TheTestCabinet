// The two bands: the tables they are laid out from, the spacing that survives the
// strait's edges, and the covering rule everything else reads them through.

import { describe, expect, it } from "vitest";
import {
  ICE_LANES,
  ITEM_LEN,
  LEVEL_SPEED_STEP,
  STRAIT_W,
  TILE,
  WATER_LANES,
  laneGap,
  tileCX,
} from "./constants";
import { createState } from "./game";
import {
  advanceLanes,
  coversPoint,
  coversTile,
  layoutLane,
  layoutLevel,
  tileSweptWithin,
  vehicleOnTile,
} from "./lanes";
import type { LaneItem } from "./types";

/** The gaps, in tiles, between consecutive items of one row, left to right. */
function gapsOn(items: readonly LaneItem[], row: number): number[] {
  const lane = items
    .filter((item) => item.row === row)
    .sort((a, b) => a.x - b.x);
  const gaps: number[] = [];
  for (let i = 1; i < lane.length; i += 1) {
    gaps.push((lane[i].x - (lane[i - 1].x + TILE * lane[i - 1].len)) / TILE);
  }
  return gaps;
}

describe("laying a level out", () => {
  it("puts eight lanes on each band, at the table's rows", () => {
    const state = createState();
    expect(state.iceLanes.map((lane) => lane.row)).toEqual([
      11, 12, 13, 14, 15, 16, 17, 18,
    ]);
    expect(state.waterLanes.map((lane) => lane.row)).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });

  it("gives every lane the table's kind, direction and speed", () => {
    const state = createState();
    for (const spec of [...ICE_LANES, ...WATER_LANES]) {
      const lane = [...state.iceLanes, ...state.waterLanes].find(
        (entry) => entry.row === spec.row,
      );
      expect(lane?.dir).toBe(spec.dir);
      expect(lane?.speed).toBeCloseTo(spec.speed, 9);
      const items = [...state.vehicles, ...state.floes].filter(
        (item) => item.row === spec.row,
      );
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.kind).toBe(spec.kind);
        expect(item.len).toBe(ITEM_LEN[spec.kind]);
      }
    }
  });

  it("leaves exactly the table's gap between consecutive items", () => {
    const state = createState();
    for (const spec of [...ICE_LANES, ...WATER_LANES]) {
      const items = spec.row >= 11 ? state.vehicles : state.floes;
      for (const gap of gapsOn(items, spec.row)) {
        expect(gap).toBeCloseTo(spec.gap, 6);
      }
    }
  });

  it("reaches both edges of the strait, so the pattern runs unbroken across it", () => {
    const state = createState();
    for (const spec of [...ICE_LANES, ...WATER_LANES]) {
      const items = (spec.row >= 11 ? state.vehicles : state.floes).filter(
        (item) => item.row === spec.row,
      );
      // The leftmost item is within one period of the left edge, so the run of
      // item and gap in front of it is the pattern rather than a hole, and the
      // rightmost reaches past the right edge.
      const period = (ITEM_LEN[spec.kind] + spec.gap) * TILE;
      expect(Math.min(...items.map((item) => item.x))).toBeLessThanOrEqual(
        period,
      );
      expect(
        Math.max(...items.map((item) => item.x + TILE * item.len)),
      ).toBeGreaterThanOrEqual(STRAIT_W);
    }
  });

  it("keeps the gaps at their stated value across ten seconds of wrapping", () => {
    const state = createState();
    for (let tick = 0; tick < 1200; tick += 1) advanceLanes(state, 1 / 120);
    for (const spec of [...ICE_LANES, ...WATER_LANES]) {
      const items = spec.row >= 11 ? state.vehicles : state.floes;
      for (const gap of gapsOn(items, spec.row)) {
        expect(gap).toBeCloseTo(spec.gap, 4);
      }
    }
  });

  it("keeps every item's id across a wrap", () => {
    const state = createState();
    const before = state.vehicles.map((item) => item.id).sort();
    for (let tick = 0; tick < 2400; tick += 1) advanceLanes(state, 1 / 120);
    expect(state.vehicles.map((item) => item.id).sort()).toEqual(before);
  });

  it("scales the speeds and the gaps with the level", () => {
    const state = createState();
    for (const level of [1, 4, 7, 8]) {
      layoutLevel(state, level);
      for (const spec of [...ICE_LANES, ...WATER_LANES]) {
        const lane = [...state.iceLanes, ...state.waterLanes].find(
          (entry) => entry.row === spec.row,
        );
        expect(lane?.speed).toBeCloseTo(
          spec.speed * Math.pow(LEVEL_SPEED_STEP, level - 1),
          6,
        );
        const items = spec.row >= 11 ? state.vehicles : state.floes;
        for (const gap of gapsOn(items, spec.row)) {
          expect(gap).toBeCloseTo(laneGap(spec.row, level), 6);
        }
      }
    }
  });

  it("never lays a wall: no column is covered in every row of a band", () => {
    for (let draw = 1; draw <= 60; draw += 1) {
      const state = createState();
      for (const band of [
        { rows: ICE_LANES, items: state.vehicles },
        { rows: WATER_LANES, items: state.floes },
      ]) {
        for (let col = 0; col < 40; col += 1) {
          const covered = band.rows.every((spec) =>
            band.items.some(
              (item) => item.row === spec.row && coversTile(item, col),
            ),
          );
          expect(covered).toBe(false);
        }
      }
    }
  });

  it("relays one lane at a posed phase, at the level's spacing, with fresh ids", () => {
    const state = createState();
    state.level = 4;
    layoutLevel(state, 4);
    const before = state.floes.filter((item) => item.row !== 5);
    const ids = new Set(state.floes.map((item) => item.id));
    layoutLane(state, 5, 1000);
    expect(state.floes.filter((item) => item.row !== 5)).toEqual(before);
    const lane = state.floes
      .filter((item) => item.row === 5)
      .sort((a, b) => a.x - b.x);
    expect(lane.every((item) => item.kind === "pan")).toBe(true);
    expect(lane.every((item) => !ids.has(item.id))).toBe(true);
    expect(lane.some((item) => Math.abs(item.x - 1000) < 1e-9)).toBe(true);
    for (const gap of gapsOn(state.floes, 5)) {
      expect(gap).toBeCloseTo(laneGap(5, 4), 9);
    }
    expect(lane[0].x).toBeLessThanOrEqual(laneGap(5, 4) * TILE);
    expect(lane[lane.length - 1].x + TILE).toBeGreaterThanOrEqual(
      STRAIT_W - laneGap(5, 4) * TILE,
    );
  });
});

describe("the covering rule", () => {
  it("covers a point from its left edge up to but not including its right", () => {
    const item: LaneItem = {
      id: 1,
      row: 11,
      kind: "plow",
      x: 320,
      prevX: 320,
      len: 3,
    };
    expect(coversPoint(item, 319.9)).toBe(false);
    expect(coversPoint(item, 320)).toBe(true);
    expect(coversPoint(item, 415.9)).toBe(true);
    expect(coversPoint(item, 416)).toBe(false);
  });

  it("covers every tile a three-tile vehicle spans, its middle included", () => {
    const state = createState();
    state.vehicles = [
      { id: 1, row: 11, kind: "plow", x: tileCX(10) - 16, prevX: 0, len: 3 },
    ];
    expect(vehicleOnTile(state, 10, 11)).not.toBeNull();
    expect(vehicleOnTile(state, 11, 11)).not.toBeNull();
    expect(vehicleOnTile(state, 12, 11)).not.toBeNull();
    expect(vehicleOnTile(state, 13, 11)).toBeNull();
  });

  it("reads a tile a moving vehicle reaches within the look-ahead", () => {
    const state = createState();
    state.vehicles = [{ id: 1, row: 11, kind: "car", x: 0, prevX: 0, len: 2 }];
    const lane = state.iceLanes.find((entry) => entry.row === 11);
    if (lane === undefined) throw new Error("row 11 carries no lane");
    lane.dir = 1;
    lane.speed = 4;
    // Four tiles a second reaches two tiles on in half a second; a tile eight
    // tiles away is untouched over the same lead.
    expect(tileSweptWithin(state, 3, 11, 0.5)).toBe(true);
    expect(tileSweptWithin(state, 8, 11, 0.5)).toBe(false);
  });
});
