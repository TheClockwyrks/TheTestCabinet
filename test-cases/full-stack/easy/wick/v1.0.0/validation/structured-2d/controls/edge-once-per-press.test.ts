// controls/edge-once-per-press — an edge action fires once per press.
//
// WHAT THIS DECIDES. One thing: a key held across many frames moves a menu
// highlight exactly once, on the frame its held value rose, and never again
// while it stays down. That the first frame moves it at all is the screens'
// business and the precondition here.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("Where input comes from"): the actions are read by
//   the player controller as "a held value with `value` and a press edge with
//   `pressed`, once per frame", and "The Structured 2D engine delivers the
//   input, and its documentation defines the API."
//   The engine's `engine/input.md`: "`pressed(name)` ... `true` exactly once
//   per armed edge per player controller", "An edge is armed whenever a
//   change takes the resolved value from `0` to non-zero", and "A press is
//   therefore news for exactly one frame."
//   specs/controls.md ("What each screen reads"): on `title`, "`up`, `down`
//   move the highlight, wrapping at both ends", and the table reads `down`
//   there as "edge elsewhere".
//
// THE DRIVE. `reset` puts the game on the title with `menuIndex` `0`, so a
// single `down` puts it on `1`. `ArrowDown` is pressed once and left DOWN for
// 30 frames, with `menuIndex` sampled after every one of them: the title
// menu has two entries and wraps, so a second move at any frame reads `0` at
// that sample, and the sampling catches an extra move however many frames
// apart the extra moves come. A single reading after 30 frames could not,
// since an even number of moves lands back on `1`. The title ticks nothing,
// so the frames are input frames alone.
//
// THE TOLERANCE. None: a menu index is a whole number compared exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

/** The frames the key stays down for: half a second of auto-repeat's worth. */
const HELD_FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("moves the title highlight once for one held ArrowDown across 30 frames", async () => {
  h.reset();
  const title = h.snapshot();
  assertEqual(title.screen, "title", "the screen the key is held on");
  assertEqual(title.menuIndex, 0, "the highlighted entry before the press");

  h.holdKey("ArrowDown");
  try {
    await h.advance(1);
    assertEqual(
      h.snapshot().menuIndex,
      1,
      "menuIndex on the frame the value rose",
    );
    for (let frame = 2; frame <= HELD_FRAMES; frame += 1) {
      await h.advance(1);
      assertEqual(
        h.snapshot().menuIndex,
        1,
        `menuIndex on frame ${frame} of the hold`,
      );
    }
  } finally {
    captureStill(h, "once");
    h.releaseKey("ArrowDown");
  }
});
