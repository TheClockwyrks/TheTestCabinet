// controls/repeat-arms-no-edge — a repeat key event arms no edge.
//
// WHAT THIS DECIDES. One thing: a `keydown` carrying the `repeat` flag, the
// auto-repeat a held key produces, arms no second press edge, so the title
// highlight a held `ArrowDown` moved once stays where the first edge put it.
// That the first edge moves the highlight is the precondition.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("Where input comes from"): "The Structured 2D engine
//   delivers the input, and its documentation defines the API", and the
//   actions are read as "a press edge with `pressed`, once per frame".
//   The engine's `engine/input.md`: "An edge is armed whenever a change
//   takes the resolved value from `0` to non-zero, whatever the source.
//   Pressing a second key bound to an already-held action is not a new
//   press, and a key event whose `repeat` flag is set arms nothing."
//   specs/controls.md ("What each screen reads"): on `title`, "`up`, `down`
//   move the highlight, wrapping at both ends".
//
// THE DRIVE. `reset` puts the game on the title with `menuIndex` `0`.
// `ArrowDown` is pressed and delivered by one frame, read back as `1`, and
// left down; then a `keydown` for the same code with `repeat` set is
// dispatched and delivered by one frame, exactly the event a browser sends
// while a key is held. The title menu has two entries and wraps, so a build
// that took the repeat for a press reads `0` here. The title ticks nothing,
// so the frames are input frames alone.
//
// WHAT THIS POINT CAN AND CANNOT SEPARATE UNDER THIS ENGINE. The repeat rule
// is the ENGINE's: `InputSystem.onKeyDown` drops a keydown carrying `repeat`
// before the held set is touched, and even without that guard the code is
// already in the set, so nothing moves from `0`. A build reaches input through
// `input.value` and `input.pressed` alone — the public `Engine` exposes no
// surface to listen on — so the raw event never passes through the build's own
// hands. A build that reads `value` where `pressed` belongs fails this point,
// and fails controls/edge-once-per-press in the same run; no build-side defect
// fails this point alone. The point is therefore a smoke check over the
// engine's own filtering here, and carries the build-side discrimination its
// name promises under the engineless configuration, where the build owns the
// listener.
//
// THE TOLERANCE. None: a menu index is a whole number compared exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  repeatKey,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves the title highlight where it is when a repeat keydown arrives", async () => {
  h.reset();
  assertEqual(h.snapshot().screen, "title", "the screen the key is held on");

  h.holdKey("ArrowDown");
  try {
    await h.advance(1);
    assertEqual(h.snapshot().menuIndex, 1, "menuIndex after the real press");

    const after = await repeatKey(h, "ArrowDown");
    captureStill(h, "repeat");

    assertEqual(after.menuIndex, 1, "menuIndex after the repeat keydown");
  } finally {
    h.releaseKey("ArrowDown");
  }
});
