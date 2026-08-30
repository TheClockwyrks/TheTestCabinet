// cursor/bolt-vanishes-at-top — a bolt that reaches the top of the board leaves
// it.
//
// specs/cursor.md: "A bolt that reaches the top of the board without resolving
// against anything is gone: once its center passes `BOARD_Y` (`80`), it leaves
// the board and is removed from flight."
//
// TWO READINGS, BOTH OF THE ONE RULE, AND NEITHER OF THEM A RATE. The roster
// empties, so the bolt is removed rather than parked at the ceiling or carried
// on above the board forever; and no bolt is ever REPORTED in flight with its
// centre past `BOARD_Y`, so a build that keeps a departed bolt around for a
// frame or two of drawing fails as surely as one that never removes it. The
// second reading is exact because the removal is stated as happening in the
// update the centre passes: a bolt visible between two frames has not passed.
//
// The sweep is frame by frame and generously capped, so nothing here measures
// how fast the bolt climbed — that is `cursor.bolt-travels-up`'s requirement.
// The bolt is posed one row into the board on an empty column, so the only thing
// that can happen to it is the departure this point is about.

import { afterEach, beforeEach, it } from "vitest";
import { BOARD_Y, tileCX, tileCY } from "../../src/constants";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseBolt,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The column the bolt climbs, and the row it is posed on: one into the board. */
const COLUMN = 20;
const START_ROW = 1;

/**
 * How long the sweep waits for the bolt to leave flight, in frames.
 *
 * Two seconds. At `BOLT_SPEED` (900) the whole 640-unit board takes 0.71 s, so
 * this leaves room for a build whose bolt climbs slower than the specified rate
 * and still decides this point on the departure alone.
 */
const SWEEP_TICKS = ticksFor(2);

/**
 * How far past `BOARD_Y` a bolt still in the roster may be reported, in logical
 * units: floating-point noise alone, because the specification removes it in the
 * update its centre passes.
 */
const DEPARTURE_TOLERANCE = 1e-6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes the bolt once its centre passes BOARD_Y", async () => {
  startPlaying(h);
  poseBolt(h, tileCX(COLUMN), tileCY(START_ROW));

  let gone = false;
  // The lowest `y` any bolt was reported at while still in flight. A bolt that
  // has not passed the top of the board has `y >= BOARD_Y`.
  let highest = h.snapshot().bolts[0]?.y ?? Infinity;
  for (let frame = 0; frame < SWEEP_TICKS; frame += 1) {
    await h.advance(1);
    const bolts = h.snapshot().bolts;
    if (bolts.length === 0) {
      gone = true;
      break;
    }
    highest = Math.min(highest, ...bolts.map((bolt) => bolt.y));
  }
  captureStill(h, "empty");

  assertEqual(gone, true, "the bolt roster empties at the top of the board");
  assertGreaterThanOrEqual(
    highest,
    BOARD_Y - DEPARTURE_TOLERANCE,
    "no bolt is reported in flight above the board",
  );
});
