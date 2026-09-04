// instrumentation/sim-time-accumulates — `simTime` is the game time that has
// passed, on every screen.
//
// specs/instrumentation.md: "`simTime` accumulates every update's delta, whatever
// the screen."
//
// WHY THE SUITE RESTS ON IT. `simTime` is the clock the double-click window is
// measured against (specs/controls.md), the stamp `lastPress` carries, and the
// reading every timing check in this project takes to say how much game time its
// scenario covered. A build that accumulated wall-clock time, or that stopped the
// clock on a menu, would make each of those readings mean something else.
//
// ALL FOUR SCREENS, one at a time, because "whatever the screen" is the whole of
// the rule: a build that only ticks the clock during play passes on `playing` and
// fails on `title`, and a failure names the screen it happened on.
//
// THE TABLE IS EMPTY AND THE SECOND IS TAKEN AS A DIFFERENCE. Each screen is opened
// from a fresh `reset`, so nothing on the table can move under the reading, and
// what is asserted is the GROWTH over the second rather than the absolute figure,
// so a build that starts its clock somewhere other than zero is decided by
// `reset-restores-title` and not twice here.
//
// THE SPAN IS A WHOLE NUMBER OF THE SUITE'S OWN FRAMES, and it is compared against
// the game time those frames really cover, `seconds(HOLD_FRAMES)`, rather than
// against a nominal one second, so the reading is of the deltas the build was
// handed and not of the suite's rounding.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  openTable,
  seconds,
  type Harness,
  type Screen,
} from "../harness";

/** The four screens the game moves between (specs/screens.md). */
const SCREENS: readonly Screen[] = ["title", "howto", "playing", "won"];

/** The second of game time the item names, as whole frames of the suite's clock. */
const HOLD_FRAMES = framesFor(1);
const HOLD = seconds(HOLD_FRAMES);

/**
 * The tolerance on the second `simTime` gained.
 *
 * Six decimal places. Every frame is handed exactly `1 / TICK_HZ` seconds by the
 * suite's constant clock, so anything past float noise is a build accumulating
 * something other than the delta it was given.
 */
const EXACT = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gains a second of simTime over a second of game time, on every screen", async () => {
  for (const screen of SCREENS) {
    openTable(h);
    h.debug.setScreen(screen);

    const before = h.snapshot().simTime;
    await h.advance(HOLD_FRAMES);
    const after = h.snapshot().simTime;

    assertCloseTo(
      after - before,
      HOLD,
      EXACT,
      `the simTime gained over ${HOLD} s of game time on the ${screen} ` +
        "screen (specs/instrumentation.md)",
    );
  }

  // The board after the advanced second, on the last screen the sweep ran.
  captureStill(h, "advanced");
});
