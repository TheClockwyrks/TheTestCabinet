// The crossing and the run, against `specs/hopping.md`, `specs/ice.md`,
// `specs/water.md`, `specs/bays.md`, `specs/scoring.md` and
// `specs/progression.md`.
//
// Every scenario poses only what its rule is about: the strait is emptied, the
// four world gates hold off everything else, and the traffic, the floes and the
// bears a check needs are the ones it adds itself.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BAYFILL_PAUSE,
  BAYS,
  BAY_COUNT,
  COLS,
  BONUS_LIFE_EVERY,
  CLEAR_PAUSE,
  DEATH_PAUSE,
  FISH_INTERVAL,
  FISH_LINGER,
  HOP_COOLDOWN,
  ROW_BAYS,
  ROW_CAP,
  ROW_MEDIAN,
  ROW_NEAR,
  SCORE_BAY,
  SCORE_BONUS_CATCH,
  SCORE_LEVEL,
  SCORE_ROW,
  SCORE_TIME_BONUS,
  SCORE_VICTORY_LIFE,
  START_COL,
  START_LIVES,
  TICK_HZ,
  TILE,
  TIMER_BASE,
  TIMER_PER_LEVEL,
  TOTAL_LEVELS,
  colAt,
  crossingTimer,
  tileCX,
  tileCY,
  tileLeft,
} from "./constants";
import { createHarness, type Harness } from "./harness.test-support";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.dispose();
});

/** An empty strait, playing, with nothing arriving that a check did not ask for. */
function empty(h: Harness): void {
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
  h.debug.clearBays();
  h.debug.clearFish();
}

/**
 * Park a raft over a tile of a water row, so a critter may stand there.
 *
 * Deep water costs a life on the tick the critter's footing reads `water`
 * (`specs/water.md`), so a check about anything else that leaves the critter on a
 * water row gives it something to stand on first.
 */
function raft(h: Harness, row: number, col: number): void {
  h.debug.setLaneSpeed(row, 0);
  h.debug.addFloe(row, "raft4", tileCX(col) - 2 * TILE);
}

/** Hold a direction for one tick, which is one hop's worth of request. */
async function hop(h: Harness, code: string): Promise<void> {
  h.down(code);
  await h.step(1);
  h.up(code);
}

