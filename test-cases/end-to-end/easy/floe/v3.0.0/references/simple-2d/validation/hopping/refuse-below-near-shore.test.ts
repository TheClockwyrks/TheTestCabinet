// hopping/refuse-below-near-shore — a hop below the near shore is refused.
//
// The bottom edge of the same rule `refuse-left-edge` and `refuse-right-edge`
// decide along the other axis: specs/hopping.md refuses a hop whose target tile
// "is outside the grid: `inBounds(col, row)` is false", and specs/strait.md fixes
// `ROWS` (`20`) with "row `19` the bottom row the critter starts on" (`ROW_NEAR`).
// A hop down from row `19` targets row `20` and is refused, leaving "everything as
// it was: the critter stays where it stands ... no life is lost".
//
// IT IS ITS OWN ITEM because this is the edge a player leans on constantly — the
// near shore is where every crossing begins and where a critter retreats to — and
// a build that clamps its columns and forgets its rows walks the critter off the
// bottom of the strait on the first press. Both halves are read: the tile, and the
// lives.
//
// THE WORLD IS THE REFUSAL AND NOTHING ELSE. `startCrossing` empties the strait,
// shuts the four world gates and leaves the critter on the near shore at
// `START_COL`, which specs/strait.md makes solid ice across its full width, so
// nothing but the refused hop can move it or reach it. The drive runs on for a
// quarter of a second after the press so that a life taken a tick late is still
// seen.
//
// THE PRESS IS DOWN, ONE WHOLE TICK, UP. specs/controls.md reads the four movement
// actions as HELD on the `playing` screen, so a key genuinely down while a tick
// runs is the one press a held reading and a press-edge reading both see, and
// exactly once: `HOP_COOLDOWN` is `14.4` ticks, so no second request can follow
// inside that tick.

import { afterEach, beforeEach, it } from "vitest";
import { ROW_NEAR, START_COL, START_LIVES } from "../constants";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  holdFor,
  keyFor,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** How long the drive runs on after the refused press, in ticks. */
const SETTLE_TICKS = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a hop down from the near shore and costs no life", async () => {
  startCrossing(h);

  const posed = h.snapshot().critter;
  assertEqual(posed.row, ROW_NEAR, "a crossing begins on the near shore");
  assertEqual(posed.col, START_COL, "a crossing begins at the start column");

  const after = await captureReplay(h, "refuse", async () => {
    await holdFor(h, keyFor("down"), 1);
    await h.advance(SETTLE_TICKS);
    return h.snapshot();
  });

  assertEqual(
    after.critter.row,
    ROW_NEAR,
    "the near-shore row it stood on: a hop off the grid is refused (specs/hopping.md)",
  );
  assertEqual(after.critter.col, START_COL, "the column it stood on");
  assertEqual(after.critter.present, true, "the critter still on the strait");
  assertEqual(
    after.lives,
    START_LIVES,
    "the lives the run began with: a refused hop costs none (specs/hopping.md)",
  );
});
