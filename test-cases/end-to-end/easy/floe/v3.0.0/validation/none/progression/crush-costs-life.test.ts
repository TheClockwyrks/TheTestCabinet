// progression/crush-costs-life — a vehicle arriving on the critter costs the run
// exactly one life and puts the crossing into its dying hold.
//
// specs/progression.md lists the crush among the five things that cost a life,
// and fixes what every one of them costs: "On the tick a life is lost: `lives`
// drops by exactly one, `phase` becomes `dying`". specs/ice.md fixes the crush
// itself: "The critter is crushed on any tick on which a vehicle in a lane whose
// speed is above `0` covers the critter's center."
//
// WHAT THIS POINT DECIDES AND WHAT IT DOES NOT. That a moving lane crushes and a
// stopped one does not is `ice/crush-kills` and `ice/crush-only-on-arrival`; this
// point is one of the five that ask whether the RUN answers a death, and it is
// the crush's own.
//
// THE VEHICLE ARRIVES RATHER THAN BEING POSED ON TOP. It is laid three tiles
// short of the critter and the lane is then given a direction and a speed of this
// check's own choosing, so the covering that costs the life is produced by the
// game's own lane motion. The drive is a fixed count of ticks derived from THAT
// posed speed rather than a sweep: at `LANE_SPEED` tiles a second the car's left
// edge needs `0.75` s to pass the critter's centre and `1.75` s to leave it
// behind, so a single `DRIVE` of one second lands the reading squarely inside the
// window in which the vehicle covers the critter — and well inside the `0.9` s
// hold the death starts, so the phase read is the hold rather than what follows
// it.
//
// The row is an ICE row, which is solid footing (specs/strait.md), so the crush
// is the only thing on the strait that can cost this critter a life. The delta is
// read rather than the absolute, so a build that mis-posed the counter fails the
// point that owns the counter rather than this one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { START_COL, tileCX } from "../constants";
import {
  captureReplay,
  covers,
  createHarness,
  itemsOnRow,
  poseLane,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The ice row the crush happens on, and the columns the two bodies start on. */
const ROW = 15;
const CRITTER_COL = START_COL;
const CAR_COL = CRITTER_COL - 3;

/**
 * The speed this check gives the lane, in tiles a second, and its direction.
 *
 * The lane's own level-1 figure is `specs/ice.md`'s business and `ice/lane-speeds`
 * grades it; what this point needs is a lane that MOVES, and it names its own
 * figure so the arrival's timing follows from a number this file states.
 */
const LANE_SPEED = 2;
const LANE_DIR = 1;

/**
 * One second of lane motion.
 *
 * The car's left edge starts `3` tiles (`96` units) left of the critter's centre
 * and a `2`-tile car covers `[x, x + 64)`, so it first covers that centre once it
 * has moved more than `32` units — `0.5` s at `LANE_SPEED * TILE` units a
 * second — and stops covering it past `96` units, at `1.5` s. One second is the
 * middle of that window, and it is inside the `DEATH_PAUSE` (`0.9` s) hold that
 * begins half a second in.
 */
const DRIVE = ticksFor(1);

/** Ticks of the hold recorded after the reading, for the replay alone. */
const AFTER_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes one life and starts the dying hold when a vehicle arrives on the critter", async () => {
  await startCrossing(h);
  await poseLane(h, ROW, "car", [CAR_COL]);
  await h.debug.setCritterTile(CRITTER_COL, ROW);
  await h.debug.setLaneDirection(ROW, LANE_DIR);
  await h.debug.setLaneSpeed(ROW, LANE_SPEED);

  const before = await h.snapshot();
  assertEqual(before.phase, "crossing", "a live crossing before the crush");
  assertTrue(
    !itemsOnRow(before, ROW).some((item) => covers(item, tileCX(CRITTER_COL))),
    "the lane starts clear of the critter, three tiles short of it",
  );

  const after = await captureReplay(h, "death", async () => {
    await h.advance(DRIVE);
    const crushed = await h.snapshot();
    await h.advance(AFTER_TICKS);
    return crushed;
  });

  // The situation the reading was taken in: the vehicle really did arrive on the
  // tile the critter was standing on. Without it a build that lost a life for
  // some other reason would read the same two numbers below.
  assertTrue(
    itemsOnRow(after, ROW).some((item) => covers(item, tileCX(CRITTER_COL))),
    `a vehicle covering column ${CRITTER_COL} after ${DRIVE} ticks of lane motion`,
  );
  assertEqual(
    before.lives - after.lives,
    1,
    "the one life a crush costs (specs/progression.md)",
  );
  assertEqual(after.phase, "dying", "the hold a lost life starts");
});
