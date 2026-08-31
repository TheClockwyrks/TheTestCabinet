// progression/crush-costs-life — a vehicle arriving on the critter costs the run
// exactly one life and puts the crossing into its dying hold.
//
// specs/progression.md lists the crush among the five things that cost a life, and
// fixes what every one of them costs: "On the tick a life is lost: `lives` drops by
// exactly one, `phase` becomes `dying`". specs/ice.md fixes the crush itself: "The
// critter is crushed on any tick on which a vehicle in a lane whose speed is above
// `0` covers the critter's center."
//
// WHAT THIS POINT DECIDES AND WHAT IT DOES NOT. That a moving lane crushes and a
// stopped one does not is `ice/crush-kills` and `ice/crush-only-on-arrival`; this
// point is one of the five that ask whether the RUN answers a death, and it is the
// crush's own.
//
// THE VEHICLE ARRIVES RATHER THAN BEING POSED ON TOP. It is laid short of the
// critter and the lane is then given a direction and a speed of this check's own
// choosing, so the covering that costs the life is produced by the game's own lane
// motion. The lane's level-1 figure is specs/ice.md's business and `ice/lane-speeds`
// grades it; what this point needs is a lane that MOVES, so it names its own speed
// and the arrival's timing follows from a number this file states.
//
// THE ARITHMETIC, ALL OF IT FROM `LANE_SPEED`. The car's left edge starts at
// `tileLeft(17)` (`544`) and the critter's centre is `tileCX(20)` (`656`). A
// two-tile car covers `[x, x + 64)`, so it covers that centre while its left edge is
// in `(592, 656]` — from `0.75` s to `1.75` s at `LANE_SPEED * TILE` (`64`) units a
// second. `DRIVE` is one second, squarely inside that window and a quarter of a
// second past the tick the life is taken on, so it is well inside the `DEATH_PAUSE`
// (`0.9` s) hold and the phase read is that hold rather than what follows it.
//
// THE ROW IS AN ICE ROW, which is solid footing (specs/strait.md), so the crush is
// the only thing on the strait that can cost this critter a life. The delta is read
// rather than the absolute, so a build that mis-posed the counter fails the point
// that owns the counter rather than this one.

import { afterEach, beforeEach, it } from "vitest";
import { START_COL, tileCX } from "../../src/constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureReplay,
  coversX,
  createHarness,
  itemsInRow,
  poseLane,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The ice row the crush happens on, and the columns the two bodies start on. */
const ROW = 15;
const CRITTER_COL = START_COL;
const CAR_COL = CRITTER_COL - 3;

/** The speed this check gives the lane, in tiles a second, and its direction. */
const LANE_SPEED = 2;
const LANE_DIR = 1;

/** One second of lane motion: the middle of the window the car covers the centre in. */
const DRIVE = ticksFor(1);

/** Ticks of the hold recorded after the reading, for the replay alone. */
const AFTER_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes one life and starts the dying hold when a vehicle arrives on the critter", async () => {
  startCrossing(h);
  poseLane(h, ROW, "car", [CAR_COL]);
  h.debug.setCritterTile(CRITTER_COL, ROW);
  h.debug.setLaneDirection(ROW, LANE_DIR);
  h.debug.setLaneSpeed(ROW, LANE_SPEED);

  const before = h.snapshot();
  assertEqual(before.phase, "crossing", "a live crossing before the crush");
  assertTrue(
    !itemsInRow(before.vehicles, ROW).some((item) =>
      coversX(item, tileCX(CRITTER_COL)),
    ),
    `the lane starting clear of column ${CRITTER_COL}, three tiles short of it`,
  );

  const after = await captureReplay(h, "death", async () => {
    await h.advance(DRIVE);
    const crushed = h.snapshot();
    await h.advance(AFTER_TICKS);
    return crushed;
  });

  // The situation the reading was taken in: the vehicle really did arrive on the
  // tile the critter was standing on. Without it a build that lost a life for some
  // other reason would read the same two numbers below.
  assertTrue(
    itemsInRow(after.vehicles, ROW).some((item) =>
      coversX(item, tileCX(CRITTER_COL)),
    ),
    `a vehicle covering column ${CRITTER_COL} after ${DRIVE} ticks of lane motion`,
  );
  assertEqual(
    before.lives - after.lives,
    1,
    "the one life a crush costs (specs/progression.md)",
  );
  assertEqual(after.phase, "dying", "the hold a lost life starts");
});
