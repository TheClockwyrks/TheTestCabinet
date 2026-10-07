// lamplighter/facing-holds-when-still — facing holds while standing still.
//
// WHAT THIS DECIDES. That a tick with no movement leaves `facing` as it was:
// posed `"left"`, it stays `"left"` across 60 ticks with no key held.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Facing"): "A tick with no
// horizontal component, whether the lamplighter is still or moving straight
// up or down, leaves `facing` as it was." `"left"` is the value a fresh run
// does NOT start with (a run "starts as `"right"`"), so a build that
// recomputed facing from nothing each tick and fell back to right is caught.
//
// WHY THE WORLD IS POSED AS IT IS. `isolate` gives a fresh `playing` screen
// holding nothing, every driver switch off, so nothing moves the lamplighter
// and nothing else changes across the span. `facing` is posed `"left"`
// through `setFacing`, no key is dispatched, and `facing` is read after every
// one of the 60 ticks, so a flip at any tick is caught rather than one at
// the end. The last frame is kept as the still.
//
// THE TOLERANCE. None: `facing` is one of two strings, compared exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

/** A second at rest. */
const STILL_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps facing left across 60 ticks with no movement key held", async () => {
  isolate(h);
  h.debug.setFacing("left");
  assertEqual(h.snapshot().run.player.facing, "left", "facing as posed");

  try {
    for (let tick = 1; tick <= STILL_TICKS; tick += 1) {
      const s = await advanceTicks(h, 1);
      assertEqual(
        s.run.player.facing,
        "left",
        `facing after tick ${tick} at rest`,
      );
    }
  } finally {
    captureStill(h, "still");
  }
});