describe("the hop", () => {
  it("moves exactly one tile per press and sets the facing", async () => {
    empty(harness);
    harness.debug.addCritter(START_COL, ROW_NEAR);
    await hop(harness, "ArrowUp");
    expect(harness.snapshot().critter).toMatchObject({
      col: START_COL,
      row: ROW_NEAR - 1,
      x: tileCX(START_COL),
      y: tileCY(ROW_NEAR - 1),
      facing: "up",
      bestRow: ROW_NEAR - 1,
    });
    expect(harness.snapshot().critter.hopCooldown).toBeGreaterThan(0);
  });

  it("ignores a press inside the cooldown and takes one at the cooldown", async () => {
    empty(harness);
    harness.debug.addCritter(START_COL, ROW_NEAR);
    await hop(harness, "ArrowUp");
    const reached = harness.snapshot().critter.row;

    // Half a cooldown later, nothing.
    await harness.step(Math.round((HOP_COOLDOWN / 2) * TICK_HZ));
    await hop(harness, "ArrowUp");
    expect(harness.snapshot().critter.row).toBe(reached);

    // A whole cooldown after the first hop, one further tile.
    await harness.step(Math.ceil(HOP_COOLDOWN * TICK_HZ));
    await hop(harness, "ArrowUp");
    expect(harness.snapshot().critter.row).toBe(reached - 1);
  });

  it("auto-repeats a held direction at the cooldown", async () => {
    empty(harness);
    harness.debug.addCritter(START_COL, ROW_NEAR);
    harness.down("ArrowUp");
    await harness.step(TICK_HZ);
    harness.up("ArrowUp");
    const rows = ROW_NEAR - harness.snapshot().critter.row;
    expect(rows).toBeGreaterThanOrEqual(Math.floor(1 / HOP_COOLDOWN) - 1);
    expect(rows).toBeLessThanOrEqual(Math.ceil(1 / HOP_COOLDOWN) + 1);
  });

  it("lands on the target tile's centre exactly, whatever the drift", async () => {
    empty(harness);
    harness.debug.addCritter(20, 5);
    harness.debug.setCritterX(tileCX(20) + 11);
    expect(harness.snapshot().critter.col).toBe(20);
    await hop(harness, "ArrowUp");
    expect(harness.snapshot().critter).toMatchObject({
      col: 20,
      row: 4,
      x: tileCX(20),
      y: tileCY(4),
    });
  });

  it("refuses a hop off the grid, into the cap, and into solid far shore", async () => {
    empty(harness);
    harness.debug.addCritter(0, ROW_MEDIAN);
    await hop(harness, "ArrowLeft");
    expect(harness.snapshot().critter.col).toBe(0);

    harness.debug.setCritterTile(0, ROW_BAYS);
    harness.debug.setHopCooldown(0);
    await hop(harness, "ArrowUp");
    expect(harness.snapshot().critter.row).toBe(ROW_BAYS);
    expect(ROW_CAP).toBe(0);

    raft(harness, 2, 0);
    harness.debug.setCritterTile(0, 2);
    harness.debug.setHopCooldown(0);
    await hop(harness, "ArrowUp");
    expect(harness.snapshot().critter.row).toBe(2);
    expect(harness.snapshot().critter.present).toBe(true);
  });

  it("refuses a hop into a filled bay and accepts one into an open bay", async () => {
    empty(harness);
    const [left] = BAYS[0];
    harness.debug.setBay(0, true);
    raft(harness, 2, left);
    harness.debug.addCritter(left, 2);
    await hop(harness, "ArrowUp");
    expect(harness.snapshot().critter.row).toBe(2);

    harness.debug.setBay(0, false);
    harness.debug.setHopCooldown(0);
    await hop(harness, "ArrowUp");
    expect(harness.snapshot().bays[0]).toBe(true);
  });

  it("refuses a hop onto a tile a vehicle covers, and costs nothing", async () => {
    empty(harness);
    harness.debug.addCritter(20, ROW_MEDIAN);
    harness.debug.setLaneSpeed(11, 0);
    harness.debug.addVehicle(11, "plow", tileCX(20) - TILE / 2);
    const before = harness.snapshot();
    await hop(harness, "ArrowDown");
    const after = harness.snapshot();
    expect(after.critter.row).toBe(ROW_MEDIAN);
    expect(after.critter.facing).toBe(before.critter.facing);
    expect(after.lives).toBe(before.lives);
    expect(after.score).toBe(before.score);
  });

  it("accepts a hop onto open water", async () => {
    empty(harness);
    harness.debug.addCritter(20, ROW_MEDIAN);
    await hop(harness, "ArrowUp");
    expect(harness.snapshot().critter.row).toBe(9);
    expect(harness.snapshot().critter.footing).toBe("water");
  });
});

describe("the far shore", () => {
  it("accepts a hop up from row 2 at exactly the ten bay columns", async () => {
    const wanted = BAYS.flatMap(([left, right]) => [left, right]).sort(
      (a, b) => a - b,
    );
    const accepted: number[] = [];
    for (let col = 0; col < COLS; col += 1) {
      empty(harness);
      harness.debug.setScore(0);
      harness.debug.setLives(START_LIVES);
      raft(harness, 2, col);
      harness.debug.addCritter(col, 2);
      await hop(harness, "ArrowUp");
      const after = harness.snapshot();
      if (after.bays.some((filled) => filled)) {
        accepted.push(col);
        continue;
      }
      // Every other column of row 1 is solid: the hop is refused and costs
      // nothing.
      expect(after.critter.row).toBe(2);
      expect(after.lives).toBe(START_LIVES);
      expect(after.score).toBe(0);
    }
    expect(accepted).toEqual(wanted);
  });
});

