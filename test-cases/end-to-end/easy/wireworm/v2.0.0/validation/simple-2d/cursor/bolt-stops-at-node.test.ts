// cursor/bolt-stops-at-node — a bolt resolves against the FIRST node in its
// column and goes no further.
//
// specs/cursor.md: "As it climbs it resolves against the first thing its center
// reaches, which is the lowest of the following that lies above it in its column
// ... A bolt resolves against exactly one thing and is removed from flight in the
// same update." specs/nodes.md gives the outcome for the charge it struck: a
// node at charge `0` "is removed and its tile is left empty".
//
// TWO NODES IN ONE COLUMN, AND NOTHING ELSE ON THE BOARD. `startPlaying` empties
// the field and the three rosters, and the scenario puts back exactly the two
// nodes the requirement is about: the inert one the bolt reaches first, and one
// further up the same column that the bolt must never reach.
//
// THE UPPER NODE IS POSED AT CHARGE 2, SO EVERY WRONG MODEL READS AS A DIFFERENT
// NUMBER. Untouched it reads 2, which is the pass. A build whose bolt survived
// the first node and struck this one knocks it to 1 (specs/nodes.md); a build
// that clears a charged node outright leaves the tile empty; a build that
// detonates one leaves it empty too. Charge 2 is the only value from which all
// four of those read apart — at 0 a struck node and a passed-through node both
// leave an empty tile, and at 3 both leave one as well.
//
// THE SPAN IS SIZED SO A SURVIVING BOLT WOULD REACH THE UPPER NODE. From row
// 19's centre (704), row 10's tile begins at y = 432 and row 5's at 272, which a
// bolt at `BOLT_SPEED` covers in 0.30 s and 0.48 s. The drive runs 0.6 s, so
// "the upper node is untouched" is a verdict about a bolt that had the time to
// get there and did not, rather than about one that simply ran out of window.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED } from "../../src/constants";
import { assertEqual, assertNull } from "../assert";
import {
  boltOf,
  captureStill,
  chargeAt,
  createHarness,
  poseBolt,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The column both nodes and the bolt share, well clear of both side edges. */
const COLUMN = 12;

/** The inert node the bolt reaches first. */
const NEAR_R = 10;
/** The node further up the same column, which the bolt must never reach. */
const FAR_R = 5;

/**
 * The charge the far node holds, and the value this check reads back.
 *
 * `2` is the distinguishing pose: see the header. Whole numbers throughout, so
 * the reading needs no tolerance — specs/nodes.md makes a charge "a whole number
 * from `0` to `CHARGE_MAX`".
 */
const FAR_CHARGE = 2;

/** The row the bolt is posed on: the floor, whose centre y is 704. */
const START_ROW = 19;

/**
 * The drive, in frames of the harness's 120 Hz clock: 0.6 s.
 *
 * At `BOLT_SPEED` that is 540 units of travel, past the 432 units to the near
 * node and past the 432-to-272 stretch that would carry a surviving bolt into the
 * far one.
 */
const DRIVE_TICKS = ticksFor(0.6);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("clears the first node, leaves the one above it, and takes the bolt out of flight", async () => {
  startPlaying(h);
  h.debug.setNode(COLUMN, NEAR_R, 0);
  h.debug.setNode(COLUMN, FAR_R, FAR_CHARGE);
  const id = poseBolt(h, COLUMN, START_ROW);

  await h.advance(DRIVE_TICKS);
  captureStill(h, "consumed");

  const board = h.snapshot();
  assertNull(
    chargeAt(board, COLUMN, NEAR_R),
    `the charge on the inert node at (${COLUMN}, ${NEAR_R}) the bolt reached ` +
      "first — specs/nodes.md: a bolt into a charge-0 node removes it and " +
      "leaves its tile empty",
  );
  assertEqual(
    chargeAt(board, COLUMN, FAR_R),
    FAR_CHARGE,
    `the charge on the node at (${COLUMN}, ${FAR_R}), further up the same ` +
      `column — specs/cursor.md: the bolt resolved against the node at ` +
      `(${COLUMN}, ${NEAR_R}) and was removed from flight in that update, so ` +
      `nothing reached this one. A reading of ${FAR_CHARGE - 1} is a bolt that ` +
      "climbed on and struck it; null is one that cleared or detonated it",
  );
  assertNull(
    boltOf(board, id),
    `the bolt (id ${id}) after it resolved against the node at ` +
      `(${COLUMN}, ${NEAR_R}) — specs/cursor.md removes it from flight in the ` +
      `same update; at BOLT_SPEED (${BOLT_SPEED}) a bolt still in flight ` +
      `${DRIVE_TICKS} frames on has left the column it was fired up`,
  );
});
