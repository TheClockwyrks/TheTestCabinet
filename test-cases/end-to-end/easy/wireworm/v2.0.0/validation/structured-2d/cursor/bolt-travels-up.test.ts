// cursor/bolt-travels-up — a bolt climbs its column at BOLT_SPEED.
//
// specs/cursor.md: "A bolt travels straight up at `BOLT_SPEED` [900 units per
// second], integrated against the delta time of each update." The rise over a
// known window is the direct reading of that rate.
//
// WHY THE WINDOW IS HALF A SECOND. The board is 640 units tall — `y` in
// [80, 720] (specs/board.md) — so a bolt at `BOLT_SPEED` crosses the whole of it
// in 0.71 s and a one-second window would carry it off the top, where
// `cursor.bolt-vanishes-at-top` requires it to be gone. Half a second is 450
// units, from `CURSOR_Y_MAX` (704) to about y = 254, which is well inside the
// board with room to spare either side of the tolerance.
//
// The bolt is POSED with `addBolt` rather than fired: where a fired bolt appears
// is `cursor.bolt-spawns-at-cursor`'s requirement, and posing it keeps the
// cooldown, the cap and the muzzle offset out of a reading about the climb
// alone. `startPlaying` empties the board, so nothing stands in the column to
// consume the bolt on the way up.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, CURSOR_Y_MAX, tileCX } from "../constants";
import { assertLessThanOrEqual, fail } from "../assert";
import {
  boltById,
  captureReplay,
  createHarness,
  poseBolt,
  startPlaying,
  ticksFor,
  type BoltSnapshot,
  type Harness,
} from "../harness";

/** The column the bolt climbs. Any column will do; the board is empty. */
const COLUMN = 20;

/** The window the climb is measured over, in seconds, and in frames. */
const WINDOW = 0.5;
const WINDOW_TICKS = ticksFor(WINDOW);

/** What `BOLT_SPEED` covers in that window, in logical units: 450. */
const EXPECTED_RISE = BOLT_SPEED * WINDOW;

/**
 * How far the measured rise may sit from that figure, in logical units: the 5%
 * the review item states.
 */
const RISE_TOLERANCE = EXPECTED_RISE * 0.05;

/** The bolt with that id, or the failure naming what the build owes. */
function boltNow(h: Harness, id: number, requirement: string): BoltSnapshot {
  const bolt = boltById(h.snapshot(), id);
  if (bolt === undefined) fail(requirement, "no bolt with that id in flight");
  return bolt;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("rises BOLT_SPEED * 0.5 units in half a second up a clear column", async () => {
  startPlaying(h);
  const id = poseBolt(h, tileCX(COLUMN), CURSOR_Y_MAX);
  const from = boltNow(h, id, "addBolt to put a bolt in flight");

  const to = await captureReplay(h, "climb", async () => {
    await h.advance(WINDOW_TICKS);
    return boltNow(
      h,
      id,
      "the bolt still in flight half a second up a clear column",
    );
  });

  const rise = from.y - to.y;
  assertLessThanOrEqual(
    Math.abs(rise - EXPECTED_RISE),
    RISE_TOLERANCE,
    `the bolt rose ${rise} units from y ${from.y} in half a second`,
  );
});
