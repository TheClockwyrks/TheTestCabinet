// hopping/cooldown-releases — a press once the cooldown has run out moves a
// further tile.
//
// specs/hopping.md: "The cooldown counts down with the simulation, and the critter
// hops whenever a direction is being requested and the cooldown has reached `0`."
// An accepted hop sets the cooldown to `HOP_COOLDOWN` (`0.12` s), so a press
// offered once that much game time has passed is a hop again.
//
// This is the POSITIVE half of the cadence, and its negative twin,
// `hopping/cooldown-blocks`, presses inside the cooldown instead and requires
// nothing to move. A build that never lets the cooldown run out fails this one and
// passes that one; a build with no cooldown at all fails that one and passes this
// one.
//
// WHERE THE SECOND PRESS LANDS. `HOP_COOLDOWN` is `14.4` ticks of the fixed step
// (specs/overview.md), which no whole number of ticks reaches exactly, so the first
// tick at which none of the cooldown is left is the fifteenth — `HOP_COOLDOWN_TICKS`,
// rounded up. Pressing there is a press at or after the stated `0.12` s under
// either rounding, so a build that spends the cooldown on the fourteenth tick and
// one that spends it on the fifteenth both have to take this hop.

import { afterEach, beforeEach, it } from "vitest";
import { ROW_NEAR, START_COL, tileCX, tileCY } from "../constants";
import { assertCloseTo, assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  holdFor,
  HOP_COOLDOWN_TICKS,
  keyFor,
  startCrossing,
  type Harness,
} from "../harness";

/** The centre of a tile is exact (specs/hopping.md), so the tolerance is float noise. */
const CENTRE_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes a second hop for a press at the cooldown", async () => {
  startCrossing(h);
  assertEqual(h.snapshot().critter.col, START_COL, "the starting column");

  const hops = await captureReplay(h, "hop", async () => {
    // One press held for one whole tick is one frame, which is the tick the press
    // is offered to and the tick the hop is taken on.
    await holdFor(h, keyFor("right"), 1);
    const first = h.snapshot().critter;

    // The press below runs the frame that completes `HOP_COOLDOWN_TICKS` ticks
    // since the hop, which is the first tick at which none of the cooldown is left.
    await h.advance(HOP_COOLDOWN_TICKS - 1);
    await holdFor(h, keyFor("right"), 1);
    return { first, second: h.snapshot().critter };
  });

  assertEqual(
    hops.first.col,
    START_COL + 1,
    "the column the first hop reached",
  );
  assertEqual(
    hops.second.col,
    START_COL + 2,
    "the column after a press at the cooldown",
  );
  assertEqual(hops.second.row, ROW_NEAR, "the row a sideways hop leaves alone");
  assertCloseTo(
    hops.second.x,
    tileCX(START_COL + 2),
    CENTRE_DIGITS,
    "centre x after the second hop",
  );
  assertCloseTo(
    hops.second.y,
    tileCY(ROW_NEAR),
    CENTRE_DIGITS,
    "centre y after the second hop",
  );
});