describe("the ice band", () => {
  it("closes every tile a plow spans, its middle one included", async () => {
    for (const col of [10, 11, 12]) {
      empty(harness);
      harness.debug.setLaneSpeed(11, 0);
      harness.debug.addVehicle(11, "plow", tileLeft(10));
      harness.debug.addCritter(col, 12);
      await hop(harness, "ArrowUp");
      expect(harness.snapshot().critter.row).toBe(12);
    }
    // The tile past its right edge is open.
    empty(harness);
    harness.debug.setLaneSpeed(11, 0);
    harness.debug.addVehicle(11, "plow", tileLeft(10));
    harness.debug.addCritter(13, 12);
    await hop(harness, "ArrowUp");
    expect(harness.snapshot().critter.row).toBe(11);
  });

  it("crushes the critter when a moving vehicle covers its centre", async () => {
    empty(harness);
    harness.debug.addCritter(20, 15);
    harness.debug.setLaneSpeed(15, 4);
    harness.debug.setLaneDirection(15, 1);
    harness.debug.addVehicle(15, "car", tileCX(20) - 6 * TILE);
    const died = await harness.until(
      () => harness.snapshot().phase === "dying",
      TICK_HZ * 3,
    );
    expect(died).toBe(true);
    expect(harness.snapshot().lives).toBe(START_LIVES - 1);
  });

  it("leaves the critter standing under a vehicle in a lane held still", async () => {
    empty(harness);
    harness.debug.addCritter(20, 15);
    harness.debug.setLaneSpeed(15, 0);
    harness.debug.addVehicle(15, "car", tileCX(20) - TILE / 2);
    await harness.step(TICK_HZ);
    expect(harness.snapshot().phase).toBe("crossing");
    expect(harness.snapshot().lives).toBe(START_LIVES);
  });
});

describe("the water band", () => {
  it("costs a life on a water tile no floe covers", async () => {
    empty(harness);
    harness.debug.addCritter(20, 5);
    await harness.step(1);
    const after = harness.snapshot();
    expect(after.critter.footing).toBe("water");
    expect(after.phase).toBe("dying");
    expect(after.lives).toBe(START_LIVES - 1);
  });

  it("carries a rider at its lane's speed and direction", async () => {
    empty(harness);
    harness.debug.setLaneSpeed(5, 2);
    harness.debug.setLaneDirection(5, 1);
    harness.debug.addFloe(5, "raft4", tileCX(20) - 2 * TILE);
    harness.debug.addCritter(20, 5);
    expect(harness.snapshot().critter.footing).toBe("floe");
    const from = harness.snapshot().critter.x;
    await harness.step(TICK_HZ);
    const carried = harness.snapshot().critter.x - from;
    expect(carried).toBeCloseTo(2 * TILE, 1);
    expect(harness.snapshot().critter.row).toBe(5);
  });

  it("takes a hop while riding as one absolute tile of the strait", async () => {
    empty(harness);
    harness.debug.setLaneSpeed(5, 3);
    harness.debug.setLaneDirection(5, 1);
    harness.debug.addFloe(5, "raft4", tileCX(20) - 2 * TILE);
    raft(harness, 4, 20);
    harness.debug.addCritter(20, 5);
    await harness.step(20);
    const drifted = harness.snapshot().critter;
    expect(drifted.x).not.toBe(tileCX(20));

    harness.debug.setHopCooldown(0);
    await hop(harness, "ArrowUp");
    expect(harness.snapshot().critter.x).toBe(tileCX(drifted.col));
    expect(harness.snapshot().critter.y).toBe(tileCY(4));
  });

  it("moves the critter's column as the drift crosses tile boundaries", async () => {
    empty(harness);
    harness.debug.setLaneSpeed(5, 4);
    harness.debug.setLaneDirection(5, 1);
    for (let col = 0; col < 40; col += 4) {
      harness.debug.addFloe(5, "raft4", tileLeft(col));
    }
    harness.debug.addCritter(10, 5);
    const columns = new Set<number>();
    for (let tick = 0; tick < TICK_HZ; tick += 1) {
      await harness.step(1);
      const critter = harness.snapshot().critter;
      expect(critter.col).toBe(colAt(critter.x));
      columns.add(critter.col);
    }
    expect(columns.size).toBeGreaterThan(3);
  });

  it("loses a critter carried past a side edge", async () => {
    empty(harness);
    harness.debug.setLaneSpeed(5, 6);
    harness.debug.setLaneDirection(5, -1);
    harness.debug.addFloe(5, "raft4", 0);
    harness.debug.addCritter(1, 5);
    const died = await harness.until(
      () => harness.snapshot().phase === "dying",
      TICK_HZ * 3,
    );
    expect(died).toBe(true);
    expect(harness.snapshot().lives).toBe(START_LIVES - 1);
  });

  it("reads a raft's whole span as footing", () => {
    empty(harness);
    harness.debug.setLaneSpeed(9, 0);
    harness.debug.addFloe(9, "raft4", tileCX(10) - TILE / 2);
    for (const col of [10, 11, 12, 13]) {
      harness.debug.setCritterTile(col, 9);
      harness.debug.addCritter(col, 9);
      expect(harness.snapshot().critter.footing).toBe("floe");
    }
    harness.debug.addCritter(14, 9);
    expect(harness.snapshot().critter.footing).toBe("water");
  });
});

