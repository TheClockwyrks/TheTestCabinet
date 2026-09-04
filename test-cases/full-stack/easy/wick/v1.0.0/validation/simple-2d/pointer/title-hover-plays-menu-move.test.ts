// pointer/title-hover-plays-menu-move — the frame a hover moves the highlight
// on plays `menu-move` once.
//
// WHAT THIS DECIDES. One thing: the frame on which the pointer enters the
// second title item's rectangle from `menuIndex` `0` raises exactly one
// `menu-move`. That the highlight moves at all is its own point; what is read
// here is the cue that move sounds.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md (The pointer), rule 1: "The pointer inside the rectangle
//   of the item at `menuIndex` `i`, with `menuIndex` not `i`, sets `menuIndex`
//   to `i` and plays `menu-move`."
//   specs/ui.md (Audio): "`menu-move` | `CUES.menuMove` | A menu highlight
//   moves", and "Each is played on the tick its event happens, or on the frame
//   for a menu event, and at most once on that tick".
//   specs/ui.md (`title`): the menu is `TITLE_ITEMS`, and "`menuIndex` is `0`
//   on arriving".
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. Every cue the build played across
// the one frame the pointer moved on, taken off the engine's cue bus, filtered
// to `menu-move` and counted. One play is the whole claim: none says a build
// moves its highlight silently, two says it sounded the move twice on one
// frame.
//
// THE DRIVE. The title through `setScreen`, "exactly as the real transition
// into it enters it" (specs/instrumentation.md); the recording opened AFTER the
// pose, since "A cue is played by a tick or a frame, never by a pose of the
// debug surface" (specs/ui.md); then the pointer to the middle of the rectangle
// the build reported for position `1`, and the one frame that reads it.
//
// THE TOLERANCE. None: a count of cue plays is a whole number.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureReplay,
  createHarness,
  cuesNamed,
  hoverRect,
  onCue,
  poseScene,
  type Harness,
} from "../harness";
import { menuRectAt } from "./pointing";

let h: Harness;

/** The item the pointer enters: `THE ALMANAC`, position 1 of `TITLE_ITEMS`. */
const HOVERED = TITLE_ITEMS.indexOf("THE ALMANAC");

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays menu-move once on the frame the pointer moves the title highlight", async () => {
  const before = poseScene(h, "title");
  assertEqual(before.screen, "title", "the screen the pointer rests on");
  assertEqual(before.menuIndex, 0, "the highlight before the pointer moves");

  const rect = menuRectAt(h, HOVERED, "the second title item");
  const played = onCue(h);

  const after = await captureReplay(h, "move", () => hoverRect(h, rect));

  assertEqual(
    after.menuIndex,
    HOVERED,
    "the highlight the hover moved, which is what the cue reports",
  );
  assertLength(
    cuesNamed(played, "menu-move"),
    1,
    "menu-move plays on the frame the hover moved the highlight",
  );
});
