// progression/respawn-on-near-shore — the critter the death hold gives back begins
// its crossing from the near shore, facing up, with nothing of the last crossing's
// progress left on it.
//
// specs/progression.md: "A fresh crossing puts the critter on the near shore at
// column `START_COL` (`20`), facing `up`, with its hop cooldown at `0` and its
// `bestRow` at `ROW_NEAR` (`19`)", and a fresh crossing is what the hold leads to
// while "`lives` above `0`".
//
// EVERY FIELD IS POSED AWAY FROM ITS ANSWER FIRST, which is the whole design of this
// point. A critter that died at `START_COL` facing `up` with `bestRow` at `19` would
// read all three back whether the build built a fresh critter or simply put the old
// one back on the strait, and this check would pass on either. So the critter is
// moved to a column it does not begin from, turned to face a direction it does not
// begin facing, and given a `bestRow` most of the way to the far shore — and each of
// the three then reads as a DIFFERENT number under the wrong model, so a failure
// names which part of the crossing the build carried over.
//
// `bestRow` IS THE ONE THAT MATTERS MOST, because it is the field with no visible
// home: specs/hopping.md makes it "the topmost row the critter has stood on this
// crossing", specs/hunter.md reads it for the bear's emergence and specs/scoring.md
// for the row award, so a crossing that inherited the last one's `bestRow` would
// quietly stop paying for rows and start the hunt early.
//
// THE DEATH IS THE CHEAPEST ONE TO REACH: the critter is posed on the emptied water
// band and falls in on the next tick (specs/water.md). Which death was taken is not
// on this point's route — the hold is the same one whatever began it.
//
// The lives are left at `START_LIVES`, so the hold expires into a fresh crossing
// rather than into the game over `progression/game-over-at-zero` is about.

import { afterEach, beforeEach, it } from "vitest";
import { DEATH_PAUSE, ROW_NEAR, START_COL } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The water tile the death is taken on: a column a crossing never begins from. */
const DEATH_COL = 5;
const DEATH_ROW = 5;

/** The facing and the best row the dying critter is left holding. */
const POSED_FACING = "left";
const POSED_BEST_ROW = 5;

/** The one tick the fall needs. */
const FALL_TICKS = 1;

/**
 * The hold, driven out: `DEATH_PAUSE` (`0.9` s) is `108` whole ticks at the `TICK_HZ`
 * (`120`) specs/overview.md fixes.
 */
const HOLD_TICKS = ticksFor(DEATH_PAUSE);

/**
 * Two ticks of room past the hold.
 *
 * The hold's own length is `progression/death-pause`'s requirement, not this one's;
 * all this point needs is to be standing on the far side of it. The two ticks cover a
 * build that tests its hold before subtracting the tick rather than after, and the
 * rounding of a hundred and eight subtractions of a hundred-and-twentieth.
 */
const TOLERANCE_TICKS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts a fresh critter on the near shore, facing up, with bestRow back at the start", async () => {
  startCrossing(h);
  h.debug.setCritterTile(DEATH_COL, DEATH_ROW);
  h.debug.setCritterFacing(POSED_FACING);
  h.debug.setBestRow(POSED_BEST_ROW);

  const posed = h.snapshot();
  assertEqual(
    posed.critter.col,
    DEATH_COL,
    "a column a crossing never begins from",
  );
  assertEqual(
    posed.critter.facing,
    POSED_FACING,
    "a facing a fresh critter never has",
  );
  assertEqual(
    posed.critter.bestRow,
    POSED_BEST_ROW,
    "a crossing most of the way across",
  );

  const { struck, fresh } = await captureReplay(h, "respawn", async () => {
    await h.advance(FALL_TICKS);
    const dying = h.snapshot();
    await h.advance(HOLD_TICKS + TOLERANCE_TICKS);
    return { struck: dying, fresh: h.snapshot() };
  });

  // The situation the reading was taken in: a life really was lost, and its hold
  // really did expire.
  assertEqual(struck.phase, "dying", "a life lost on the emptied water band");
  assertEqual(fresh.phase, "crossing", "the crossing the hold gave back");

  assertEqual(fresh.critter.present, true, "a critter back on the strait");
  assertEqual(
    fresh.critter.row,
    ROW_NEAR,
    "the near shore a crossing begins on",
  );
  assertEqual(fresh.critter.col, START_COL, "the column a crossing begins on");
  assertEqual(fresh.critter.facing, "up", "the facing a fresh critter has");
  assertEqual(
    fresh.critter.bestRow,
    ROW_NEAR,
    "bestRow back at the near shore (specs/hopping.md)",
  );
});
