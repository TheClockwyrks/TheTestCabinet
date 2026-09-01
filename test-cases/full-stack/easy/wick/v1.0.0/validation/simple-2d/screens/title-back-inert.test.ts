// screens/title-back-inert — back does nothing on the title screen.
//
// WHAT THIS DECIDES. One thing: a `back` press on `title` leaves the screen and
// the highlight exactly as they were. The title is the front door, so there is
// nowhere behind it to go.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`title`): "`confirm` takes the highlighted item, and `back`
//   does nothing."
//   specs/controls.md ("What each screen reads"): the `title` row lists `up`,
//   `down`, `confirm`, and `mute` and omits `back`, and "An action a row omits
//   does nothing on that screen."
//   specs/controls.md ("Actions and bindings"): `back` is `Escape`.
//
// THE DRIVE. A reset to the title and one real `Escape` press over one frame.
// The reading is taken at `menuIndex` 0, where a build that moved the highlight
// on `back` shows a different index and a build that left the screen shows a
// different screen, so both ways of doing something are caught.
//
// THE TOLERANCE. None: a screen name and a menu index are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, tap, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves the title screen and its highlight untouched by Escape", async () => {
  h.reset();
  const before = h.snapshot();
  assertEqual(before.screen, "title", "the screen Escape is pressed on");
  assertEqual(before.menuIndex, 0, "the highlight before Escape");

  const after = await tap(h, "Escape");
  captureStill(h, "inert");

  assertEqual(after.screen, "title", "the screen Escape left the game on");
  assertEqual(after.menuIndex, 0, "the highlight after Escape");
});
