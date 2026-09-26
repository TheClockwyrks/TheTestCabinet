// The bear, against `specs/hunter.md`.
//
// Every scenario poses an empty strait through the debug surface and steps it
// with `engine.advance`, so what is read back is the bear's own arithmetic and
// nothing else: the emergence, the bonus catch and the crossing timer are gated
// off, and the traffic a check is about is the traffic it added itself.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BEAR_AVOID_LEAD,
  BEAR_CATCH_DIST,
  BEAR_ICE_SPEED,
  BEAR_SPEED_STEP,
  BEAR_SWIM_SPEED,
  ROW_BAYS,
  ROW_MEDIAN,
  TICK_HZ,
  TILE,
  bearIceSpeed,
  bearSwimSpeed,
  tileCX,
  tileCY,
  tileLeft,
} from "./constants";
import { createHarness, type Harness } from "./harness.test-support";
import type { BearSnapshot } from "./game";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.dispose();
});

/** An empty strait, playing, with nothing arriving that a check did not ask for. */
function emptyStrait(h: Harness): void {
  h.debug.setScreen("playing");
  h.debug.setPhase("crossing");
  h.debug.setPhaseTimer(0);
  h.debug.setBearEmergence(false);
  h.debug.setFishCadence(false);
  h.debug.setTimerRunning(false);
  h.debug.setCatchTest(false);
  h.debug.clearVehicles();
  h.debug.clearFloes();
  h.debug.clearBears();
  h.debug.removeCritter();
}

/** The one bear on the strait. */
function bear(h: Harness): BearSnapshot {
  const bears = h.snapshot().bears;
  expect(bears).toHaveLength(1);
  return bears[0];
}

/**
 * That a second of travel covered the stated distance, within two percent.
 *
 * The tolerance is the one the specification's own figure is read to: a bear
 * posed settled on a tile chooses its step on the tick it is first stepped, and
 * travels from the tick after, so a second measured from the pose is one tick
 * short of a second of travel. No distance is lost at a tile CENTRE, which is
 * what `specs/hunter.md` fixes: the leftover of the tick that settles a bear is
 * carried into the next one.
 */
function expectSpeed(covered: number, tilesPerSecond: number): void {
  const expected = tilesPerSecond * TILE;
  expect(Math.abs(covered - expected)).toBeLessThan(0.02 * expected);
}

/** Add one bear settled on a tile, hunting a tile of its own with sense off. */
function hunter(h: Harness, col: number, row: number): number {
  h.debug.addBear(col, row);
  const id = bear(h).id;
  h.debug.setBearSense(id, false);
  return id;
}

describe("a fresh bear", () => {
  it("is settled on its tile, hunting it, with every faculty on", () => {
    emptyStrait(harness);
    harness.debug.addBear(9, 12);
    const added = bear(harness);
    expect(added).toMatchObject({
      col: 9,
      row: 12,
      stepCol: 9,
      stepRow: 12,
      x: tileCX(9),
      y: tileCY(12),
      facing: "up",
      swimming: false,
      target: { col: 9, row: 12 },
      sense: true,
      routing: true,
      travel: true,
    });
  });

  it("is appended to the roster, so the last entry is the one just added", () => {
    emptyStrait(harness);
    harness.debug.addBear(4, 12);
    harness.debug.addBear(30, 15);
    const bears = harness.snapshot().bears;
    expect(bears).toHaveLength(2);
    expect(bears[1].col).toBe(30);
    expect(bears[1].id).toBeGreaterThan(bears[0].id);

    harness.debug.removeBear(bears[0].id);
    expect(harness.snapshot().bears.map((entry) => entry.id)).toEqual([
      bears[1].id,
    ]);
    harness.debug.clearBears();
    expect(harness.snapshot().bears).toEqual([]);
  });
});

