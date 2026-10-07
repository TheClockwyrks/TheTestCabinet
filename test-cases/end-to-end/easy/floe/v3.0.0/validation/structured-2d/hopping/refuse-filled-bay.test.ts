// hopping/refuse-filled-bay — a filled bay refuses a hop, an open one takes it.
//
// specs/hopping.md (Refused hops): a hop is refused when its target tile "is on
// row `1` at a column of a bay that is already filled", and "a refused hop
// leaves everything as it was ... no life is lost". specs/bays.md fixes the
// other half: "The two columns of an open bay are the only tiles of the far
// shore a hop may land on", and a crossing "ends on the hop that lands the
// critter in an open bay, which is a hop up from row `2`", on which "that bay
// becomes filled".
//
// Both halves are here because the two together are what the item is: the SAME
// hop, from the same tile, refused with the bay filled and accepted with it
// open. A build that closes the whole bay row passes the first half alone; a
// build that ignores a bay's filled state passes the second alone. Only the pair
// separates them, and only the pair proves the refusal is the bay's state rather
// than the column.
//
// The critter is posed on the top water row under bay `2`, on a raft held still
// so that a bare water tile is not what decides the scene (specs/water.md), and
// the bay is posed filled with `setBay`. After the refusal the reading is taken
// again a settling window later, because a refusal costs no life. The bay is
// then opened, the hop cooldown is posed back to `0`, and the same hop is taken
// again. Posing the cooldown rather than waiting it out keeps the second half
// about the bay: the cadence is a rule of its own, with its own items.

import { afterEach, beforeEach, it } from "vitest";
import { BAYS, START_LIVES, WATER_TOP } from "../constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureReplay,
  createHarness,
  hop,
  poseLane,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The middle bay, and the column of it the critter hops up into. */
const BAY = 2;
const BAY_COL = BAYS[BAY][1];

/** The raft's left edge, so its three tiles cover the bay's column. */
const RAFT_COL = BAY_COL - 1;

/** Frames watched after the refused press: half a second of game time. */
const SETTLE_FRAMES = ticksFor(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a hop into a filled bay and takes the same hop once it is open", async () => {
  startCrossing(h);
  poseLane(h, WATER_TOP, "raft3", [RAFT_COL]);
  h.debug.setCritterTile(BAY_COL, WATER_TOP);
  h.debug.setBay(BAY, true);

  const seen = await captureReplay(h, "refuse", async () => {
    await hop(h, "up");
    await h.advance(SETTLE_FRAMES);
    const refused = h.snapshot();

    h.debug.setBay(BAY, false);
    h.debug.setHopCooldown(0);
    const moved = await hop(h, "up");
    return { refused, moved, accepted: h.snapshot() };
  });

  assertEqual(
    seen.refused.critter.row,
    WATER_TOP,
    "the row after the hop into the filled bay",
  );
  assertEqual(
    seen.refused.critter.col,
    BAY_COL,
    "the column after the hop into the filled bay",
  );
  assertEqual(
    seen.refused.lives,
    START_LIVES,
    "lives after the hop into the filled bay",
  );
  assertEqual(
    seen.refused.phase,
    "crossing",
    "the phase after the hop into the filled bay",
  );
  assertTrue(
    seen.refused.critter.present,
    "the critter still in play after a refused hop",
  );
  assertEqual(
    seen.refused.bays[BAY],
    true,
    `bay ${BAY} still filled after the refused hop, which changed nothing`,
  );

  assertEqual(
    seen.moved,
    true,
    "the same hop, with the bay open, to be accepted",
  );
  assertEqual(
    seen.accepted.bays[BAY],
    true,
    `bay ${BAY} filled by the accepted hop`,
  );
});
