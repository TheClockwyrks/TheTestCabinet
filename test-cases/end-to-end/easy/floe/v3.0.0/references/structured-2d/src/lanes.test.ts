// The two bands, against `specs/ice.md` and `specs/water.md`.
//
// Every check here stands a real engine up and reads the lanes back off the debug
// surface's snapshot, because the roster is the world's own tagged actors.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ICE_LANES,
  ITEM_LEN,
  LEVEL_GAP_EVERY,
  LEVEL_SPEED_STEP,
  ROW_MEDIAN,
  STRAIT_W,
  TILE,
  WATER_LANES,
  laneGap,
  laneSpeed,
  tileCX,
} from "./constants";
import { createHarness, type Harness } from "./harness.test-support";
import type { FloeSnapshotShape } from "./game";

/** What every check below reads of a lane item: where it is and how wide. */
interface LaneItem {
  row: number;
  x: number;
  len: number;
}

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.dispose();
});

/** A non-negative remainder. */
function mod(value: number, by: number): number {
  return ((value % by) + by) % by;
}

/**
 * That one lane's run of item and gap spans the whole strait: the slot before
 * its leftmost item lies off the left edge, and its rightmost item's right edge
 * is past the right one.
 */
function spans<T extends LaneItem>(
  which: number,
  items: readonly T[],
  level: number,
): void {
  const spec = [...ICE_LANES, ...WATER_LANES].find(
    (lane) => lane.row === which,
  );
  if (spec === undefined) throw new Error(`row ${which} carries no lane`);
  const period = (ITEM_LEN[spec.kind] + laneGap(which, level)) * TILE;
  const held = row(items, which);
  expect(held.length).toBeGreaterThan(1);
  expect(held[0].x - period).toBeLessThan(0);
  const last = held[held.length - 1];
  expect(last.x + last.len * TILE).toBeGreaterThanOrEqual(STRAIT_W);
}

/** Every item of one row, left to right. */
function row<T extends LaneItem>(items: readonly T[], which: number): T[] {
  return [...items]
    .filter((item) => item.row === which)
    .sort((a, b) => a.x - b.x);
}

