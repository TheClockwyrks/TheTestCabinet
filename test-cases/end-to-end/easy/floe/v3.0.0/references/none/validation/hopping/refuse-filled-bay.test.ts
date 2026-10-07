// hopping/refuse-filled-bay — a bay already filled refuses the hop into it.
//
// `specs/hopping.md` refuses a hop whose target tile "is on row `1` at a column of
// a bay that is already filled", and leaves "everything as it was: the critter
// stays where it stands ... no life is lost". `refuse-far-shore` decides the
// shore BETWEEN the bays; this decides a column that is a bay, and turns on
// whether the build reads the bay's STATE rather than only its geometry.
//
// SO THE SAME HOP IS TAKEN TWICE, FROM THE SAME TILE, WITH ONLY THE BAY'S STATE
// CHANGED. Posed filled, the hop must be refused; posed open, the same hop must
// be accepted. Without the second half a build that had simply sealed the whole
// bay row would pass — it refuses everything — and the refusal would name nothing.
// With it, the pair separates "reads `bays[index]`" from "refuses row `1`
// outright" and from "lets every bay through".
//
// WHAT ACCEPTANCE IS READ BY. Entering a bay ends the crossing at once
// (`specs/bays.md`), so the critter is off the strait on the tick it arrives and
// its tile is no longer the thing to read; the bay standing FILLED afterwards is.
// The bay is posed open again before the second hop, so the reading is
// unambiguous: it can only have been filled by the hop.
//
// THE CRITTER STANDS ON A FLOE HELD STILL. Row `2` is deep water and a critter
// whose center no floe covers loses a life on that very tick (`specs/water.md`),
// and the stopped lane also keeps it in the bay's own column for both hops.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import {
  BAYS,
  HOP_KEY,
  START_LIVES,
  WATER_TOP,
  bayAtColumn,
} from "../constants";
import {
  captureReplay,
  createHarness,
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

/** How long the drive runs on after each press. */
const SETTLE_TICKS = ticksFor(0.25);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("refuses a hop into a filled bay, and accepts the same hop once it is open", async () => {
  // The column is only worth hopping from if it really is this bay's, so the
  // case's own bay table is read here rather than assumed.
  assertNotNull(bayAtColumn(COL), `column ${COL} covered by a bay`);
  assertEqual(bayAtColumn(COL), BAY, `column ${COL} covered by bay ${BAY}`);

  await startCrossing(harness);
  await poseLane(harness, ROW, "raft3", [COL - 1]);
  await harness.debug.addCritter(COL, ROW);
  await harness.debug.setBay(BAY, true);

  const refused = await captureReplay(harness, "refuse", async () => {
    await harness.tap(HOP_KEY.up);
    await harness.advance(SETTLE_TICKS);
    const blocked = await harness.snapshot();

    await harness.debug.setBay(BAY, false);
    await harness.tap(HOP_KEY.up);
    await harness.advance(SETTLE_TICKS);
    return { blocked, opened: await harness.snapshot() };
  });

  assertEqual(refused.blocked.critter.row, ROW, "the row the critter stood on");
  assertEqual(refused.blocked.critter.col, COL, "the column it stood on");
  assertEqual(
    refused.blocked.critter.present,
    true,
    "the critter still on the strait, the filled bay having refused it",
  );
  assertEqual(
    refused.blocked.lives,
    START_LIVES,
    "the lives the run began with",
  );
  assertEqual(
    refused.blocked.bays[BAY],
    true,
    `bay ${BAY} still filled, the refused hop having changed nothing`,
  );

  assertEqual(
    refused.opened.bays[BAY],
    true,
    `bay ${BAY} filled by the same hop once it was open`,
  );
});
