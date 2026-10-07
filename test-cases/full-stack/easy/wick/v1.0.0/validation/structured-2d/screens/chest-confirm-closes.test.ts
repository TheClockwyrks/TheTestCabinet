// Wick — screens/chest-confirm-closes: `confirm` closes the chest overlay and
// the simulation runs again.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`chest`":
// "`confirm` closes the overlay, sounding no cue: `screen = playing`, and the
// simulation resumes on the next tick." `specs/progression.md`, "The chest
// overlay", says the same: "`confirm` closes it, setting `chestResult` to
// `null` and `screen` to `playing`." `specs/controls.md` binds `confirm` to
// `Enter` and `Space` and gives the `chest` row "`confirm` closes the
// overlay".
//
// WHY THE CLOCK MOVES ON THE PRESS'S OWN FRAME. `specs/controls.md`: "The
// frame's update then runs on the screen the edges left: a frame whose press
// enters `playing`, from the title, an end screen, `paused`, or an overlay,
// runs that frame's ticks". So the closing frame, worth exactly one tick under
// this harness's clock, is itself the tick the simulation resumes on, and one
// more frame after it is one more tick. A build that closed the overlay and
// left the simulation stopped fails on the second reading, and one that kept
// ticking beneath the overlay fails on the first.
//
// THE DRIVE. An isolated `playing` run holding nothing, every driver switch
// off, so no autonomous system can move the clock; a chest posed at the
// lamplighter's own centre and the one tick that collects it; then one real
// `Enter`, and one more frame.
//
// THE TOLERANCE. None: a screen name, `null`, and whole tick counts.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  openChest,
  tap,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("returns to playing with no result, ticking from the closing frame on", async () => {
  isolate(h);
  const overlay = await openChest(h);
  assertEqual(overlay.screen, "chest", "the screen the press is made on");
  assertNotNull(overlay.run.chestResult, "the result the overlay opened with");
  const held = overlay.run.tick;

  const closed = await tap(h, "Enter");
  captureStill(h, "closed");

  assertEqual(
    closed.screen,
    "playing",
    "the screen after Enter on the chest overlay",
  );
  assertNull(closed.run.chestResult, "chestResult after the overlay closed");
  assertEqual(
    closed.run.tick,
    held + 1,
    "the run clock after the closing frame's tick",
  );

  const next = await advanceTicks(h, 1);
  assertEqual(next.run.tick, held + 2, "the run clock after one more tick");
});