describe("the bays", () => {
  it("fills a bay, scores the crossing, and clears the strait of bears", async () => {
    empty(harness);
    harness.debug.setTimer(12.5);
    const [left] = BAYS[1];
    harness.debug.addCritter(left, 2);
    harness.debug.setBestRow(2);
    harness.debug.addBear(left, 12);
    await hop(harness, "ArrowUp");
    const after = harness.snapshot();
    expect(after.bays).toEqual([false, true, false, false, false]);
    expect(after.score).toBe(SCORE_ROW + SCORE_BAY + SCORE_TIME_BONUS * 12);
    expect(after.critter.present).toBe(false);
    expect(after.bears).toEqual([]);
    expect(after.phase).toBe("crossing");
    expect(after.phaseTimer).toBeCloseTo(BAYFILL_PAUSE, 2);
  });

  it("begins a fresh crossing after the bay-fill hold", async () => {
    empty(harness);
    const [left] = BAYS[2];
    harness.debug.addCritter(left, 2);
    await hop(harness, "ArrowUp");
    const back = await harness.until(
      () => harness.snapshot().critter.present,
      Math.ceil(BAYFILL_PAUSE * TICK_HZ) + 10,
    );
    expect(back).toBe(true);
    expect(harness.snapshot().critter).toMatchObject({
      col: START_COL,
      row: ROW_NEAR,
      facing: "up",
      bestRow: ROW_NEAR,
      hopCooldown: 0,
    });
    expect(harness.snapshot().bays[2]).toBe(true);
  });

  it("clears the level on the hop that fills the last open bay", async () => {
    empty(harness);
    for (const bay of [0, 1, 2, 3]) harness.debug.setBay(bay, true);
    const [left] = BAYS[4];
    harness.debug.addCritter(left, 2);
    harness.debug.setTimer(0);
    await hop(harness, "ArrowUp");
    const after = harness.snapshot();
    expect(after.phase).toBe("clearing");
    expect(after.phaseTimer).toBeCloseTo(CLEAR_PAUSE, 2);
    expect(after.score).toBe(SCORE_ROW + SCORE_BAY + SCORE_LEVEL * 1);
  });

  it("leaves a strait posed with five filled bays being played", async () => {
    empty(harness);
    for (let bay = 0; bay < BAY_COUNT; bay += 1)
      harness.debug.setBay(bay, true);
    harness.debug.addCritter(START_COL, ROW_NEAR);
    await harness.step(TICK_HZ * 5);
    const after = harness.snapshot();
    expect(after.screen).toBe("playing");
    expect(after.phase).toBe("crossing");
    expect(after.level).toBe(1);
  });

  it("opens the next level after the clear hold, with five open bays", async () => {
    empty(harness);
    for (const bay of [0, 1, 2, 3]) harness.debug.setBay(bay, true);
    const [left] = BAYS[4];
    harness.debug.addCritter(left, 2);
    await hop(harness, "ArrowUp");
    const opened = await harness.until(
      () => harness.snapshot().level === 2,
      Math.ceil(CLEAR_PAUSE * TICK_HZ) + 10,
    );
    expect(opened).toBe(true);
    const after = harness.snapshot();
    expect(after.reachedLevel).toBe(2);
    expect(after.bays).toEqual([false, false, false, false, false]);
    expect(after.timerMax).toBe(crossingTimer(2));
    expect(after.phase).toBe("crossing");
  });
});

