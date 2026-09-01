// controls/edge-once-per-press — an edge action fires once per press.
//
// WHAT THIS DECIDES. One thing: a key held across many frames is ONE press. On
// the title, `ArrowDown` held for thirty frames moves the highlight exactly once,
// on the frame the held value rose, and not again while the key stays down.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("Where input comes from"): each action is reported "as a
//   press edge, true once for the frame in which the held value went from `0`
//   to `1`".
//   specs/controls.md ("Actions and bindings"): `down` is "held on `playing`,
//   edge elsewhere".
//   specs/controls.md ("What each screen reads"): on `title`, "`up`, `down` move
//   the highlight, wrapping at both ends".
//   specs/ui.md ("`title`"): the menu is "`LIGHT THE LAMP`, `HOW TO PLAY`, in
//   that order", and "`menuIndex` is `0` on arriving".
//
// THE DRIVE. From the `title` the harness's opening `reset` left, the key goes
// down and stays down while thirty frames are stepped ONE AT A TIME, and every
// frame's `menuIndex` is kept. The menu has two items, so a second move on any
// frame is visible as that frame reading `0`: one move leaves `1`, and every
// further one flips it. Reading the end alone would not do — a build that moves
// on every frame lands on `0`, but one that moves on every other frame lands
// back on `1` — so the whole sequence is what is asserted, and it must be
// thirty ones, the first of them the frame the held value rose on.
//
// THE TOLERANCE. None: an index is an exact comparison.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";

/** How long the key stays down: half a second of frames. */
const HELD_FRAMES = 30;

/** The first key bound to `down`. */
const DOWN_KEY = BINDINGS.down[0]!;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the title highlight exactly once for ArrowDown held 30 frames", async () => {
  const title = await h.snapshot();
  assertEqual(title.screen, "title", "the screen the key is held on");
  assertEqual(title.menuIndex, 0, "the highlighted item before the hold");

  await h.hold(DOWN_KEY);
  let seen;
  try {
    seen = await h.stepWatching(HELD_FRAMES);
  } finally {
    await h.release(DOWN_KEY);
  }
  await captureStill(h, "once");

  assertEqual(
    seen[seen.length - 1]!.screen,
    "title",
    "the screen after the hold",
  );
  assertDeepEqual(
    seen.map((frame) => frame.menuIndex),
    Array.from({ length: HELD_FRAMES }, () => 1),
    "menuIndex on each of the 30 frames ArrowDown was held across",
  );
});