describe("a laid-out band", () => {
  it("gives every lane its table's kind, direction and level-1 speed", () => {
    const snapshot = harness.snapshot();
    expect(snapshot.iceLanes.map((lane) => lane.row)).toEqual(
      ICE_LANES.map((lane) => lane.row),
    );
    expect(snapshot.waterLanes.map((lane) => lane.row)).toEqual(
      WATER_LANES.map((lane) => lane.row),
    );
    for (const spec of [...ICE_LANES, ...WATER_LANES]) {
      const lane = [...snapshot.iceLanes, ...snapshot.waterLanes].find(
        (entry) => entry.row === spec.row,
      );
      expect(lane).toBeDefined();
      expect(lane?.dir).toBe(spec.dir);
      expect(lane?.speed).toBeCloseTo(spec.speed, 10);
    }
    for (const item of snapshot.vehicles) {
      const spec = ICE_LANES.find((lane) => lane.row === item.row);
      expect(item.kind).toBe(spec?.kind);
      expect(item.len).toBe(ITEM_LEN[item.kind]);
    }
    for (const item of snapshot.floes) {
      const spec = WATER_LANES.find((lane) => lane.row === item.row);
      expect(item.kind).toBe(spec?.kind);
      expect(item.len).toBe(ITEM_LEN[item.kind]);
    }
  });

  it("spaces every lane by exactly its own item and gap", () => {
    const snapshot = harness.snapshot();
    for (const spec of ICE_LANES) {
      const period = (ITEM_LEN[spec.kind] + laneGap(spec.row, 1)) * TILE;
      const items = row(snapshot.vehicles, spec.row);
      expect(items.length).toBeGreaterThan(1);
      for (let i = 1; i < items.length; i += 1) {
        expect(items[i].x - items[i - 1].x).toBeCloseTo(period, 6);
      }
    }
    for (const spec of WATER_LANES) {
      const period = (ITEM_LEN[spec.kind] + laneGap(spec.row, 1)) * TILE;
      const items = row(snapshot.floes, spec.row);
      for (let i = 1; i < items.length; i += 1) {
        expect(items[i].x - items[i - 1].x).toBeCloseTo(period, 6);
      }
    }
  });

  it("reaches both edges of the strait in every lane", () => {
    const snapshot = harness.snapshot();
    for (const spec of [...ICE_LANES, ...WATER_LANES]) {
      spans(spec.row, [...snapshot.vehicles, ...snapshot.floes], 1);
    }
  });

  it("staggers each band, so no column is covered in all eight rows", () => {
    const snapshot = harness.snapshot();
    const covered = (
      items: readonly LaneItem[],
      rows: readonly number[],
      col: number,
    ): boolean =>
      rows.every((which) =>
        items.some(
          (item) =>
            item.row === which &&
            tileCX(col) >= item.x &&
            tileCX(col) < item.x + item.len * TILE,
        ),
      );
    const iceRows = ICE_LANES.map((lane) => lane.row);
    const waterRows = WATER_LANES.map((lane) => lane.row);
    for (let col = 0; col < STRAIT_W / TILE; col += 1) {
      expect(covered(snapshot.vehicles, iceRows, col)).toBe(false);
      expect(covered(snapshot.floes, waterRows, col)).toBe(false);
    }
  });

  it("gives every item a distinct id", () => {
    const snapshot = harness.snapshot();
    const ids = [
      ...snapshot.vehicles.map((item) => item.id),
      ...snapshot.floes.map((item) => item.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the per-level scaling", () => {
  it("raises every lane's speed and widens its gap on the stated schedule", () => {
    for (const level of [1, 2, 4, 7, 8]) {
      harness.debug.setLevel(level);
      const snapshot: FloeSnapshotShape = harness.snapshot();
      for (const spec of [...ICE_LANES, ...WATER_LANES]) {
        const lane = [...snapshot.iceLanes, ...snapshot.waterLanes].find(
          (entry) => entry.row === spec.row,
        );
        expect(lane?.speed).toBeCloseTo(
          spec.speed * Math.pow(LEVEL_SPEED_STEP, level - 1),
          8,
        );
        const period = (ITEM_LEN[spec.kind] + laneGap(spec.row, level)) * TILE;
        const items = row([...snapshot.vehicles, ...snapshot.floes], spec.row);
        for (let i = 1; i < items.length; i += 1) {
          expect(items[i].x - items[i - 1].x).toBeCloseTo(period, 6);
        }
      }
    }
  });

  it("states the two schedules the specification writes down", () => {
    expect(laneSpeed(11, 1)).toBeCloseTo(1.7, 10);
    expect(laneSpeed(11, 2)).toBeCloseTo(1.7 * LEVEL_SPEED_STEP, 10);
    expect(laneGap(11, 1)).toBe(8);
    expect(laneGap(11, LEVEL_GAP_EVERY + 1)).toBe(9);
    expect(laneGap(11, 2 * LEVEL_GAP_EVERY + 1)).toBe(10);
  });

  it("replaces both rosters with fresh ids and leaves the rest standing", () => {
    // The critter stands on the median: its footing is derived from the floes
    // on its row, and the relaid water band is the level's own fresh draw, so a
    // critter on a water row could read a different footing without having
    // been touched.
    harness.debug.addCritter(12, ROW_MEDIAN);
    harness.debug.setBearEmergence(false);
    harness.debug.addBear(12, 12);
    harness.debug.setBay(2, true);
    harness.debug.setScore(1234);
    const before = harness.snapshot();
    harness.debug.setLevel(5);
    const after = harness.snapshot();
    const oldIds = new Set([
      ...before.vehicles.map((item) => item.id),
      ...before.floes.map((item) => item.id),
    ]);
    for (const item of [...after.vehicles, ...after.floes]) {
      expect(oldIds.has(item.id)).toBe(false);
    }
    expect(after.critter).toEqual(before.critter);
    expect(after.bears.map((bear) => bear.id)).toEqual(
      before.bears.map((bear) => bear.id),
    );
    expect(after.bays).toEqual(before.bays);
    expect(after.score).toBe(1234);
    expect(after.screen).toBe(before.screen);
    expect(after.timer).toBe(before.timer);
  });
});

describe("lane motion", () => {
  it("moves every item of a lane at its own speed and direction", async () => {
    harness.debug.setScreen("playing");
    const before = harness.snapshot();
    await harness.step(120);
    const after = harness.snapshot();
    for (const spec of [...ICE_LANES, ...WATER_LANES]) {
      const step = spec.dir * spec.speed * TILE;
      const first = row([...before.vehicles, ...before.floes], spec.row)[0];
      const moved = [...after.vehicles, ...after.floes].find(
        (item) => item.id === first.id,
      );
      expect(moved).toBeDefined();
      const delta = (moved?.x ?? 0) - first.x;
      // One second of game time, with any whole trips around the lane's ring
      // folded out: a wrap is the same item arriving at the other edge.
      const period = (ITEM_LEN[spec.kind] + laneGap(spec.row, 1)) * TILE;
      const trackLen =
        row([...after.vehicles, ...after.floes], spec.row).length * period;
      const off = mod(delta - step, trackLen);
      expect(Math.min(off, trackLen - off)).toBeLessThan(0.5);
    }
  });

  it("keeps a lane evenly spaced across the strait's edges", async () => {
    harness.debug.setScreen("playing");
    harness.pace(10);
    await harness.step(120);
    harness.pace(1);
    const snapshot = harness.snapshot();
    for (const spec of [...ICE_LANES, ...WATER_LANES]) {
      const period = (ITEM_LEN[spec.kind] + laneGap(spec.row, 1)) * TILE;
      const items = row([...snapshot.vehicles, ...snapshot.floes], spec.row);
      for (let i = 1; i < items.length; i += 1) {
        expect(items[i].x - items[i - 1].x).toBeCloseTo(period, 4);
      }
      spans(spec.row, [...snapshot.vehicles, ...snapshot.floes], 1);
    }
  });

  it("holds a lane at a speed of zero and keeps every item's position", async () => {
    harness.debug.setScreen("playing");
    harness.debug.setLaneSpeed(11, 0);
    const before = row(harness.snapshot().vehicles, 11);
    await harness.step(240);
    const after = row(harness.snapshot().vehicles, 11);
    expect(after.map((item) => item.x)).toEqual(before.map((item) => item.x));
  });

  it("turns a lane around without repopulating it", async () => {
    harness.debug.setScreen("playing");
    harness.debug.setLaneDirection(12, -1);
    const before = row(harness.snapshot().vehicles, 12);
    expect(harness.snapshot().iceLanes.find((l) => l.row === 12)?.dir).toBe(-1);
    expect(row(harness.snapshot().vehicles, 12).map((i) => i.id)).toEqual(
      before.map((item) => item.id),
    );
    await harness.step(60);
    const after = row(harness.snapshot().vehicles, 12);
    const moved = after.find((item) => item.id === before[1].id);
    expect((moved?.x ?? 0) - before[1].x).toBeLessThan(0);
  });
});

describe("posing a roster", () => {
  it("empties a band and lays one item out exactly", () => {
    harness.debug.clearVehicles();
    harness.debug.clearFloes();
    expect(harness.snapshot().vehicles).toEqual([]);
    expect(harness.snapshot().floes).toEqual([]);

    harness.debug.addVehicle(14, "plow", 320);
    harness.debug.addFloe(5, "pan", 640);
    const snapshot = harness.snapshot();
    expect(snapshot.vehicles).toHaveLength(1);
    expect(snapshot.vehicles[0]).toMatchObject({
      row: 14,
      kind: "plow",
      x: 320,
      len: 3,
    });
    expect(snapshot.floes[0]).toMatchObject({
      row: 5,
      kind: "pan",
      x: 640,
      len: 1,
    });

    harness.debug.setVehicleX(snapshot.vehicles[0].id, 96);
    expect(harness.snapshot().vehicles[0].x).toBe(96);
    harness.debug.setFloeX(snapshot.floes[0].id, 128);
    expect(harness.snapshot().floes[0].x).toBe(128);

    harness.debug.removeVehicle(snapshot.vehicles[0].id);
    harness.debug.removeFloe(snapshot.floes[0].id);
    expect(harness.snapshot().vehicles).toEqual([]);
    expect(harness.snapshot().floes).toEqual([]);
  });

  it("appends an added item to its roster, so its id is the last", () => {
    harness.debug.clearVehicles();
    harness.debug.addVehicle(11, "plow", 0);
    harness.debug.addVehicle(12, "car", 64);
    const ids = harness.snapshot().vehicles.map((item) => item.id);
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBeGreaterThan(ids[0]);
  });
});
