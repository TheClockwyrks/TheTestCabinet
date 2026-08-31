// hopping/cooldown-blocks — a press inside the cooldown moves nothing.
//
// `specs/hopping.md` fixes the cadence: an accepted hop "sets the hop cooldown to
// `HOP_COOLDOWN`", the cooldown "counts down with the simulation", and "a press
// while the cooldown is running is ignored, and the critter does not hop". So a
// hop, then a fresh press `0.06` s later — half of `HOP_COOLDOWN` (`0.12` s) —
// must leave the critter on the tile the first hop reached.
//
// THE SECOND PRESS IS A GENUINELY NEW ONE. The key is released after the first
// hop and pressed again for the second, so this decides the cooldown rather than
// the auto-repeat rule that `held-repeats` decides: a build that ignores held
// keys entirely still has to refuse this press.
//
// THE TOLERANCE IS THE TICK. Ticks are `TICK_DT` (`1/120` s) and a press is
// delivered by running the tick that carries it, so the second press lands on the
// eighth tick after the hop — the first whole tick past `0.06` s, at `0.0667` s.
// A build refuses it whenever its cooldown exceeds that, which is a little over
// half the `0.12` s the specification fixes; a build with no cooldown at all, or
// with one shorter than half the figure, hops and is caught.
//
// Both tiles are plain solid ice in the middle of an emptied band
// (`specs/strait.md`), so no refusal rule and nothing on the strait can account
// for the critter staying put.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOP_COOLDOWN, HOP_KEY, START_COL } from "../constants";
import {
  captureReplay,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** A row of the ice band with two clear rows above it. */
const ROW = 16;

/**
 * The ticks run between the hop and the second press.
 *
 * The press itself takes one further tick to be delivered, so it lands at
 * `(ticksFor(0.06) + 1) * TICK_DT` — `0.0667` s — after the hop: the first whole
 * tick past the `0.06` s the item states.
 */
const REST_TICKS = ticksFor(HOP_COOLDOWN / 2);

/** How long the drive runs on after the refused press, for the evidence. */
const SETTLE_TICKS = ticksFor(0.25);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("ignores a press taken half a cooldown after a hop", async () => {
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

  assertEqual(
    after.critter.row,
    ROW - 1,
    "the row the first hop reached, the second press ignored",
  );
  assertEqual(after.critter.col, START_COL, "the column, which no hop changed");
});
