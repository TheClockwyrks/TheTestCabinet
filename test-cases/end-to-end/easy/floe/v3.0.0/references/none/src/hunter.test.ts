// The bear: the glide, its two speeds, the tiles closed to it, the routing rule
// and its two fallbacks, what takes it off the strait, and the catch.
//
// Every scenario is posed through the debugging surface and then let run. A bear
// is driven one of two ways: with its routing on, so the game chooses its steps,
// or with routing off and one step committed, so a reading is a rate rather than
// a route. Which of the two a check uses is stated where it matters.

import { describe, expect, it } from "vitest";
import {
  BEAR_CATCH_DIST,
  BEAR_EMERGE_DELAY,
  BEAR_SECOND_DELAY,
  ICE_TOP,
  ROW_BAYS,
  ROW_MEDIAN,
  ROW_NEAR,
  START_COL,
  START_LIVES,
  TICK_DT,
  TILE,
  WATER_TOP,
  bearIceSpeed,
  bearSwimSpeed,
  tileCX,
  tileCY,
  tileLeft,
} from "./constants";
import {
  harness,
  lastId,
  startCrossing,
  type Harness,
} from "./harness.test-support";

/** The ticks covering a stretch of game time, rounded to a whole tick. */
function ticks(seconds: number): number {
  return Math.round(seconds / TICK_DT);
}

/** The only bear on the strait. */
function bear(h: Harness) {
  const bears = h.api.snapshot().bears;
  expect(bears.length).toBe(1);
  return bears[0];
}

/**
 * Pose one bear and hand back its id, holding off whichever of its three
 * faculties the scenario does not exercise.
 */
function poseBear(
  h: Harness,
  col: number,
  row: number,
  off: ("sense" | "routing" | "travel")[] = [],
): number {
  h.api.addBear(col, row);
  const id = lastId(h.api.snapshot().bears);
  if (off.includes("sense")) h.api.setBearSense(id, false);
  if (off.includes("routing")) h.api.setBearRouting(id, false);
  if (off.includes("travel")) h.api.setBearTravel(id, false);
  return id;
}

describe("emerging", () => {
  it("emerges on the near shore in the critter's column, once the critter has advanced", () => {
    const h = harness();
    startCrossing(h);
    h.api.setCritterTile(START_COL, ROW_NEAR - 3);
    h.api.setBestRow(ROW_NEAR - 3);
    h.api.setBearEmergence(true);

    h.advance(ticks(BEAR_EMERGE_DELAY) - 1);
    expect(h.api.snapshot().bears).toEqual([]);
    h.advance(1);
    const hunter = bear(h);
    expect(hunter.row).toBe(ROW_NEAR);
    expect(hunter.col).toBe(START_COL);
    expect(hunter.sense).toBe(true);
    expect(hunter.routing).toBe(true);
    expect(hunter.travel).toBe(true);
  });

  it("does not hunt a critter that has stayed on the near shore", () => {
    const h = harness();
    startCrossing(h);
    h.api.setBearEmergence(true);
    h.seconds(30);
    expect(h.api.snapshot().bears).toEqual([]);
  });

  it("sends a second hunter from level five, on its own stagger", () => {
    const h = harness();
    startCrossing(h, 5);
    h.api.setLevel(5);
    h.api.clearVehicles();
    h.api.clearFloes();
    h.api.setBestRow(ROW_NEAR - 6);
    h.api.setBearEmergence(true);

    h.advance(ticks(BEAR_EMERGE_DELAY));
    expect(h.api.snapshot().bears.length).toBe(1);
    h.advance(ticks(BEAR_SECOND_DELAY) - 1);
    expect(h.api.snapshot().bears.length).toBe(1);
    h.advance(1);
    expect(h.api.snapshot().bears.length).toBe(2);
  });

  it("sends one hunter below level five and never more than two above it", () => {
    const one = harness();
    startCrossing(one, 4);
    one.api.setLevel(4);
    one.api.clearVehicles();
    one.api.clearFloes();
    one.api.setBestRow(ROW_NEAR - 12);
    one.api.setBearEmergence(true);
    let mostOfOne = 0;
    for (let i = 0; i < 60; i += 1) {
      one.seconds(1);
      mostOfOne = Math.max(mostOfOne, one.api.snapshot().bears.length);
    }
    expect(mostOfOne).toBe(1);

    const two = harness();
    startCrossing(two, 8);
    two.api.setLevel(8);
    two.api.clearVehicles();
    two.api.clearFloes();
    two.api.setBestRow(ROW_NEAR - 12);
    two.api.setBearEmergence(true);
    let mostOfTwo = 0;
    for (let i = 0; i < 60; i += 1) {
      two.seconds(1);
      mostOfTwo = Math.max(mostOfTwo, two.api.snapshot().bears.length);
    }
    expect(mostOfTwo).toBe(2);
  });
});