describe("which tiles a bear may enter", () => {
  it("refuses a step off the grid, and one into the far shore", async () => {
    emptyStrait(harness);
    const id = hunter(harness, 0, ROW_BAYS + 1);
    harness.debug.setBearRouting(id, false);

    harness.debug.setBearStep(id, "left");
    expect(bear(harness)).toMatchObject({ stepCol: 0, stepRow: 2 });
    harness.debug.setBearStep(id, "up");
    // The far shore is closed, so the step is refused and the facing still turns.
    expect(bear(harness)).toMatchObject({
      stepCol: 0,
      stepRow: 2,
      facing: "up",
    });
    await harness.step(30);
    expect(bear(harness)).toMatchObject({ col: 0, row: 2, x: tileCX(0) });
  });

  it("refuses a step into a tile a vehicle covers", () => {
    emptyStrait(harness);
    const id = hunter(harness, 10, ROW_MEDIAN);
    harness.debug.setBearRouting(id, false);
    harness.debug.addVehicle(11, "plow", tileCX(10) - TILE);

    harness.debug.setBearStep(id, "down");
    expect(bear(harness)).toMatchObject({
      stepRow: ROW_MEDIAN,
      facing: "down",
    });

    harness.debug.setBearStep(id, "right");
    expect(bear(harness)).toMatchObject({ stepCol: 11, stepRow: ROW_MEDIAN });
  });
});

describe("the glide", () => {
  it("occupies both tiles while it is between them", async () => {
    emptyStrait(harness);
    const id = hunter(harness, 10, ROW_MEDIAN);
    harness.debug.setBearRouting(id, false);
    harness.debug.setBearStep(id, "right");
    await harness.step(2);
    const mid = bear(harness);
    expect(mid.col).toBe(10);
    expect(mid.row).toBe(ROW_MEDIAN);
    expect(mid.stepCol).toBe(11);
    expect(mid.stepRow).toBe(ROW_MEDIAN);
    expect(mid.x).toBeGreaterThan(tileCX(10));
    expect(mid.x).toBeLessThan(tileCX(11));
  });

  it("moves along one axis a tick, and settles exactly on a tile centre", async () => {
    emptyStrait(harness);
    const id = hunter(harness, 10, ROW_MEDIAN);
    harness.debug.setBearTarget(id, 30, ROW_MEDIAN);
    let previous = bear(harness);
    let settled = 0;
    for (let tick = 0; tick < 200; tick += 1) {
      await harness.step(1);
      const now = bear(harness);
      const movedX = Math.abs(now.x - previous.x) > 1e-9;
      const movedY = Math.abs(now.y - previous.y) > 1e-9;
      expect(movedX && movedY).toBe(false);
      if (now.facing !== previous.facing) {
        // A step, and with it the facing, changes only on a tile centre.
        expect(now.x).toBeCloseTo(tileCX(now.col), 9);
        expect(now.y).toBeCloseTo(tileCY(now.row), 9);
      }
      if (now.x === tileCX(now.col) && now.y === tileCY(now.row)) settled += 1;
      previous = now;
    }
    expect(settled).toBeGreaterThan(3);
    expect(previous.col).toBeGreaterThan(10);
  });

  it("travels BEAR_ICE_SPEED tiles a second on ice", async () => {
    emptyStrait(harness);
    const id = hunter(harness, 2, ROW_MEDIAN);
    harness.debug.setBearTarget(id, 39, ROW_MEDIAN);
    const from = bear(harness).x;
    await harness.step(TICK_HZ);
    expectSpeed(bear(harness).x - from, BEAR_ICE_SPEED);
    expect(bearIceSpeed(1)).toBeCloseTo(BEAR_ICE_SPEED, 9);
  });

  it("travels BEAR_SWIM_SPEED tiles a second over open water", async () => {
    emptyStrait(harness);
    const id = hunter(harness, 2, 5);
    harness.debug.setBearTarget(id, 39, 5);
    // The tile it is travelling into is its own, a water row no floe covers.
    expect(bear(harness).swimming).toBe(true);
    const from = bear(harness).x;
    await harness.step(TICK_HZ);
    expectSpeed(bear(harness).x - from, BEAR_SWIM_SPEED);
    expect(bear(harness).swimming).toBe(true);
  });

  it("reads a floe as ice footing", async () => {
    emptyStrait(harness);
    const id = hunter(harness, 2, 5);
    harness.debug.setBearTarget(id, 39, 5);
    harness.debug.setLaneSpeed(5, 0);
    for (let col = 0; col < 40; col += 4) {
      harness.debug.addFloe(5, "raft4", col * TILE);
    }
    const from = bear(harness).x;
    await harness.step(TICK_HZ);
    expectSpeed(bear(harness).x - from, BEAR_ICE_SPEED);
    expect(bear(harness).swimming).toBe(false);
  });

  it("speeds up by BEAR_SPEED_STEP each level", async () => {
    emptyStrait(harness);
    harness.debug.setLevel(5);
    const id = hunter(harness, 2, ROW_MEDIAN);
    harness.debug.clearVehicles();
    harness.debug.setBearTarget(id, 39, ROW_MEDIAN);
    const from = bear(harness).x;
    await harness.step(TICK_HZ);
    const expected = BEAR_ICE_SPEED * Math.pow(BEAR_SPEED_STEP, 4);
    expectSpeed(bear(harness).x - from, expected);
    expect(bearIceSpeed(5)).toBeCloseTo(expected, 9);
    expect(bearSwimSpeed(5)).toBeCloseTo(
      BEAR_SWIM_SPEED * Math.pow(BEAR_SPEED_STEP, 4),
      9,
    );
  });
});

