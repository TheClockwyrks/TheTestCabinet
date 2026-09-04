// screens/chest-back-inert — back does nothing on the chest overlay.
//
// WHAT THIS DECIDES. One thing: a `back` press on `chest` leaves the overlay
// open with its result still reported, so what a chest gave cannot be escaped
// out of unseen.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`chest`): "`up`, `down`, `back`, and `pause` do nothing here."
//   specs/controls.md ("What each screen reads"): "`chest` | none | `confirm`
//   closes the overlay; `mute`", and "An action a row omits does nothing on
//   that screen."
//   specs/progression.md ("The chest overlay"): "`confirm` closes it, setting
//   `chestResult` to `null` and `screen` to `playing`", which is the only way
//   the result is cleared.
//   specs/controls.md ("Actions and bindings"): `back` is `Escape`.
//
// THE DRIVE. An isolated `playing` run, a chest at the lamplighter's center
// collected by one tick, then one real `Escape` press over one frame. The
// result is read back as well as the screen, so a build that closed the overlay
// in place, clearing the result while leaving the screen alone, fails too.
//
// THE TOLERANCE. None: a screen name and a result are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import {
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

it("leaves the chest overlay open with its result after Escape", async () => {
  isolate(h);
  const opened = await openChest(h);
  assertEqual(opened.screen, "chest", "the screen Escape is pressed on");
  assertNotNull(opened.run.chestResult, "the result before Escape");

  const after = await tap(h, "Escape");
  captureStill(h, "inert");

  assertEqual(after.screen, "chest", "the screen Escape left the game on");
  assertDeepEqual(
    after.run.chestResult,
    opened.run.chestResult,
    "the result after Escape",
  );
});