describe("the glide", () => {
  it("glides between the two tile centres rather than jumping tile to tile", () => {
    const h = harness();
    startCrossing(h);
    const id = poseBear(h, 20, ROW_MEDIAN, ["sense", "routing"]);
    h.api.setBearStep(id, "right");

    let between = 0;
    for (let i = 0; i < 8; i += 1) {
      h.advance(1);
      const hunter = bear(h);
      if (hunter.x > tileCX(20) && hunter.x < tileCX(21)) between += 1;
    }
    expect(between).toBe(8);
  });

  it("moves one axis a tick, and changes axis only on a tile centre", () => {
    const h = harness();
    startCrossing(h);
    h.api.setCritterTile(START_COL - 10, ROW_NEAR - 4);
    poseBear(h, START_COL, ROW_NEAR);

    let previous = bear(h);
    for (let i = 0; i < ticks(4); i += 1) {
      h.advance(1);
      const hunter = bear(h);
      const axis = (b: typeof hunter): string =>
        b.stepCol !== b.col ? "x" : b.stepRow !== b.row ? "y" : "none";
      expect(hunter.x !== previous.x && hunter.y !== previous.y).toBe(false);
      if (
        axis(hunter) !== axis(previous) &&
        axis(hunter) !== "none" &&
        axis(previous) !== "none"
      ) {
        expect(hunter.x).toBe(tileCX(hunter.col));
        expect(hunter.y).toBe(tileCY(hunter.row));
      }
      previous = hunter;
    }
  });

  it("reports the tile it is leaving and the tile it is entering", () => {
    const h = harness();
    startCrossing(h);
    const id = poseBear(h, 20, ROW_MEDIAN, ["sense", "routing"]);
    const settled = bear(h);
    expect([settled.stepCol, settled.stepRow]).toEqual([
      settled.col,
      settled.row,
    ]);

    h.api.setBearStep(id, "up");
    h.advance(1);
    const gliding = bear(h);
    expect([gliding.col, gliding.row]).toEqual([20, ROW_MEDIAN]);
    expect([gliding.stepCol, gliding.stepRow]).toEqual([20, ROW_MEDIAN - 1]);
    expect(gliding.facing).toBe("up");
  });

  it("covers its ice speed across the median and its swim speed over open water", () => {
    const ice = harness();
    startCrossing(ice);
    ice.api.setCritterTile(0, ROW_NEAR);
    const iceId = poseBear(ice, 30, ROW_MEDIAN, ["sense"]);
    ice.api.setBearTarget(iceId, 0, ROW_MEDIAN);
    const iceFrom = bear(ice).x;
    ice.advance(120);
    expect(Math.abs(bear(ice).x - iceFrom)).toBeCloseTo(
      bearIceSpeed(1) * TILE,
      6,
    );

    const swim = harness();
    startCrossing(swim);
    swim.api.setCritterTile(0, ROW_NEAR);
    const swimId = poseBear(swim, 30, WATER_TOP + 3, ["sense"]);
    swim.api.setBearTarget(swimId, 0, WATER_TOP + 3);
    const swimFrom = bear(swim).x;
    swim.advance(120);
    expect(Math.abs(bear(swim).x - swimFrom)).toBeCloseTo(
      bearSwimSpeed(1) * TILE,
      6,
    );
  });

  it("treats a floe as ice footing, and reports swimming only over open water", () => {
    const h = harness();
    startCrossing(h);
    const row = WATER_TOP + 3;
    for (let col = -4; col < 44; col += 4) {
      h.api.addFloe(row, "raft4", tileLeft(col));
    }
    h.api.setLaneSpeed(row, 0);
    h.api.setCritterTile(0, ROW_NEAR);
    const id = poseBear(h, 30, row, ["sense"]);
    h.api.setBearTarget(id, 0, row);
    expect(bear(h).swimming).toBe(false);
    const from = bear(h).x;
    h.advance(120);
    expect(Math.abs(bear(h).x - from)).toBeCloseTo(bearIceSpeed(1) * TILE, 6);

    h.api.clearFloes();
    expect(bear(h).swimming).toBe(true);
    h.api.setBearTile(id, 30, ROW_MEDIAN);
    expect(bear(h).swimming).toBe(false);
  });

  it("speeds up six percent a level", () => {
    for (const level of [1, 4, 8]) {
      const h = harness();
      startCrossing(h, level);
      h.api.setLevel(level);
      h.api.clearVehicles();
      h.api.clearFloes();
      h.api.setCritterTile(0, ROW_NEAR);
      const id = poseBear(h, 30, ROW_MEDIAN, ["sense"]);
      h.api.setBearTarget(id, 0, ROW_MEDIAN);
      const from = bear(h).x;
      h.advance(120);
      expect(Math.abs(bear(h).x - from)).toBeCloseTo(
        bearIceSpeed(level) * TILE,
        6,
      );
      expect(bearIceSpeed(level)).toBeCloseTo(3 * 1.06 ** (level - 1), 9);
      expect(bearSwimSpeed(level)).toBeCloseTo(2 * 1.06 ** (level - 1), 9);
    }
  });
});