describe("hunting and routing", () => {
  it("reads the critter's tile every tick while its sense is on", async () => {
    emptyStrait(harness);
    harness.debug.addCritter(30, 15);
    harness.debug.addBear(4, 12);
    const id = bear(harness).id;
    await harness.step(1);
    expect(bear(harness).target).toEqual({ col: 30, row: 15 });

    harness.debug.setBearSense(id, false);
    harness.debug.setCritterTile(6, 18);
    await harness.step(1);
    expect(bear(harness).target).toEqual({ col: 30, row: 15 });
  });

  it("closes on the critter", async () => {
    emptyStrait(harness);
    harness.debug.addCritter(20, ROW_MEDIAN);
    harness.debug.addBear(10, ROW_MEDIAN);
    const before = bear(harness).x;
    await harness.step(TICK_HZ);
    expect(bear(harness).x).toBeGreaterThan(before + 90);
  });

  it("routes around a vehicle standing in its way", async () => {
    emptyStrait(harness);
    const id = hunter(harness, 10, 15);
    harness.debug.setBearTarget(id, 14, 15);
    // A parked plow covering the three tiles ahead of it on its own row.
    harness.debug.setLaneSpeed(15, 0);
    harness.debug.addVehicle(15, "plow", tileCX(11) - TILE / 2);
    let left = false;
    for (let tick = 0; tick < 240 && !left; tick += 1) {
      await harness.step(1);
      if (bear(harness).row !== 15) left = true;
    }
    expect(left).toBe(true);
    // It never stood on a tile the plow covered.
    expect(bear(harness).col).toBeLessThanOrEqual(11);
  });

  it("will not step into a tile a vehicle reaches inside BEAR_AVOID_LEAD", async () => {
    emptyStrait(harness);
    const id = hunter(harness, 20, 15);
    harness.debug.setBearTarget(id, 24, 15);
    // A car one lead-second of travel to the right of the tile it wants next.
    const speed = harness.snapshot().iceLanes.find((l) => l.row === 15)?.speed;
    expect(speed).toBeGreaterThan(0);
    harness.debug.setLaneDirection(15, -1);
    harness.debug.addVehicle(
      15,
      "car",
      tileCX(21) + (speed ?? 0) * TILE * BEAR_AVOID_LEAD * 0.5,
    );
    await harness.step(1);
    expect(bear(harness).stepCol).not.toBe(21);
  });

  it("commits no step into a tile a running lane is about to sweep", async () => {
    // Twelve fresh attempts, each sending a bear off the median into a running
    // ice lane, so the lead is read over a dozen committed steps rather than
    // over one bear's luck.
    let steps = 0;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      emptyStrait(harness);
      harness.debug.setLaneSpeed(11, 3);
      harness.debug.setLaneDirection(11, 1);
      for (let col = attempt % 9; col < 40; col += 9) {
        harness.debug.addVehicle(11, "car", tileLeft(col));
      }
      const col = 6 + attempt * 2;
      const id = hunter(harness, col, ROW_MEDIAN);
      harness.debug.setBearTarget(id, col, 12);

      for (let tick = 0; tick < TICK_HZ * 2; tick += 1) {
        await harness.step(1);
        const bears = harness.snapshot().bears;
        if (bears.length === 0) break;
        const now = bears[0];
        if (now.stepRow !== 11) continue;
        // The tile it committed to is not covered now, and no vehicle of that
        // lane reaches it within the lead.
        const lane = harness.snapshot().iceLanes.find((l) => l.row === 11);
        const centre = tileCX(now.stepCol);
        const travel =
          (lane?.dir ?? 1) * (lane?.speed ?? 0) * TILE * BEAR_AVOID_LEAD;
        for (const vehicle of harness.snapshot().vehicles) {
          if (vehicle.row !== 11) continue;
          const from = Math.min(vehicle.x, vehicle.x + travel);
          const to =
            Math.max(vehicle.x, vehicle.x + travel) + TILE * vehicle.len;
          expect(centre >= from && centre < to).toBe(false);
        }
        steps += 1;
        break;
      }
    }
    expect(steps).toBeGreaterThan(3);
  });

  it("routes through the one gap in a wall of parked traffic", async () => {
    emptyStrait(harness);
    harness.debug.addCritter(20, 12);
    harness.debug.addBear(20, ROW_MEDIAN);
    harness.debug.setLaneSpeed(11, 0);
    for (let col = 0; col < 40; col += 3) {
      if (col >= 29 && col <= 32) continue;
      harness.debug.addVehicle(11, "plow", tileLeft(col));
    }
    const reached = await harness.until(
      () => harness.snapshot().bears[0]?.row === 12,
      TICK_HZ * 12,
    );
    expect(reached).toBe(true);
  });

  it("steps to the open neighbour closest to the target when no route exists", async () => {
    emptyStrait(harness);
    const id = hunter(harness, 20, 15);
    // The target is in the far shore, which is closed to a bear, so no route to
    // it exists at all: the fallback is the neighbour least far in tile distance.
    harness.debug.setBearTarget(id, 20, ROW_BAYS);
    await harness.step(1);
    expect(bear(harness).stepRow).toBe(14);
    expect(bear(harness).facing).toBe("up");
  });

  it("stands still when no neighbouring tile is open", async () => {
    emptyStrait(harness);
    const id = hunter(harness, 20, 15);
    harness.debug.setBearTarget(id, 30, 15);
    harness.debug.setLaneSpeed(14, 0);
    harness.debug.setLaneSpeed(15, 0);
    harness.debug.setLaneSpeed(16, 0);
    harness.debug.addVehicle(14, "plow", tileCX(20) - TILE / 2);
    harness.debug.addVehicle(16, "plow", tileCX(20) - TILE / 2);
    harness.debug.addVehicle(15, "car", tileCX(19) - TILE / 2);
    harness.debug.addVehicle(15, "car", tileCX(21) - TILE / 2);
    const before = bear(harness);
    await harness.step(60);
    const after = bear(harness);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.stepCol).toBe(20);
    expect(after.stepRow).toBe(15);
  });
});

