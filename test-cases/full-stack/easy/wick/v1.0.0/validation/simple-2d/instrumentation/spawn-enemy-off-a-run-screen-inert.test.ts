// Wick — instrumentation/spawn-enemy-off-a-run-screen-inert:
// spawnEnemy('moth', 0, 0) issued on `title` leaves the state exactly as it
// was.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "The
// operations"): "A call on a screen the operation does not apply to leaves the
// state exactly as it was, and each operation names the screens it applies to.
// 'A run screen' below means `playing` or `paused`." `spawnEnemy(type, x, y)`
// applies "on `playing` and `paused`", and neither `title` nor `levelup` is
// one. Every other operation the rule covers is a point of its own.
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
  h?.dispose();
});

it("leaves the state as it was", async () => {
  h.reset();
  const before = h.snapshot();
  assertEqual(before.screen, "title", "the screen the call is made on");

  try {
    h.debug.spawnEnemy("moth", 0, 0);
  } catch {
    // A refusal leaves the state as it was too; what is read is the state.
  }
  const after = h.snapshot();
  await h.tick(1);
  captureStill(h, "inert");

  assertDeepEqual(
    after,
    before,
    "the snapshot across spawnEnemy('moth', 0, 0) on title",
  );
});
