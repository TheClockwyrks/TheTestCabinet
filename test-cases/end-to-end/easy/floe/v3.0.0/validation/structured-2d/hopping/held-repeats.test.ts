// hopping/held-repeats — a held direction auto-repeats at the cooldown.
//
// specs/hopping.md (The cadence): "A direction held across the cooldown hops
// again the moment the cooldown reaches `0`, so holding a direction
// auto-repeats at `HOP_COOLDOWN`" (`0.12` s), and specs/controls.md reads the
// four movement actions as HELD on the playing screen. A direction held for one
// second of game time therefore hops the whole cooldowns that second covers,
// plus the one at the start that no cooldown precedes.
//
// The hold runs ALONG the near shore rather than up the strait. The near shore
// is solid across its whole width (specs/strait.md), so nine hops in a row are
// nine accepted hops; nine hops UP from row 19 would climb into the water band,
// where the count would stop being a reading about the cadence and start being
// one about drowning. `startCrossing` leaves the strait empty and quiet, so the
// only thing moving the critter over that second is the key that is down.

import { afterEach, beforeEach, it } from "vitest";
import { HOP_COOLDOWN, ROW_NEAR, START_COL } from "../../src/constants";
import { assertBetween, assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  critterTile,
  holdActionFor,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The window the direction is held for, in seconds of game time. */
const HOLD_SECONDS = 1;

/**
 * Hops that window must produce: the whole cooldowns it covers,
 * `floor(1 / HOP_COOLDOWN)` (`8`), plus the opening hop, which is taken on the
 * first held frame with no cooldown to wait out — `9`.
 */
const EXPECTED_HOPS = Math.floor(HOLD_SECONDS / HOP_COOLDOWN) + 1;

/**
 * The tolerance, in hops: one. `HOP_COOLDOWN` is `14.4` ticks, which no whole
 * number of simulation ticks lands on, so where the last repeat of the window
 * falls depends on which side of a tick boundary a conformant build rounds to —
 * a difference of one hop in nine, and nothing the specification fixes.
 */
const HOP_TOLERANCE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("hops about nine tiles for a direction held one second", async () => {
  startCrossing(h);
  const start = critterTile(h.snapshot());
  assertEqual(start.col, START_COL, "the column a fresh crossing starts on");

  const after = await captureReplay(h, "hop", async () => {
    await holdActionFor(h, "left", ticksFor(HOLD_SECONDS));
    return h.snapshot();
  });

  assertEqual(after.critter.row, ROW_NEAR, "the row a held LEFT ends on");
  assertBetween(
    start.col - after.critter.col,
    EXPECTED_HOPS - HOP_TOLERANCE,
    EXPECTED_HOPS + HOP_TOLERANCE,
    "hops taken in one second of a held direction",
  );
});