describe("the three faculties", () => {
  it("holds a bear still with travel off, leaving its route chosen", async () => {
    emptyStrait(harness);
    const id = hunter(harness, 20, 15);
    harness.debug.setBearTarget(id, 20, 12);
    harness.debug.setBearTravel(id, false);
    await harness.step(120);
    const held = bear(harness);
    expect(held.x).toBe(tileCX(20));
    expect(held.y).toBeCloseTo(tileCY(15), 9);
    expect(held.stepRow).toBe(14);
    expect(held.travel).toBe(false);
    expect(held.target).toEqual({ col: 20, row: 12 });
  });

  it("takes no new step with routing off, and still finishes the one it is on", async () => {
    emptyStrait(harness);
    const id = hunter(harness, 20, 15);
    harness.debug.setBearRouting(id, false);
    harness.debug.setBearStep(id, "up");
    await harness.step(120);
    const held = bear(harness);
    expect(held.row).toBe(14);
    expect(held.stepRow).toBe(14);
    expect(held.routing).toBe(false);
  });

  it("keeps hunting the posed tile with its sense off", async () => {
    emptyStrait(harness);
    harness.debug.addCritter(2, 18);
    harness.debug.addBear(20, 15);
    const id = bear(harness).id;
    harness.debug.setBearSense(id, false);
    harness.debug.setBearTarget(id, 30, 15);
    await harness.step(60);
    expect(bear(harness).target).toEqual({ col: 30, row: 15 });
    expect(bear(harness).x).toBeGreaterThan(tileCX(20));
  });

  it("reads all three faculties back off the snapshot", () => {
    emptyStrait(harness);
    const id = hunter(harness, 20, 15);
    harness.debug.setBearRouting(id, false);
    harness.debug.setBearTravel(id, false);
    expect(bear(harness)).toMatchObject({
      sense: false,
      routing: false,
      travel: false,
    });
    harness.debug.setBearSense(id, true);
    harness.debug.setBearRouting(id, true);
    harness.debug.setBearTravel(id, true);
    expect(bear(harness)).toMatchObject({
      sense: true,
      routing: true,
      travel: true,
    });
  });
});

