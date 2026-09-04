// pointer/title-hover-highlights — the pointer resting on the second title item
// moves the highlight to it.
//
// WHAT THIS DECIDES. One thing: on `title` with `menuIndex` `0`, a frame that
// finds the pointer inside the rectangle of the item at position `1` leaves
// `menuIndex` at `1`. That the cue sounds with it is its own point, and what
// the rectangles ARE is decided under Instrumentation.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md (The pointer): "Every screen that shows a vertical menu
//   answers the pointer: `title`, `almanac`, `levelup`, `paused`, `fallen`, and
//   `dawn`. Each item the menu currently shows occupies a rectangle on the
//   stage", and "On `title`, `levelup`, `paused`, `fallen`, and `dawn` that is
//   every item of the menu, and the rectangle at position `i` belongs to the
//   item at `menuIndex` `i`." Rule 1: "The pointer inside the rectangle of the
//   item at `menuIndex` `i`, with `menuIndex` not `i`, sets `menuIndex` to `i`
//   and plays `menu-move`."
//   specs/ui.md (`title`): the menu is `TITLE_ITEMS`, "`LIGHT THE LAMP`,
//   `THE ALMANAC`, `HOW TO PLAY`, in that order", and "`menuIndex` is `0` on
//   arriving".
//   specs/instrumentation.md (Menus): `menuRects` "Reports the rectangles of
//   the current screen's vertical menu, in menu order ... Each rectangle is the
//   area a hover or a click selects that item inside."
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. `menuIndex` off the snapshot,
// after one frame with the pointer at rest inside the rectangle the build
// itself reported for position `1`. The specification fixes no coordinate for
// any menu, so the aim comes from the build's own reading rather than from a
// stage point this check chose; what is asserted is the RELATION the spec
// fixes, that position `1`'s rectangle belongs to `menuIndex` `1`.
//
// THE DRIVE. The title is entered through `setScreen`, "exactly as the real
// transition into it enters it" (specs/instrumentation.md), so a build with a
// broken menu route still reaches the screen this point is about. The pointer
// is then moved to the middle of the reported rectangle, the one point inside
// it no padding or rounding can put outside, and one frame is run: the three
// rules are "applied on every frame, after that frame's press edges and before
// its update" (specs/controls.md), so the move reaches the game through the
// frame that follows it.
//
// THE TOLERANCE. None: a menu index is a discrete figure.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  hoverRect,
  poseScene,
  type Harness,
} from "../harness";
import { menuRectAt } from "./pointing";

let h: Harness;

/** The item the pointer rests on: `THE ALMANAC`, position 1 of `TITLE_ITEMS`. */
const HOVERED = TITLE_ITEMS.indexOf("THE ALMANAC");

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("moves the title highlight to the item the pointer rests in", async () => {
  const before = poseScene(h, "title");
  assertEqual(before.screen, "title", "the screen the pointer rests on");
  assertEqual(before.menuIndex, 0, "the highlight before the pointer moves");

  const rect = menuRectAt(h, HOVERED, "the second title item");
  const after = await hoverRect(h, rect);
  captureStill(h, "hover");

  assertEqual(after.screen, "title", "the screen a hover left the game on");
  assertEqual(
    after.menuIndex,
    HOVERED,
    "the highlight after the pointer rested in position 1's rectangle, which specs/controls.md gives to menuIndex 1",
  );
});
