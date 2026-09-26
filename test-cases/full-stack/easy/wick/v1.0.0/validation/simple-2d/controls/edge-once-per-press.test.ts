// controls/edge-once-per-press — an edge action fires once per press.
//
// WHAT THIS DECIDES. One thing: a menu action is read as a press EDGE, so a
// key held across many frames moves the highlight exactly once. That a single
// tap moves it at all is screens/title-down-moves-highlight; this point is
// what a HELD key does on a menu.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("Actions and bindings"): "`down` | `ArrowDown`, `KeyS` |
//   held on `playing`, edge elsewhere", and ("Where input comes from")
//   "`update` reads a held value with `value` and a press edge with `pressed`,
//   once per frame."
//   The engine's input documentation, which specs/controls.md defers to: an
//   edge is "`true` exactly once per armed edge", "An edge is armed whenever a
//   change takes the resolved value from `0` to non-zero", and "A press is
//   therefore news for exactly one frame".
//   specs/ui.md (`title`): "`up` and `down` move the highlight by one item and
//   wrap at both ends", over the three items of `TITLE_ITEMS`, so one edge from
//   `0` reads `1` and every further edge would move it again.
//
// THE DRIVE. The title, reached through `reset`, with the highlight read back
// at `0` first. `ArrowDown` is dispatched once and left down while 30 frames
// run, the span the item names, and released after them. The highlight is read
// after EVERY one of those frames rather than after the last, so the verdict
// does not rest on where a repeating build happened to land: a build that
// re-read the held value every frame, or fired on a timer of its own, moves
// the highlight on some frame of the hold and that frame reads something other
// than `1`. One edge and one alone leaves the whole run of readings at `1`.
//
// THE TOLERANCE. None: a menu index is a whole number, compared exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

/** Frames the key is held across: the span the item names. */
const HELD_FRAMES = 30;

/** The highlight the one edge leaves, over the items of `TITLE_ITEMS`. */
const MOVED_INDEX = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("moves the title highlight once while ArrowDown is held for 30 frames", async () => {
  h.reset();
  const title = h.snapshot();
  assertEqual(title.screen, "title", "the screen the key is held on");
  assertEqual(title.menuIndex, 0, "the highlight before the press");

  h.holdKey("ArrowDown");
  let seen;
  try {
    seen = await h.trace(HELD_FRAMES);
  } finally {
    h.releaseKey("ArrowDown");
  }
  captureStill(h, "once");

  assertEqual(
    seen[seen.length - 1]!.screen,
    "title",
    "the screen the held key left the game on",
  );
  assertDeepEqual(
    seen.map((frame) => frame.menuIndex),
    Array.from({ length: HELD_FRAMES }, () => MOVED_INDEX),
    `the highlight on each of the ${HELD_FRAMES} frames ArrowDown was held across`,
  );
});
