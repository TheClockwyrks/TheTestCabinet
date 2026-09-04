// pointer/almanac-entry-hover-highlights — the pointer resting on the third
// visible entry row moves the almanac's highlight to it.
//
// WHAT THIS DECIDES. One thing: on `almanac` with `almanacScroll` `0` and
// `menuIndex` `0`, a frame that finds the pointer inside the rectangle of the
// row at position `2` leaves `menuIndex` at `2`. The almanac's rectangles are a
// WINDOW over its list, so the relation this reads is `almanacScroll + i`, and
// what a click on a row does is its own point.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md (The pointer): "On `almanac` it is the visible entry
//   rows, at most `ALMANAC_ROWS` of them, and the rectangle at position `i`
//   belongs to the entry at `menuIndex` `almanacScroll + i`." Rule 1: "The
//   pointer inside the rectangle of the item at `menuIndex` `i`, with
//   `menuIndex` not `i`, sets `menuIndex` to `i` and plays `menu-move`."
//   specs/ui.md (`almanac`): "`menuIndex`, `almanacTab`, and `almanacScroll`
//   are `0` on arriving", and "The list shows `ALMANAC_ROWS` (`10`) entries at
//   a time, beginning at the entry at `almanacScroll`".
//   specs/instrumentation.md (Menus): "`almanac` reports one rectangle per
//   visible entry row, in list order from `almanacScroll`".
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. `menuIndex` off the snapshot
// after one frame with the pointer at rest inside the rectangle the build
// itself reported for position `2`. With `almanacScroll` at `0`, asserted
// before the hover, `almanacScroll + 2` is `2`, so the relation the spec fixes
// has one answer here.
//
// THE DRIVE. The almanac through `setScreen("almanac")`, which "Enters the
// almanac exactly as confirming `THE ALMANAC` does: the idle run, `menuIndex`
// `0`, `almanacTab` `0`, `almanacScroll` `0`" (specs/instrumentation.md), so a
// build with a broken title menu still reaches the screen this point is about.
// Then the pointer to the middle of the reported rectangle and one frame: the
// rules are "applied on every frame, after that frame's press edges and before
// its update" (specs/controls.md).
//
// THE TOLERANCE. None: a menu index is a discrete figure.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  hoverRect,
  poseScene,
  type Harness,
} from "../harness";
import { menuRectAt } from "./pointing";

let h: Harness;

/** The row the pointer rests on: position 2 of the visible window. */
const HOVERED = 2;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("moves the almanac highlight to the entry row the pointer rests in", async () => {
  const before = poseScene(h, "almanac");
  assertEqual(before.screen, "almanac", "the screen the pointer rests on");
  assertEqual(before.menuIndex, 0, "the highlight before the pointer moves");
  assertEqual(before.almanacScroll, 0, "the list's first visible row");

  const rect = menuRectAt(h, HOVERED, "the third visible entry row");
  const after = await hoverRect(h, rect);
  captureStill(h, "hover");

  assertEqual(after.screen, "almanac", "the screen a hover left the game on");
  assertEqual(
    after.menuIndex,
    HOVERED,
    "the highlight after the pointer rested in position 2's rectangle, which specs/controls.md gives to the entry at almanacScroll + 2",
  );
});