describe("hunting and routing", () => {
  it("hunts the critter's tile, refreshed every tick", () => {
    const h = harness();
    startCrossing(h);
    h.api.setCritterTile(4, ROW_NEAR);
    poseBear(h, 30, ROW_NEAR);
    h.advance(1);
    expect(bear(h).target).toEqual({ col: 4, row: ROW_NEAR });

    h.api.setCritterTile(9, ROW_MEDIAN);
    h.advance(1);
    expect(bear(h).target).toEqual({ col: 9, row: ROW_MEDIAN });
  });

  it("closes on the critter over an emptied strait", () => {
    const h = harness();
    startCrossing(h);
    h.api.setCritterTile(START_COL, ROW_MEDIAN);
    poseBear(h, START_COL + 12, ROW_NEAR);
    const distance = (): number => {
      const hunter = bear(h);
      return (
        Math.abs(hunter.col - START_COL) + Math.abs(hunter.row - ROW_MEDIAN)
      );
    };
    const before = distance();
    h.seconds(3);
    expect(distance()).toBeLessThan(before);
  });

  it("routes around a wall of parked traffic, through its one gap", () => {
    const h = harness();
    startCrossing(h);
    h.api.setLaneSpeed(ICE_TOP, 0);
    // Every tile of the row but the pair around column 30.
    for (let col = 0; col < 40; col += 2) {
      if (col === 30) continue;
      h.api.addVehicle(ICE_TOP, "car", tileLeft(col));
    }
    h.api.setCritterTile(30, ICE_TOP - 1);
    poseBear(h, 24, ICE_TOP + 1);

    for (let i = 0; i < ticks(6); i += 1) {
      h.advance(1);
      const hunter = bear(h);
      // Never commits a step into a tile a vehicle covers.
      const covered = h.api
        .snapshot()
        .vehicles.some(
          (item) =>
            item.row === hunter.stepRow &&
            tileCX(hunter.stepCol) >= item.x &&
            tileCX(hunter.stepCol) < item.x + TILE * item.len,
        );
      expect(covered).toBe(false);
    }
    expect(bear(h).row).toBeLessThanOrEqual(ICE_TOP);
  });

  it("steps toward the target when no open route to it exists", () => {
    const h = harness();
    startCrossing(h);
    h.api.setLaneSpeed(ICE_TOP, 0);
    for (let col = 0; col < 40; col += 2) {
      h.api.addVehicle(ICE_TOP, "car", tileLeft(col));
    }
    h.api.setCritterTile(4, ICE_TOP - 1);
    poseBear(h, 20, ICE_TOP + 1);
    h.advance(1);
    const hunter = bear(h);
    // No route exists through the sealed row, so it takes the open neighbour
    // that shortens the tile distance: leftward along its own row.
    expect(hunter.stepRow).toBe(ICE_TOP + 1);
    expect(hunter.stepCol).toBe(19);
  });

  it("stands still when no neighbouring tile is open", () => {
    const h = harness();
    startCrossing(h);
    h.api.setLaneSpeed(ROW_MEDIAN - 1, 0);
    h.api.setLaneSpeed(ROW_MEDIAN + 1, 0);
    h.api.addVehicle(ROW_MEDIAN, "car", tileLeft(21));
    h.api.addVehicle(ROW_MEDIAN, "car", tileLeft(18));
    h.api.addVehicle(ROW_MEDIAN - 1, "car", tileLeft(20));
    h.api.addVehicle(ROW_MEDIAN + 1, "car", tileLeft(20));
    h.api.setCritterTile(0, ROW_NEAR);
    poseBear(h, 20, ROW_MEDIAN);

    const before = bear(h);
    h.seconds(3);
    const after = bear(h);
    expect([after.x, after.y]).toEqual([before.x, before.y]);
    expect([after.stepCol, after.stepRow]).toEqual([after.col, after.row]);
  });

  it("keeps out of a tile a moving lane is about to cover", () => {
    const h = harness();
    startCrossing(h);
    // Plows running rightward along the row below the median, at a speed that
    // carries one more than a tile inside the look-ahead.
    h.api.setLaneDirection(ICE_TOP, 1);
    h.api.setLaneSpeed(ICE_TOP, 4);
    for (let col = -6; col < 40; col += 6) {
      h.api.addVehicle(ICE_TOP, "plow", tileLeft(col));
    }
    // Travel is held off and the bear is re-settled on the median before every
    // tick, so what is read is the routing's own choice over and over, taken
    // against a lane in a different phase each time and with nothing moving.
    h.api.setCritterTile(20, ROW_NEAR);
    const id = poseBear(h, 20, ROW_MEDIAN, ["travel"]);

    let stepsIntoTheLane = 0;
    for (let i = 0; i < ticks(10); i += 1) {
      h.api.setBearTile(id, 20, ROW_MEDIAN);
      h.advance(1);
      const hunter = bear(h);
      if (hunter.stepRow !== ICE_TOP) continue;
      stepsIntoTheLane += 1;
      const swept = h.api.snapshot().vehicles.some((item) => {
        const travel = 4 * TILE * 0.35;
        return (
          item.row === ICE_TOP &&
          tileCX(hunter.stepCol) >= item.x &&
          tileCX(hunter.stepCol) < item.x + travel + TILE * item.len
        );
      });
      expect(swept).toBe(false);
    }
    // The lane is not a wall: the bear does step into it when it is clear.
    expect(stepsIntoTheLane).toBeGreaterThan(0);
  });
});

