// Wick — instrumentation/set-tick-off-a-run-screen-inert: setTick(100) issued
// on `title` leaves the state exactly as it was.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "The
// operations"): "A call on a screen the operation does not apply to leaves the
// state exactly as it was, and each operation names the screens it applies to.
// 'A run screen' below means `playing` or `paused`." `setTick(tick)` applies
// "on a run screen", and neither `title` nor `levelup` is one. Every other
// operation the rule covers is a point of its own.
//
// WHY THE WORLD IS POSED AS IT IS. The title is the screen a reset leaves and
// one no run-screen operation applies on.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves the state as it was", async () => {
  h.reset();
  const before = h.snapshot();
  assertEqual(before.screen, "title", "the screen the call is made on");

  try {
    h.debug.setTick(100);
  } catch {
    // A refusal leaves the state as it was too; what is read is the state.
  }
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "inert");

  assertDeepEqual(after, before, "the snapshot across setTick(100) on title");
});