describe("posing a bear's position", () => {
  it("settles it on a tile, leaving its target and faculties alone", () => {
    emptyStrait(harness);
    const id = hunter(harness, 20, 15);
    harness.debug.setBearTarget(id, 4, 4);
    harness.debug.setBearStep(id, "up");
    harness.debug.setBearTile(id, 7, 12);
    expect(bear(harness)).toMatchObject({
      col: 7,
      row: 12,
      stepCol: 7,
      stepRow: 12,
      x: tileCX(7),
      y: tileCY(12),
      target: { col: 4, row: 4 },
      sense: false,
    });
  });

  it("places its centre mid-glide, leaving both tiles as they stand", () => {
    emptyStrait(harness);
    const id = hunter(harness, 20, 15);
    harness.debug.setBearRouting(id, false);
    harness.debug.setBearStep(id, "right");
    harness.debug.setBearPosition(id, tileCX(20) + 9, tileCY(15));
    expect(bear(harness)).toMatchObject({
      col: 20,
      row: 15,
      stepCol: 21,
      stepRow: 15,
      x: tileCX(20) + 9,
    });
  });
});

describe("leaving the strait", () => {
  it("is removed by a vehicle arriving on either tile it occupies", async () => {
    emptyStrait(harness);
    const id = hunter(harness, 20, 15);
    harness.debug.setBearRouting(id, false);
    harness.debug.setBearTravel(id, false);
    harness.debug.setLaneSpeed(15, 2);
    harness.debug.setLaneDirection(15, 1);
    harness.debug.addVehicle(15, "car", tileCX(20) - 6 * TILE);
    const removed = await harness.until(
      () => harness.snapshot().bears.length === 0,
      TICK_HZ * 3,
    );
    expect(removed).toBe(true);
  });

  it("is left alone by a vehicle in a lane held at a speed of zero", async () => {
    emptyStrait(harness);
    const id = hunter(harness, 20, 15);
    harness.debug.setBearRouting(id, false);
    harness.debug.setBearTravel(id, false);
    harness.debug.setLaneSpeed(15, 0);
    harness.debug.addVehicle(15, "car", tileCX(20) - TILE / 2);
    await harness.step(120);
    expect(harness.snapshot().bears).toHaveLength(1);
  });
});

describe("catching the critter", () => {
  it("costs a life within BEAR_CATCH_DIST of the critter's centre", async () => {
    emptyStrait(harness);
    harness.debug.setCatchTest(true);
    harness.debug.addCritter(20, ROW_MEDIAN);
    const id = hunter(harness, 20, ROW_MEDIAN);
    harness.debug.setBearTravel(id, false);
    harness.debug.setBearPosition(
      id,
      tileCX(20) + BEAR_CATCH_DIST + 2,
      tileCY(ROW_MEDIAN),
    );
    await harness.step(1);
    expect(harness.snapshot().lives).toBe(3);

    harness.debug.setBearPosition(
      id,
      tileCX(20) + BEAR_CATCH_DIST - 1,
      tileCY(ROW_MEDIAN),
    );
    await harness.step(1);
    const caught = harness.snapshot();
    expect(caught.lives).toBe(2);
    expect(caught.phase).toBe("dying");
    expect(caught.bears).toEqual([]);
  });

  it("costs nothing with the catch test off", async () => {
    emptyStrait(harness);
    harness.debug.addCritter(20, ROW_MEDIAN);
    const id = hunter(harness, 20, ROW_MEDIAN);
    harness.debug.setBearTravel(id, false);
    harness.debug.setBearPosition(id, tileCX(20), tileCY(ROW_MEDIAN));
    await harness.step(TICK_HZ);
    const held = harness.snapshot();
    expect(held.lives).toBe(3);
    expect(held.phase).toBe("crossing");
    expect(held.catchTest).toBe(false);
  });
});