describe("what a bear may not do", () => {
  it("is refused a step onto a tile a vehicle covers, and is left unharmed", () => {
    const h = harness();
    startCrossing(h);
    h.api.setLaneSpeed(ICE_TOP, 0);
    h.api.addVehicle(ICE_TOP, "car", tileLeft(21));
    const id = poseBear(h, 20, ICE_TOP, ["sense", "routing"]);

    h.api.setBearStep(id, "right");
    h.advance(1);
    const hunter = bear(h);
    expect([hunter.col, hunter.row]).toEqual([20, ICE_TOP]);
    expect([hunter.stepCol, hunter.stepRow]).toEqual([20, ICE_TOP]);
    expect(hunter.x).toBe(tileCX(20));
  });

  it("is refused the far shore, from row two and from the bay row alike", () => {
    const h = harness();
    startCrossing(h);
    const id = poseBear(h, 10, WATER_TOP, ["sense", "routing"]);
    h.api.setBearStep(id, "up");
    h.advance(1);
    expect(bear(h).row).toBe(WATER_TOP);
    expect(bear(h).stepRow).toBe(WATER_TOP);

    h.api.setBearTile(id, 10, ROW_BAYS);
    h.api.setBearStep(id, "up");
    h.advance(1);
    expect(bear(h).row).toBe(ROW_BAYS);
    expect(bear(h).stepRow).toBe(ROW_BAYS);
  });

  it("is refused a step off the grid", () => {
    const h = harness();
    startCrossing(h);
    const id = poseBear(h, 0, ROW_MEDIAN, ["sense", "routing"]);
    h.api.setBearStep(id, "left");
    h.advance(1);
    expect(bear(h).stepCol).toBe(0);
  });
});

