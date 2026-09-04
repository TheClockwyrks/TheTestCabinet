// screens/start-pointer — a pointer press on the title starts a run on level 1.
//
// WHAT THIS DECIDES. One thing: a primary pointer press made on the title screen
// moves the game to `playing` with level 1 under way. The keyboard's own confirm
// is the same transition on a different device and is its own point
// (screens/start-enter), because a build reachable by keyboard alone has to be
// told apart from one reachable by both.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("Confirming with the pointer"): "`title`, `gameover`, and
//   `victory` read a primary pointer press anywhere on the field as confirm, on
//   the press edge and once per press, exactly as the keyboard raises it", and
//   "The whole field is the region, so no part of it answers differently from
//   any other".
//   specs/controls.md ("What each screen reads"): "`title` | confirm starts a
//   run, from the keyboard or a primary pointer press".
//   specs/progression.md ("Levels"): "A run plays five levels over the same
//   channel and starts at level 1."
//
// WHERE THE PRESS LANDS. The field's own center, which specs/overview.md ("The
// field") fixes at `960 x 540`. The spec makes the whole field the region, so
// the center is a point every conformant build answers, and no layout the build
// chose is read to find it.
//
// THE DRIVE. The harness's opening `reset` poses the precondition the item names
// — the title screen — and that pose is read back before the press, so a build
// that never reached the title fails here rather than deciding nothing.
// `clickPointer` presses the real primary button over the field and runs the
// frame that reads it, so the whole path from the device to the opened run is
// what runs.
//
// THE TOLERANCE. None. The screen and the level are both exact comparisons
// (test-case.toml, STANDING TOLERANCES — "count, score, charge id, screen |
// exact").

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { FIELD_H, FIELD_W } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";

/** The field's own center, which every conformant build answers on the title. */
const CENTER = { x: FIELD_W / 2, y: FIELD_H / 2 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens level 1 in play when the pointer is pressed on the title", async () => {
  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen the press is made from",
  );

  const opened = await h.clickPointer(CENTER.x, CENTER.y);
  captureStill(h, "playing");

  assertEqual(
    opened.screen,
    "playing",
    "the screen the press left the game on",
  );
  assertEqual(opened.level, 1, "the level a fresh run opens");
});
