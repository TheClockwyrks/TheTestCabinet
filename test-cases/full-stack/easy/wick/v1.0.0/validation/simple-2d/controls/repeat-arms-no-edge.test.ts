// controls/repeat-arms-no-edge — a repeat key event arms no edge.
//
// WHAT THIS DECIDES. One thing: a `keydown` whose `repeat` flag is set, the
// event an operating system auto-repeats while a key stays down, is not a new
// press, so it moves a menu highlight no further. A held key with no repeat
// event is controls/edge-once-per-press; this point is the repeat event
// itself.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("Where input comes from"): "The Simple 2D engine
//   delivers the input, and its documentation defines the API", and `update`
//   "reads ... a press edge with `pressed`, once per frame".
//   The engine's input documentation: "An edge is armed whenever a change
//   takes the resolved value from `0` to non-zero, whatever the source.
//   Pressing a second key bound to an already-held action is not a new press,
//   and a key event whose `repeat` flag is set arms nothing." Its key
//   listeners read "`KeyboardEvent.code` and `KeyboardEvent.repeat`".
//   specs/controls.md ("What each screen reads"): on `title`, "`up`, `down`
//   move the highlight, wrapping at both ends"; specs/ui.md (`title`): the
//   two items of `TITLE_ITEMS`.
//
// THE DRIVE. The title, reached through `reset`, with the highlight read back
// at `0`. A real `ArrowDown` goes down and one frame delivers its edge, which
// is the precondition the item names ("while `ArrowDown` is already held")
// and is read back as `1` before the event under test. Then a second
// `keydown` for the same code with `repeat: true` is dispatched, one more
// frame runs, and the key is released. On the two-item menu a build that
// treated the repeat as a fresh press wraps the highlight back to `0`, so
// reading `1` after the repeat frame is the whole verdict.
//
// THE TOLERANCE. None: a menu index is a whole number, compared exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("moves the title highlight no further on a repeat keydown while ArrowDown is held", async () => {
  h.reset();
  const title = h.snapshot();
  assertEqual(title.screen, "title", "the screen the key is held on");
  assertEqual(title.menuIndex, 0, "the highlight before the press");

  h.holdKey("ArrowDown");
  try {
    const pressed = await h.tick(1);
    assertEqual(pressed.menuIndex, 1, "the highlight after the real press");

    h.holdKey("ArrowDown", { repeat: true });
    const repeated = await h.tick(1);
    captureStill(h, "repeat");

    assertEqual(
      repeated.screen,
      "title",
      "the screen the repeat event left the game on",
    );
    assertEqual(repeated.menuIndex, 1, "the highlight after the repeat event");
  } finally {
    h.releaseKey("ArrowDown");
  }
});
