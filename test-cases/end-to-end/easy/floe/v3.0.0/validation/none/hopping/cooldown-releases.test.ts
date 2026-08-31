// hopping/cooldown-releases — a press once the cooldown has run out moves a tile.
//
// The other half of the cadence `specs/hopping.md` fixes: the cooldown "counts
// down with the simulation, and the critter hops whenever a direction is being
// requested and the cooldown has reached `0`". `cooldown-blocks` decides that a
// press inside the cooldown is ignored; this decides that the cooldown genuinely
// EXPIRES, so a build that latched the critter for good, or that runs a cooldown
// far longer than the specification's, is caught here rather than passing for
// being merely strict.
//
// THE TOLERANCE IS THE TICK, TWICE OVER. `HOP_COOLDOWN` is `0.12` s and a tick is
// `TICK_DT` (`1/120` s), so `0.12` s is `14.4` ticks and the cooldown can only
// reach `0` on the fifteenth — `ticksPast(HOP_COOLDOWN)`. A build is free to test
// the cooldown before subtracting the tick or after, both of which play
// identically, so the second press is delivered one tick later still, on the
// sixteenth (`0.1333` s): every build whose cooldown is at most that hops.
// Together with `cooldown-blocks` this brackets the cadence to
// `[0.0667, 0.1333]` s, one tick either side of the figure.
//
// The key is released between the two presses, so this is a second press rather
// than the auto-repeat `held-repeats` decides. Both hops run up an emptied ice
// band (`specs/strait.md`), where no refusal rule can reach either tile.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOP_COOLDOWN, HOP_KEY, START_COL } from "../constants";
import {
  captureReplay,
  createHarness,
  startCrossing,
  ticksPast,
  type Harness,
} from "../harness";

/** A row of the ice band with two clear rows above it. */
const ROW = 16;

/**
 * The ticks run between the hop and the second press.
 *
 * The press takes one further tick to be delivered, so it lands on the tick after
 * the earliest one the cooldown can have reached `0` on.
 */
const REST_TICKS = ticksPast(HOP_COOLDOWN);

/** How long the drive runs on after the second hop, for the evidence. */
const SETTLE_TICKS = ticksPast(HOP_COOLDOWN);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("takes a second hop from a press once the cooldown has run out", async () => {
  await startCrossing(harness);
  await harness.debug.addCritter(START_COL, ROW);

  const after = await captureReplay(harness, "hop", async () => {
    await harness.tap(HOP_KEY.up);
    const hopped = await harness.snapshot();
    assertEqual(hopped.critter.row, ROW - 1, "the first hop to be taken");

    await harness.advance(REST_TICKS);
    await harness.tap(HOP_KEY.up);
    await harness.advance(SETTLE_TICKS);
    return harness.snapshot();
  });

  assertEqual(after.critter.row, ROW - 2, "the row a second hop reaches");
  assertEqual(after.critter.col, START_COL, "the column, which no hop changed");
});
