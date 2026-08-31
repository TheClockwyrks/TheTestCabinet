// hopping/held-repeats — a direction held down keeps hopping, at the cooldown's
// cadence and no faster.
//
// specs/hopping.md: "A direction held across the cooldown hops again the moment
// the cooldown reaches `0`, so holding a direction auto-repeats at
// `HOP_COOLDOWN`." One second of game time therefore buys a run of hops spaced
// `HOP_COOLDOWN` (`0.12` s) apart, which is `floor(1 / HOP_COOLDOWN) + 1` (`9`)
// of them: one at the moment the key goes down and one every `0.12` s after it,
// the last at `0.96` s.
//
// THE TOLERANCE IS ONE HOP, and it is the fixed step's, not slack. The simulation
// integrates in whole `TICK_DT` ticks (specs/overview.md) and `HOP_COOLDOWN` is
// `14.4` of them, so a build cannot hop at exactly `0.12` s intervals: rounding the
// cadence up to fifteen ticks (`0.125` s) fits eight hops into the second and
// rounding it down to fourteen (`0.1167` s) fits nine. Both readings are the
// specification integrated honestly, and `9 +/- 1` is exactly the pair of them.
// Nothing outside that pair survives: a build with no cooldown at all reads as the
// whole runway, and one that repeats at half the cadence reads as five.
//
// THE CRITTER IS POSED AT COLUMN `0` AND HOPS RIGHT, so the whole width of the near
// shore — solid ice at every column, specs/strait.md — is runway ahead of it. A
// build that repeats too fast then reads as a larger count rather than being
// clamped against the edge and reading as a refusal, which is a different point's
// business (`hopping/refuse-right-edge`).

import { afterEach, beforeEach, it } from "vitest";
import { HOP_COOLDOWN, ROW_NEAR, TICK_HZ } from "../../src/constants";
import { assertBetween, assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  holdFor,
  keyFor,
  startCrossing,
  type Harness,
} from "../harness";

/** The column the run starts from: the left edge, so the runway is the full width. */
const START = 0;

/** One second of game time, which is `TICK_HZ` ticks of the fixed step. */
const HELD_TICKS = TICK_HZ;

/** Hops in one second at the stated cadence: one at the press, one per cooldown after. */
const EXPECTED_HOPS = Math.floor(1 / HOP_COOLDOWN) + 1;

/** The whole tolerance: one hop, which is the two honest roundings of `14.4` ticks. */
const HOP_TOLERANCE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("auto-repeats about nine times over a second of holding", async () => {
  startCrossing(h);
  h.debug.setCritterTile(START, ROW_NEAR);
  assertEqual(
    h.snapshot().critter.col,
    START,
    "the column the run starts from",
  );

  const after = await captureReplay(h, "hop", async () => {
    await holdFor(h, keyFor("right"), HELD_TICKS);
    return h.snapshot().critter;
  });

  assertBetween(
    after.col - START,
    EXPECTED_HOPS - HOP_TOLERANCE,
    EXPECTED_HOPS + HOP_TOLERANCE,
    "tiles moved over one second of holding",
  );
});
