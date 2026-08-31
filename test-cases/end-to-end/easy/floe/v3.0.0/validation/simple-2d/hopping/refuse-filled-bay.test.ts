// hopping/refuse-filled-bay — a bay already filled refuses the hop into it.
//
// specs/hopping.md refuses a hop whose target tile "is on row `1` at a column of a
// bay that is already filled", and leaves "everything as it was: the critter stays
// where it stands ... no life is lost". `refuse-far-shore` decides the shore
// BETWEEN the bays; this decides a column that IS a bay, and so turns on whether
// the build reads the bay's STATE rather than only its geometry.
//
// SO THE SAME HOP IS TAKEN TWICE, FROM THE SAME TILE, WITH ONLY THE BAY'S STATE
// CHANGED. Posed filled, the hop must be refused; posed open, the same hop must be
// accepted. Without the second half a build that had simply sealed the whole bay
// row would pass — it refuses everything — and the refusal would name nothing.
// With it, the pair separates "reads `bays[index]`" from "refuses row `1`
// outright" and from "lets every bay through".
//
// WHAT ACCEPTANCE IS READ BY. Entering a bay ends the crossing at once
// (specs/bays.md), so the critter is off the strait on the tick it arrives and its
// tile is no longer the thing to read; the bay standing FILLED afterwards is. The
// bay is posed open again before the second hop, so the reading is unambiguous: it
// can only have been filled by the hop.
//
// ONLY ONE BAY IS EVER FILLED, so nothing here clears a level: a level clears on
// the hop that fills the LAST open bay (specs/bays.md), and `startCrossing` opens
// all five.
//
// THE CRITTER STANDS ON A FLOE HELD STILL. Row `2` is deep water and a critter
// whose centre no floe covers loses a life on that very tick (specs/water.md), and
// {@link poseLane}'s parked lane also keeps it in the bay's own column for both
// hops.
//
// THE PRESS IS DOWN, ONE WHOLE TICK, UP. specs/controls.md reads the four movement
// actions as HELD on the `playing` screen, so a key genuinely down while a tick
// runs is the one press a held reading and a press-edge reading both see, and
// exactly once.

import { afterEach, beforeEach, it } from "vitest";
import { BAYS, START_LIVES, WATER_TOP } from "../../src/constants";
import { assertEqual } from "../assert";
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

/** The bay hopped into, and the column of it the hop is taken under. */
const BAY = 2;
const COL = BAYS[BAY][0];

/** The water row the hop is taken from. */
const ROW = WATER_TOP;

/** The left edge of the three-tile raft, so it spans the hop's column and both neighbours. */
const RAFT_COL = COL - 1;

/** How long the drive runs on after each press, in ticks. */
const SETTLE_TICKS = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a hop into a filled bay, and accepts the same hop once it is open", async () => {
  // The column is only worth hopping from if it really is this bay's, so the
  // case's own bay table is read here rather than assumed.
  assertEqual(
    bayAt(COL),
    BAY,
    `column ${COL} covered by bay ${BAY} (specs/strait.md)`,
  );

  startCrossing(h);
  poseLane(h, ROW, "raft3", [RAFT_COL]);
  h.debug.addCritter(COL, ROW);
  h.debug.setBay(BAY, true);

  const posed = h.snapshot();
  assertEqual(posed.critter.col, COL, "the pose put the critter under the bay");
  assertEqual(posed.critter.row, ROW, "the pose put it on the top water row");
  assertEqual(posed.bays[BAY], true, `the pose filled bay ${BAY}`);

  const hops = await captureReplay(h, "refuse", async () => {
    await holdFor(h, keyFor("up"), 1);
    await h.advance(SETTLE_TICKS);
    const blocked = h.snapshot();

    h.debug.setBay(BAY, false);
    await holdFor(h, keyFor("up"), 1);
    await h.advance(SETTLE_TICKS);
    return { blocked, opened: h.snapshot() };
  });

  assertEqual(
    hops.blocked.critter.row,
    ROW,
    "the row the critter stood on: a filled bay refuses the hop (specs/hopping.md)",
  );
  assertEqual(hops.blocked.critter.col, COL, "the column it stood on");
  assertEqual(
    hops.blocked.critter.present,
    true,
    "the critter still on the strait, the filled bay having refused it",
  );
  assertEqual(
    hops.blocked.lives,
    START_LIVES,
    "the lives the run began with: a refused hop costs none (specs/hopping.md)",
  );
  assertEqual(
    hops.blocked.bays[BAY],
    true,
    `bay ${BAY} still filled, the refused hop having changed nothing`,
  );

  assertEqual(
    hops.opened.bays[BAY],
    true,
    `bay ${BAY} filled by the same hop once it was open: only the bay's state refused it`,
  );
});
