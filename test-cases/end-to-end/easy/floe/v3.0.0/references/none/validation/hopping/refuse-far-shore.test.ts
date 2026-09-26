// hopping/refuse-far-shore — the solid far shore between the bays refuses a hop.
//
// `specs/hopping.md` refuses a hop whose target tile "is on row `1` at a column no
// bay covers", and `specs/strait.md` fixes which columns those are: the bay row is
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
// the bays DO occupy is `strait.bay-columns`; this decides only that the shore
// between them is closed.
//
// THE CRITTER STANDS ON A FLOE HELD STILL. Row `2` is deep water and a critter
// whose center no floe covers loses a life on that very tick (`specs/water.md`),
// so a bare pose there would grade the drowning rule instead of this one. The
// floe is the row's own kind and its lane is stopped, so the critter is on
// footing for the whole check and the column it hops from is the column it was
// posed on.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { HOP_KEY, START_LIVES, WATER_TOP, bayAtColumn } from "../constants";
import {
  captureReplay,
  createHarness,
  poseLane,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The water row the hop is taken from, and the column it is taken at. */
const ROW = WATER_TOP;
const COL = 7;

/** How long the drive runs on after the refused press. */
const SETTLE_TICKS = ticksFor(0.25);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("refuses a hop up into the solid shore between two bays and costs no life", async () => {
  // The column is only worth hopping from if the specification really leaves it
  // solid, so the case's own bay table is read here rather than assumed.
  assertNull(bayAtColumn(COL), `column ${COL} covered by no bay`);

  await startCrossing(harness);
  await poseLane(harness, ROW, "raft3", [COL - 1]);
  await harness.debug.addCritter(COL, ROW);

  const after = await captureReplay(harness, "refuse", async () => {
    await harness.tap(HOP_KEY.up);
    await harness.advance(SETTLE_TICKS);
    return harness.snapshot();
  });

  assertEqual(after.critter.row, ROW, "the row the critter stood on");
  assertEqual(after.critter.col, COL, "the column the critter stood on");
  assertEqual(after.critter.present, true, "the critter still on the strait");
  assertEqual(after.lives, START_LIVES, "the lives the run began with");
});