describe("the bonus catch", () => {
  it("appears in an open bay, lingers, and moves on", async () => {
    empty(harness);
    harness.debug.setFishCadence(true);
    harness.debug.addCritter(START_COL, ROW_NEAR);
    expect(harness.snapshot().fishBay).toBeNull();
    const appeared = await harness.waitFor(
      () => harness.snapshot().fishBay !== null,
      FISH_INTERVAL + 1,
    );
    expect(appeared).toBe(true);
    const first = harness.snapshot().fishBay;
    const left = await harness.waitFor(
      () => harness.snapshot().fishBay === null,
      FISH_LINGER + 1,
    );
    expect(left).toBe(true);
    const next = await harness.waitFor(
      () => harness.snapshot().fishBay !== null,
      FISH_INTERVAL + 1,
    );
    expect(next).toBe(true);
    expect(harness.snapshot().fishBay).not.toBe(first);
  });

  it("pays SCORE_BONUS_CATCH to a crossing that ends in its bay", async () => {
    empty(harness);
    harness.debug.setTimer(0);
    harness.debug.setFishBay(3);
    const [left] = BAYS[3];
    harness.debug.addCritter(left, 2);
    harness.debug.setBestRow(2);
    await hop(harness, "ArrowUp");
    const after = harness.snapshot();
    expect(after.score).toBe(SCORE_ROW + SCORE_BAY + SCORE_BONUS_CATCH);
    expect(after.fishBay).toBeNull();
  });

  it("stays out of a scenario with its cadence off", async () => {
    empty(harness);
    harness.debug.addCritter(START_COL, ROW_NEAR);
    await harness.waitFor(() => false, FISH_INTERVAL * 2);
    expect(harness.snapshot().fishBay).toBeNull();
    expect(harness.snapshot().fishCadence).toBe(false);
  });
});

describe("the crossing timer", () => {
  it("follows crossingTimer(level) and drains while a crossing runs", async () => {
    expect(crossingTimer(1)).toBe(TIMER_BASE);
    expect(crossingTimer(TOTAL_LEVELS)).toBe(
      TIMER_BASE - (TOTAL_LEVELS - 1) * TIMER_PER_LEVEL,
    );
    empty(harness);
    harness.debug.setTimerRunning(true);
    harness.debug.addCritter(START_COL, ROW_NEAR);
    harness.debug.setTimer(10);
    await harness.step(TICK_HZ);
    expect(harness.snapshot().timer).toBeCloseTo(9, 1);
  });

  it("costs a life on the tick it reaches zero", async () => {
    empty(harness);
    harness.debug.setTimerRunning(true);
    harness.debug.addCritter(START_COL, ROW_NEAR);
    harness.debug.setTimer(0.5);
    const died = await harness.until(
      () => harness.snapshot().phase === "dying",
      TICK_HZ,
    );
    expect(died).toBe(true);
    const after = harness.snapshot();
    expect(after.timer).toBe(0);
    expect(after.lives).toBe(START_LIVES - 1);
  });

  it("holds where it stands with its gate off", async () => {
    empty(harness);
    harness.debug.addCritter(START_COL, ROW_NEAR);
    harness.debug.setTimer(7);
    await harness.step(TICK_HZ * 3);
    expect(harness.snapshot().timer).toBe(7);
  });

  it("kills nothing when posed at zero", async () => {
    empty(harness);
    harness.debug.addCritter(START_COL, ROW_NEAR);
    harness.debug.setTimer(0);
    await harness.step(TICK_HZ);
    expect(harness.snapshot().phase).toBe("crossing");
    expect(harness.snapshot().lives).toBe(START_LIVES);
  });
});

