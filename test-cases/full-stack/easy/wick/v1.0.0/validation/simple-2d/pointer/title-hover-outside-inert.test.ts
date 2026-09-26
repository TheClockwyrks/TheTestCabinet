// pointer/title-hover-outside-inert — the pointer resting inside no rectangle
// moves no highlight.
//
// WHAT THIS DECIDES. One thing: on `title` with `menuIndex` `0`, a frame that
// finds the pointer at a stage point inside none of the screen's rectangles
// leaves `menuIndex` at `0`. The other half of the hover rule, that a pointer
// inside a rectangle DOES move the highlight, is its own point.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md (The pointer), rule 1: "The pointer inside the rectangle
//   of the item at `menuIndex` `i`, with `menuIndex` not `i`, sets `menuIndex`
//   to `i` and plays `menu-move`. The pointer inside no rectangle changes
//   nothing."
//   specs/ui.md (`title`): "`menuIndex` is `0` on arriving", and `up` and
//   `down` are what move the highlight otherwise.
//   specs/instrumentation.md (Menus): `menuRects` reports "the rectangles of
//   the current screen's vertical menu", `tabRects` "an empty list" on every
//   screen but `almanac`.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. `menuIndex` off the snapshot
// after a frame with the pointer at rest outside every rectangle. A build that
// answered the whole stage, or that highlighted whatever row the pointer's
// height fell level with, moves the highlight here and fails.
//
// WHERE THE POINT COMES FROM. Derived, never named. The specification fixes no
// coordinate for any menu, so a stage point written into this file would be a
// fact about one build's layout; `outsidePoint` instead walks the whole stage
// and keeps the candidate furthest from every rectangle the build reported,
// entry rectangles and tab rectangles alike, so the pointer rests somewhere
// this build itself says holds no item.
//
// THE DRIVE. The title through `setScreen`, which "sets `screen` to `name` ...
// with `menuIndex` ... `0`" (specs/instrumentation.md); then the pointer to
// the
// derived point and one frame, since the rules are "applied on every frame,
// after that frame's press edges and before its update" (specs/controls.md).
//
// THE TOLERANCE. The margin the derived point keeps from every rectangle,
// `OUTSIDE_MARGIN` (8 stage units), which is slack in the build's favour: a
// build whose hit test takes its edges inclusively is still judged on the rule
// rather than on a rounding.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  hoverAt,
  poseScene,
  type Harness,
} from "../harness";
import { outsidePoint } from "./pointing";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves the title highlight where it is under a pointer inside no rectangle", async () => {
  const before = poseScene(h, "title");
  assertEqual(before.screen, "title", "the screen the pointer rests on");
  assertEqual(before.menuIndex, 0, "the highlight before the pointer moves");

  const at = outsidePoint(h);
  const after = await hoverAt(h, at.x, at.y);
  captureStill(h, "outside");

  assertEqual(after.screen, "title", "the screen a hover left the game on");
  assertEqual(
    after.menuIndex,
    0,
    "the highlight after the pointer rested inside no rectangle, which specs/controls.md says changes nothing",
  );
});
