// instrumentation/reset-zeroes-sim-time — a reset leaves `simTime` at 0, the
// value a fresh game holds.
//
// `specs/instrumentation.md` § The run and the screens ends its list of the
// fields a reset restores with "no check result showing, an idle run, and
// `simTime` at `0`". `specs/state.md` says what the field is: "`simTime`,
// accumulating every update's delta time in seconds, whatever the screen".
//
// THAT LAST CLAUSE IS WHY THE SCENARIO NEEDS NOTHING BUT THE CLOCK. `simTime`
// climbs on every frame on every screen, so three hundred frames on the title
// screen — five seconds of it at `TICK_HZ` — put a number in the field without
// opening a site, standing a crane up, or starting a run, none of which this
// requirement concerns. The value is read before the reset so the check is known
// to be deciding something rather than reading a zero that was always zero.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { createHarness, type Harness } from "../harness";

/** Five seconds of frames: enough that any accumulation shows. */
const FRAMES = 300;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns simTime to 0", async () => {
  await h.advance(FRAMES);
  assertGreaterThan(
    (await h.snapshot()).simTime,
    0,
    `the simTime ${FRAMES} frames accumulated, before the reset`,
  );

  await h.debug.reset();
  const simTime = (await h.snapshot()).simTime;
  await h.capture("clock", "The accumulated simulation time after a reset");

  assertEqual(simTime, 0, "simTime after a reset (specs/instrumentation.md)");
});
