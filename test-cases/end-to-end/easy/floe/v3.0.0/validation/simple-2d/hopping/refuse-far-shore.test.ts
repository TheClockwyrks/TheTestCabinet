// hopping/refuse-far-shore — the solid far shore between the bays refuses a hop.
//
// specs/hopping.md refuses a hop whose target tile "is on row `1` at a column no
// bay covers", and specs/strait.md fixes which columns those are: the bay row is
// "solid far shore except at five bays", at the column pairs `3,4`, `11,12`,
// `19,20`, `27,28` and `35,36`, and "every column of row `1` outside those ten is
// solid far shore". So a hop up from row `2` at a column outside every pair is
// refused, and "a refused hop leaves everything as it was: the critter stays where
// it stands ... no life is lost".
//
// COLUMN 7 IS THE ONE HOPPED FROM, and it is chosen for being unambiguous: it is
// three columns clear of bay `0` (`3,4`) and four clear of bay `1` (`11,12`), so a
// build whose bay columns are off by one or two in either direction still refuses
// here and a build that treats the whole bay row as open does not. Which columns
// the bays DO occupy is `strait`'s business; this decides only that the shore
// between them is closed.
//
// THE CRITTER STANDS ON A FLOE HELD STILL. Row `2` is deep water and a critter
// whose centre no floe covers loses a life on that very tick (specs/water.md), so
// a bare pose there would grade the drowning rule instead of this one. The floe is
// one of the row's own kind and {@link poseLane} parks its lane at speed `0`, so
// the critter is on footing for the whole check and the column it hops from is the
// column it was posed on rather than one the drift carried it into.
//
// THE PRESS IS DOWN, ONE WHOLE TICK, UP. specs/controls.md reads the four movement
// actions as HELD on the `playing` screen, so a key genuinely down while a tick
// runs is the one press a held reading and a press-edge reading both see, and
// exactly once: `HOP_COOLDOWN` is `14.4` ticks, so no second request can follow
// inside that tick.

import { afterEach, beforeEach, it } from "vitest";
import { START_LIVES, WATER_TOP } from "../../src/constants";
import { assertEqual, assertNull } from "../assert";
import {
  bayAt,
  captureReplay,
  createHarness,
  holdFor,
  keyFor,
  poseLane,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The water row the hop is taken from, and the column it is taken at. */
const ROW = WATER_TOP;
const COL = 7;

/** The left edge of the three-tile raft, so it spans columns 6, 7 and 8. */
const RAFT_COL = COL - 1;

/** How long the drive runs on after the refused press, in ticks. */
const SETTLE_TICKS = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a hop up into the solid shore between two bays and costs no life", async () => {
  // The column is only worth hopping from if the specification really leaves it
  // solid, so the case's own bay table is read here rather than assumed.
  assertNull(bayAt(COL), `column ${COL} covered by no bay (specs/strait.md)`);

  startCrossing(h);
  poseLane(h, ROW, "raft3", [RAFT_COL]);
  h.debug.addCritter(COL, ROW);

  const posed = h.snapshot().critter;
  assertEqual(posed.col, COL, "the pose put the critter under the solid shore");
  assertEqual(posed.row, ROW, "the pose put the critter on the top water row");

  const after = await captureReplay(h, "refuse", async () => {
    await holdFor(h, keyFor("up"), 1);
    await h.advance(SETTLE_TICKS);
    return h.snapshot();
  });

  assertEqual(
    after.critter.row,
    ROW,
    "the row the critter stood on: row 1 at a column no bay covers is refused (specs/hopping.md)",
  );
  assertEqual(after.critter.col, COL, "the column the critter stood on");
  assertEqual(after.critter.present, true, "the critter still on the strait");
  assertEqual(
    after.lives,
    START_LIVES,
    "the lives the run began with: a refused hop costs none (specs/hopping.md)",
  );
});
