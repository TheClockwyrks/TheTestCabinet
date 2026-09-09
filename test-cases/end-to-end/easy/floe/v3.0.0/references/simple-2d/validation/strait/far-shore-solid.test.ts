// strait/far-shore-solid — every column of row `1` outside the five bays is solid
// far shore, and a hop up onto it is refused.
//
// specs/strait.md: "Every column of row `1` outside those ten is solid far
// shore." specs/hopping.md turns that into a rule about a hop — a hop is refused
// when its target tile "is on row `1` at a column no bay covers" — and fixes what
// a refusal leaves behind: "A refused hop leaves everything as it was: the critter
// stays where it stands with the same facing, the cooldown is untouched, no life
// is lost, and nothing is scored."
//
// THIS ITEM IS THE REFUSING HALF. `strait/bay-columns` reads the ten columns a
// hop is accepted at; this reads the other THIRTY, one at a time. Between them
// they close every column of the row, and they are separate items because a build
// that opened the whole shore fails only this one and a build that closed it
// fails only the other.
//
// WHAT IS READ, AND WHY IT IS THESE THREE. The item names two of them — the
// critter does not move, and it loses no life — and the third is what tells a
// refusal apart from a landing: no bay is filled. specs/bays.md fills a bay on
// the hop that lands in it and takes the critter off the strait, so a build that
// treated a solid column as an opening either leaves the critter on row `1` or
// fills something; a build that treated it as water or as a wall to be punished
// takes a life. The cooldown and the score are left to `hopping/`'s own refusal
// items, which read them where they are the requirement.
//
// EACH COLUMN IS POSED FROM SCRATCH, so the thirtieth is decided by the same
// world the first was.
//
// THE CRITTER STANDS ON A FLOE, because the hop being refused is a hop up from
// row `2`, the top row of the water band, where a critter with no floe under it
// falls in on the very tick (specs/water.md). `./harness.ts`'s
// `poseHopUpFromWater` lays the smallest floe the game has under exactly that
// tile and stops the lane, so the critter is not carried anywhere and "does not
// move" reads what it says. The floe is part of the requirement's own situation:
// there is no other way to stand at the foot of the far shore.
//
// THE HOP IS A REAL KEY, because a refusal is something the game's own hop rules
// do and no pose can produce.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  press,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";
import {
  BAY_COUNT,
  SOLID_COLUMNS,
  WATER_TOP,
  poseHopUpFromWater,
} from "./harness";

/** Five bays, none of them filled: what a refused hop must leave behind. */
const ALL_OPEN: boolean[] = Array.from({ length: BAY_COUNT }, () => false);

/**
 * Game time held after each refused hop, in seconds, for the replay alone.
 *
 * A twentieth of a second, so the evidence shows the critter still standing at
 * the foot of the shore rather than one frozen frame. The lane under it is
 * stopped, so nothing moves during it, and every reading is taken before it runs.
 * Thirty columns at seven frames apiece keeps the whole section inside the
 * recorder's own frame budget, so the replay is written at the rate it ran.
 */
const AFTER_SECONDS = 0.05;

/** What one column's hop left behind. */
interface Refusal {
  col: number;
  row: number;
  at: number;
  lives: number;
  had: number;
  bays: boolean[];
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a hop up from row 2 at every column of row 1 no bay covers", async () => {
  const refusals: Refusal[] = [];

  await captureReplay(h, "refuse", async () => {
    for (const col of SOLID_COLUMNS) {
      // A world of its own for each column: five open bays, three lives, an
      // emptied strait, and the critter standing on a still floe at row 2.
      startCrossing(h);
      poseHopUpFromWater(h, col);

      // The lives it stands with, read before the hop rather than assumed: what
      // the item asks is that the refusal costs one, not what the run began on.
      const before = h.snapshot().lives;
      await press(h, "up");
      const after = h.snapshot();
      refusals.push({
        col,
        row: after.critter.row,
        at: after.critter.col,
        lives: after.lives,
        had: before,
        bays: after.bays,
      });
      await h.advance(ticksFor(AFTER_SECONDS));
    }
  });

  for (const refusal of refusals) {
    const where =
      `a hop up from row ${WATER_TOP} at column ${refusal.col}, whose target ` +
      `is a column of row 1 no bay covers (specs/strait.md)`;
    // It stayed where it stood.
    assertEqual(
      refusal.row,
      WATER_TOP,
      `the critter's row after ${where}: a refused hop leaves it where it ` +
        `stands (specs/hopping.md)`,
    );
    assertEqual(
      refusal.at,
      refusal.col,
      `the critter's column after ${where}: a refused hop leaves it where it ` +
        `stands (specs/hopping.md)`,
    );
    // It lost no life.
    assertEqual(
      refusal.lives,
      refusal.had,
      `the lives left after ${where}, which it stood with before it ` +
        `(${refusal.had}): a refused hop costs none (specs/hopping.md)`,
    );
    // And it landed in nothing: the shore is solid, so no bay was entered.
    assertDeepEqual(
      refusal.bays,
      ALL_OPEN,
      `the five bays after ${where}: none was entered (specs/bays.md)`,
    );
  }
});
