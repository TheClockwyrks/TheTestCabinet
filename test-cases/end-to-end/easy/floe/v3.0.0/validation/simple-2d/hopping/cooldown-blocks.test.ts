// hopping/cooldown-blocks — a press taken while the cooldown is still running
// moves nothing.
//
// specs/hopping.md: "A press while the cooldown is running is ignored, and the
// critter does not hop." An accepted hop sets the cooldown to `HOP_COOLDOWN`
// (`0.12` s), so a second press half a cooldown later falls squarely inside it and
// is worth nothing at all — the critter is still on the tile the first hop
// reached.
//
// This is the NEGATIVE half of the cadence. Its positive twin,
// `hopping/cooldown-releases`, presses at the cooldown instead and requires the
// hop, so a build that ignores the cooldown entirely fails this one alone and a
// build that never lets it run out fails that one alone.
//
// Both hops are driven sideways along the near shore, which specs/strait.md fixes
// as solid ice across the full width, so the only thing that can move the critter
// is a hop the build accepted.

import { afterEach, beforeEach, it } from "vitest";
import { HOP_COOLDOWN, ROW_NEAR, START_COL, tileCX } from "../../src/constants";
import { assertCloseTo, assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  holdFor,
  keyFor,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * When the second press is offered, in ticks after the first hop.
 *
 * The item's figure is `0.06` s, which is half of `HOP_COOLDOWN`; rounded up to a
 * whole tick of the fixed step (specs/overview.md) that is `0.0667` s, still a
 * little over half the cooldown and a long way inside it however a build rounds
 * the `14.4` ticks the cooldown itself spans.
 */
const PRESS_AT_TICKS = ticksFor(HOP_COOLDOWN / 2);

/** The centre of a tile is exact (specs/hopping.md), so the tolerance is float noise. */
const CENTRE_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the critter where the first hop put it", async () => {
  startCrossing(h);
  assertEqual(h.snapshot().critter.col, START_COL, "the starting column");

  const hops = await captureReplay(h, "hop", async () => {
    // One press held for one whole tick is one frame, which is the tick the press
    // is offered to and the tick the hop is taken on.
    await holdFor(h, keyFor("right"), 1);
    const first = h.snapshot().critter;

    // The press below runs the frame that completes `PRESS_AT_TICKS` ticks since
    // the hop, so the second press lands there and not a tick either side.
    await h.advance(PRESS_AT_TICKS - 1);
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
    START_COL + 1,
    "the column after a press inside the cooldown",
  );
  assertEqual(hops.second.row, ROW_NEAR, "the row after that press");
  assertCloseTo(
    hops.second.x,
    tileCX(START_COL + 1),
    CENTRE_DIGITS,
    "centre x after that press",
  );
});
