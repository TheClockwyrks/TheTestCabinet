// instrumentation/sim-time-accumulates — `simTime` is the game's own clock, and
// it takes every frame's delta whatever screen the game is on.
//
// THE RULE. `specs/instrumentation.md`: "`simTime` accumulates every update's
// delta, whatever the screen." `specs/state.md` states the field the same way:
// "The simulation time, in seconds, which every update adds its delta to whatever
// the screen."
//
// WHY THE SCREEN IS THE SUBJECT. `simTime` is what the double-click window is
// measured against (`specs/controls.md`) and what every duration in this suite
// reads, and the plausible defect is not that the clock is missing but that it is
// wired to play alone — a build that only accumulates on `playing`, or that stops
// while the victory cascade runs, reads correctly everywhere a check happens to
// be on the table and wrongly nowhere anyone looks. So the same second is spent
// on each of the four screens in turn and each is required to have carried it.
//
// A SECOND IS MEASURED AS A DIFFERENCE, not as an absolute. The four spans run
// back to back on one game, so what is asserted is the RISE across each of them
// and nothing about where the clock stood when the span began. A build whose
// clock is correct fails nothing here for the three seconds spent before the
// fourth screen's turn.
//
// THE TABLE IS EMPTY UNDER ALL FOUR. `openTable` leaves no card anywhere, so the
// `won` screen's turn runs a cascade with nothing to launch and the `playing`
// screen's runs a table with nothing on it: the second that is being timed is
// spent on the clock alone.
//
// WHAT THIS DOES NOT DECIDE. How an interval is DIVIDED into frames, which is
// `instrumentation/advances-in-frames`'s point, nor what any screen shows, which
// is `screens/*`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  openTable,
  type Harness,
  type Screen,
} from "../harness";

/** The span spent on each screen, in seconds. A whole number of frames at 240 Hz. */
const SPAN_SECONDS = 1;

/** The four screens, in the order the second is spent on them. */
const SCREENS: readonly Screen[] = ["playing", "title", "howto", "won"];

/**
 * How far a span's rise may sit from the second it was given, in decimal digits
 * for `assertCloseTo`.
 *
 * Nine, which is half a nanosecond. A conforming build accumulates exactly the
 * deltas it was handed and the only distance from `1.0` is the sum of two hundred
 * and forty doubles — this is that arithmetic, not room for a different reading of
 * the rule. A build that stops the clock on a screen misses by the whole second.
 */
const SIM_DIGITS = 9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("adds a second of game time on every screen", async () => {
  await openTable(h);

  const risen: Record<string, number> = {};
  for (const screen of SCREENS) {
    await h.debug.setScreen(screen);
    const before = (await h.snapshot()).simTime;
    await h.advance(framesFor(SPAN_SECONDS));
    risen[screen] = (await h.snapshot()).simTime - before;
  }

  // Before the assertions, so a failing screen still leaves the picture of the
  // board the last second was spent on.
  await captureStill(h, "advanced");

  for (const screen of SCREENS) {
    assertCloseTo(
      risen[screen],
      SPAN_SECONDS,
      SIM_DIGITS,
      `the rise in snapshot().simTime over ${SPAN_SECONDS} s of game time ` +
        `spent on the ${JSON.stringify(screen)} screen`,
    );
  }
});
