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
//   move the highlight, wrapping"; specs/ui.md (`title`): the three items of
//   `TITLE_ITEMS`.
//
// THE DRIVE. The title, reached through `reset`, with the highlight read back
// at `0`. A real `ArrowDown` goes down and one frame delivers its edge, which
// is the precondition the item names ("while `ArrowDown` is already held")
// and is read back as `1` before the event under test. Then a second
// `keydown` for the same code with `repeat: true` is dispatched, one more
// frame runs, and the key is released. A build that treated the repeat as a
// fresh press moves the highlight on to the next item, so reading `1` after the
// repeat frame is the whole verdict.
//
// WHAT THIS POINT CAN AND CANNOT SEPARATE UNDER THIS ENGINE. The repeat rule
// is the ENGINE's: `InputRegistry` drops a keydown whose `repeat` flag is set
// before any value moves, and a build reaches input only through
// `InitApi.input.register`/`layout` and `UpdateApi.input.value`/`pressed`, so
// the raw event never passes through the build's own hands. A build that reads
// `value` where `pressed` belongs fails this point, and fails
// controls/edge-once-per-press in the same run; no build-side defect fails this
// point alone. The point is therefore a smoke check over the engine's own
// filtering here, and carries the build-side discrimination its name promises
// under the engineless configuration, where the build owns the listener.
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