describe("leaving the strait", () => {
  it("is taken off by traffic arriving on the tile it is leaving", () => {
    const h = harness();
    startCrossing(h);
    const id = poseBear(h, 20, ICE_TOP, ["sense", "routing"]);
    h.api.setLaneSpeed(ICE_TOP, 0);
    h.api.setBearStep(id, "right");
    h.advance(10);
    expect(bear(h).stepCol).toBe(21);

    h.api.addVehicle(ICE_TOP, "car", tileLeft(19));
    h.api.setLaneSpeed(ICE_TOP, 1);
    h.advance(1);
    expect(h.api.snapshot().bears).toEqual([]);
  });

  it("is taken off by traffic arriving on the tile it is entering", () => {
    const h = harness();
    startCrossing(h);
    const id = poseBear(h, 20, ICE_TOP, ["sense", "routing"]);
    h.api.setLaneSpeed(ICE_TOP, 0);
    h.api.setBearStep(id, "right");
    h.advance(10);

    h.api.addVehicle(ICE_TOP, "car", tileLeft(21));
    h.api.setLaneSpeed(ICE_TOP, 1);
    h.advance(1);
    expect(h.api.snapshot().bears).toEqual([]);
  });

  it("is left standing by a parked vehicle on its own tile", () => {
    const h = harness();
    startCrossing(h);
    poseBear(h, 20, ICE_TOP, ["sense", "routing"]);
    h.api.setLaneSpeed(ICE_TOP, 0);
    h.api.addVehicle(ICE_TOP, "car", tileLeft(20));
    h.seconds(3);
    expect(h.api.snapshot().bears.length).toBe(1);
  });

  it("comes back on the usual conditions once traffic has reset it", () => {
    const h = harness();
    startCrossing(h);
    h.api.setCritterTile(START_COL, ROW_NEAR - 4);
    h.api.setBestRow(ROW_NEAR - 4);
    h.api.setBearEmergence(true);
    h.advance(ticks(BEAR_EMERGE_DELAY));
    expect(h.api.snapshot().bears.length).toBe(1);
    const first = bear(h).id;

    h.api.setBearTile(first, 20, ICE_TOP);
    h.api.setLaneSpeed(ICE_TOP, 1);
    h.api.addVehicle(ICE_TOP, "car", tileLeft(20));
    h.advance(1);
    expect(h.api.snapshot().bears).toEqual([]);

    h.advance(ticks(BEAR_EMERGE_DELAY));
    const replacement = bear(h);
    expect(replacement.id).not.toBe(first);
    expect(replacement.row).toBe(ROW_NEAR);
  });

  it("leaves with the critter, on a death and on a completed crossing", () => {
    const death = harness();
    startCrossing(death);
    poseBear(death, 4, ROW_MEDIAN, ["sense", "routing", "travel"]);
    poseBear(death, 8, ROW_MEDIAN, ["sense", "routing", "travel"]);
    death.api.setCritterTile(20, WATER_TOP);
    death.advance(1);
    expect(death.api.snapshot().phase).toBe("dying");
    expect(death.api.snapshot().bears).toEqual([]);

    const bay = harness();
    startCrossing(bay);
    poseBear(bay, 4, ROW_MEDIAN, ["sense", "routing", "travel"]);
    poseBear(bay, 8, ROW_MEDIAN, ["sense", "routing", "travel"]);
    bay.api.addFloe(WATER_TOP, "raft3", tileLeft(2));
    bay.api.setLaneSpeed(WATER_TOP, 0);
    bay.api.setCritterTile(3, WATER_TOP);
    bay.hold("up");
    bay.advance(1);
    expect(bay.api.snapshot().bays[0]).toBe(true);
    expect(bay.api.snapshot().bears).toEqual([]);
  });
});

describe("catching the critter", () => {
  it("catches inside the catch distance and costs a life", () => {
    const h = harness();
    startCrossing(h);
    h.api.setCatchTest(true);
    h.api.setCritterTile(20, ROW_MEDIAN);
    const id = poseBear(h, 20, ROW_MEDIAN, ["sense", "routing", "travel"]);
    h.api.setBearPosition(
      id,
      tileCX(20) + BEAR_CATCH_DIST - 1,
      tileCY(ROW_MEDIAN),
    );
    h.advance(1);
    expect(h.api.snapshot().lives).toBe(START_LIVES - 1);
    expect(h.api.snapshot().phase).toBe("dying");
    expect(h.bus.cues).toContain("caught");
  });

  it("catches nothing beyond it", () => {
    const h = harness();
    startCrossing(h);
    h.api.setCatchTest(true);
    h.api.setCritterTile(20, ROW_MEDIAN);
    const id = poseBear(h, 20, ROW_MEDIAN, ["sense", "routing", "travel"]);
    h.api.setBearPosition(id, tileCX(20) + 24, tileCY(ROW_MEDIAN));
    h.seconds(3);
    expect(h.api.snapshot().lives).toBe(START_LIVES);
    expect(h.api.snapshot().phase).toBe("crossing");
  });

  it("reaches nothing through the death pause", () => {
    const h = harness();
    startCrossing(h);
    h.api.setCatchTest(true);
    h.api.setCritterTile(20, WATER_TOP);
    h.advance(1);
    expect(h.api.snapshot().lives).toBe(START_LIVES - 1);
    poseBear(h, 20, WATER_TOP, ["sense", "routing", "travel"]);
    h.seconds(0.5);
    expect(h.api.snapshot().lives).toBe(START_LIVES - 1);
  });
});