describe("losing a life", () => {
  it("holds the death pause, then puts a fresh critter on the near shore", async () => {
    empty(harness);
    harness.debug.addCritter(20, 5);
    await harness.step(1);
    expect(harness.snapshot().phase).toBe("dying");
    expect(harness.snapshot().critter.present).toBe(false);

    const held = Math.floor(DEATH_PAUSE * TICK_HZ) - 2;
    await harness.step(held);
    expect(harness.snapshot().phase).toBe("dying");
    const back = await harness.until(
      () => harness.snapshot().critter.present,
      TICK_HZ,
    );
    expect(back).toBe(true);
    expect(harness.snapshot().critter).toMatchObject({
      col: START_COL,
      row: ROW_NEAR,
    });
    expect(harness.snapshot().phase).toBe("crossing");
  });

  it("keeps the strait running through the hold", async () => {
    empty(harness);
    harness.debug.setLaneSpeed(15, 3);
    harness.debug.setLaneDirection(15, 1);
    harness.debug.addVehicle(15, "car", 0);
    const before = harness.snapshot().vehicles[0].x;
    harness.debug.addCritter(20, 5);
    await harness.step(30);
    expect(harness.snapshot().phase).toBe("dying");
    expect(harness.snapshot().vehicles[0].x).toBeGreaterThan(before);
  });

  it("takes every bear off the strait on the tick the life is lost", async () => {
    empty(harness);
    harness.debug.addBear(4, 12);
    harness.debug.addBear(30, 15);
    harness.debug.addCritter(20, 5);
    await harness.step(1);
    expect(harness.snapshot().phase).toBe("dying");
    expect(harness.snapshot().bears).toEqual([]);
  });

  it("ends the run on the death that empties the lives", async () => {
    empty(harness);
    harness.debug.setLives(1);
    harness.debug.setReachedLevel(4);
    harness.debug.addCritter(20, 5);
    const over = await harness.until(
      () => harness.snapshot().screen === "gameover",
      Math.ceil(DEATH_PAUSE * TICK_HZ) + 10,
    );
    expect(over).toBe(true);
    const after = harness.snapshot();
    expect(after.lives).toBe(0);
    expect(after.reachedLevel).toBe(4);
    expect(after.menuIndex).toBe(0);
  });

  it("leaves a run posed at zero lives being played", async () => {
    empty(harness);
    harness.debug.setLives(0);
    harness.debug.addCritter(START_COL, ROW_NEAR);
    await harness.step(TICK_HZ * 5);
    expect(harness.snapshot().screen).toBe("playing");
    expect(harness.snapshot().phase).toBe("crossing");
    expect(harness.snapshot().lives).toBe(0);
  });
});

