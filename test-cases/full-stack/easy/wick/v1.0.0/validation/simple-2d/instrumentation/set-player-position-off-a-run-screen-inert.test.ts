// Wick — instrumentation/set-player-position-off-a-run-screen-inert:
// setPlayerPosition(5, 5) issued on `levelup` leaves the state exactly as it
// was.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "The
// operations"): "A call on a screen the operation does not apply to leaves the
// state exactly as it was, and each operation names the screens it applies to.
// 'A run screen' below means `playing` or `paused`." `setPlayerPosition(x, y)`
// applies "on a run screen", and neither `title` nor `levelup` is one. Every
// other operation the rule covers is a point of its own.
//
// WHY THE WORLD IS POSED AS IT IS. The level-up overlay is reached by the real
// path, so the call is made over an open overlay whose run a build might reach
// through anyway.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the state as it was", async () => {
  isolate(h);
  const before = await openLevelUp(h, 1);
  assertEqual(before.screen, "levelup", "the screen the call is made on");

  try {
    h.debug.setPlayerPosition(5, 5);
  } catch {
    // A refusal leaves the state as it was too; what is read is the state.
  }
  const after = h.snapshot();
  await h.tick(1);
  captureStill(h, "inert");

  assertDeepEqual(
    after,
    before,
    "the snapshot across setPlayerPosition(5, 5) on levelup",
  );
});
