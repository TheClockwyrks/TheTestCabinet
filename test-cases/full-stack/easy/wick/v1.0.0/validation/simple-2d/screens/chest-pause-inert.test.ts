// screens/chest-pause-inert — pause does nothing on the chest overlay.
//
// WHAT THIS DECIDES. One thing: a `pause` press on `chest` leaves the overlay
// open with its result still reported, so the night cannot be paused out from
// under what a chest gave.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`chest`): "`up`, `down`, `back`, and `pause` do nothing here."
//   specs/controls.md ("What each screen reads"): "`chest` | none | `confirm`
//   closes the overlay; `mute`", and "An action a row omits does nothing on
//   that screen."
//   specs/ui.md ("Menu navigation"): "`pause` is read on `playing` and `paused`
//   alone".
//   specs/progression.md ("The chest overlay"): "`confirm` closes it, setting
//   `chestResult` to `null` and `screen` to `playing`", which is the only way
//   the result is cleared.
//   specs/controls.md ("Actions and bindings"): `pause` is `KeyP`.
//
// THE DRIVE. An isolated `playing` run, a chest at the lamplighter's center
// collected by one tick, then one real `KeyP` press over one frame. The
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

it("leaves the chest overlay open with its result after KeyP", async () => {
  isolate(h);
  const opened = await openChest(h);
  assertEqual(opened.screen, "chest", "the screen KeyP is pressed on");
  assertNotNull(opened.run.chestResult, "the result before KeyP");

  const after = await tap(h, "KeyP");
  captureStill(h, "inert");

  assertEqual(after.screen, "chest", "the screen KeyP left the game on");
  assertDeepEqual(
    after.run.chestResult,
    opened.run.chestResult,
    "the result after KeyP",
  );
});