describe("scoring", () => {
  it("pays a row only the first time it is reached this crossing", async () => {
    empty(harness);
    raft(harness, 9, 20);
    harness.debug.addCritter(20, ROW_MEDIAN);
    harness.debug.setBestRow(ROW_MEDIAN);
    await hop(harness, "ArrowUp");
    expect(harness.snapshot().score).toBe(SCORE_ROW);
    harness.debug.setHopCooldown(0);
    await hop(harness, "ArrowDown");
    expect(harness.snapshot().score).toBe(SCORE_ROW);
    harness.debug.setHopCooldown(0);
    await hop(harness, "ArrowUp");
    expect(harness.snapshot().score).toBe(SCORE_ROW);
    expect(harness.snapshot().critter.present).toBe(true);
  });

  it("pays a refused hop nothing", async () => {
    empty(harness);
    harness.debug.addCritter(0, ROW_MEDIAN);
    await hop(harness, "ArrowLeft");
    expect(harness.snapshot().score).toBe(0);
  });

  it("wins the run on the hop that clears the last level", async () => {
    empty(harness);
    harness.debug.setLevel(TOTAL_LEVELS);
    harness.debug.clearVehicles();
    harness.debug.clearFloes();
    harness.debug.setTimer(0);
    for (const bay of [0, 1, 2, 3]) harness.debug.setBay(bay, true);
    const [left] = BAYS[4];
    harness.debug.addCritter(left, 2);
    harness.debug.setBestRow(2);
    await hop(harness, "ArrowUp");
    const after = harness.snapshot();
    expect(after.screen).toBe("victory");
    expect(after.score).toBe(
      SCORE_ROW +
        SCORE_BAY +
        SCORE_LEVEL * TOTAL_LEVELS +
        SCORE_VICTORY_LIFE * START_LIVES,
    );
  });

  it("earns a life at every bonus boundary the score crosses", async () => {
    empty(harness);
    harness.debug.setScore(BONUS_LIFE_EVERY - SCORE_ROW);
    raft(harness, 9, 20);
    harness.debug.addCritter(20, ROW_MEDIAN);
    harness.debug.setBestRow(ROW_MEDIAN);
    await hop(harness, "ArrowUp");
    expect(harness.snapshot().score).toBe(BONUS_LIFE_EVERY);
    expect(harness.snapshot().lives).toBe(START_LIVES + 1);
  });

  it("earns two lives from one award crossing two boundaries", async () => {
    empty(harness);
    // The time bonus is paid `floor(timer)` times over, so a posed timer is the
    // one award big enough to cross two boundaries at once.
    harness.debug.setTimer(BONUS_LIFE_EVERY);
    const [left] = BAYS[0];
    raft(harness, 2, left);
    harness.debug.addCritter(left, 2);
    await hop(harness, "ArrowUp");
    expect(harness.snapshot().score).toBe(
      SCORE_ROW + SCORE_BAY + SCORE_TIME_BONUS * BONUS_LIFE_EVERY,
    );
    expect(harness.snapshot().lives).toBe(START_LIVES + 2);
  });

  it("pays the completing hop all three awards", async () => {
    empty(harness);
    harness.debug.setTimer(12);
    const [left] = BAYS[2];
    raft(harness, 2, left);
    harness.debug.addCritter(left, 2);
    harness.debug.setBestRow(2);
    await hop(harness, "ArrowUp");
    expect(harness.snapshot().score).toBe(10 + 50 + 2 * 12);
  });

  it("grants no life for a posed score", async () => {
    empty(harness);
    harness.debug.addCritter(START_COL, ROW_NEAR);
    harness.debug.setScore(BONUS_LIFE_EVERY * 3);
    await harness.step(TICK_HZ);
    expect(harness.snapshot().lives).toBe(START_LIVES);
  });
});

describe("the hunt's emergence", () => {
  it("waits for the advance and the delay before the first bear appears", async () => {
    empty(harness);
    harness.debug.setBearEmergence(true);
    harness.debug.addCritter(START_COL, ROW_NEAR);

    // On the near shore, no bear is hunting at all.
    await harness.waitFor(() => false, 3);
    expect(harness.snapshot().bears).toEqual([]);

    harness.debug.setBestRow(ROW_NEAR - 3);
    const appeared = await harness.until(
      () => harness.snapshot().bears.length === 1,
      TICK_HZ * 2,
    );
    expect(appeared).toBe(true);
    expect(harness.snapshot().bears[0]).toMatchObject({
      row: ROW_NEAR,
      facing: "up",
    });
  });

  it("adds a second bear only from SECOND_BEAR_LEVEL", async () => {
    empty(harness);
    harness.debug.setBearEmergence(true);
    harness.debug.addCritter(START_COL, ROW_NEAR);
    harness.debug.setBestRow(ROW_NEAR - 8);
    await harness.waitFor(() => false, 4);
    expect(harness.snapshot().bears).toHaveLength(1);

    harness.debug.setLevel(5);
    harness.debug.clearVehicles();
    const two = await harness.waitFor(
      () => harness.snapshot().bears.length === 2,
      4,
    );
    expect(two).toBe(true);
  });

  it("stays out of a scenario with its gate off", async () => {
    empty(harness);
    harness.debug.addCritter(START_COL, ROW_NEAR);
    harness.debug.setBestRow(ROW_BAYS);
    await harness.waitFor(() => false, 4);
    expect(harness.snapshot().bears).toEqual([]);
    expect(harness.snapshot().bearEmergence).toBe(false);
  });
});
