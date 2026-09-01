// Wick — instrumentation/set-screen-playing-inert-on-levelup:
// `setScreen("playing")` on `levelup` leaves the state exactly as it was, the
// overlay open with its offers.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setScreen(name)`):
// the `playing | levelup` row: "Changes nothing; `choose` is the way out." The
// comparison is exact equality of the documented snapshot across the call.
//
// WHY THE WORLD IS POSED AS IT IS. The overlay is opened by the real path, a
// queued level-up and the tick that opens it, so the offers are drawn and the
// pool computed before the call that must leave them.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  posedState,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("changes nothing on levelup", async () => {
  await isolate(h);
  const overlay = await openLevelUp(h);
  assertEqual(overlay.screen, "levelup", "the screen the call is made from");

  await h.debug.setScreen("playing");
  const after = await h.snapshot();
  await captureStill(h, "inert");

  assertEqual(after.screen, "levelup", "the screen after setScreen('playing') on levelup");
  assertDeepEqual(
    posedState(after),
    posedState(overlay),
    "the snapshot across the call",
  );
});
