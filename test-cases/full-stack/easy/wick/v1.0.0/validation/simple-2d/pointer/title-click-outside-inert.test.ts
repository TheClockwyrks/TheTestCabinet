// pointer/title-click-outside-inert — a click inside no rectangle takes no item.
//
// WHAT THIS DECIDES. One thing: on `title` with `menuIndex` `0`, a primary
// press at a stage point inside none of the screen's rectangles leaves the game
// on `title` with `menuIndex` `0`. The other half of the click rule, that a
// press inside a rectangle takes that item, is its own point.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md (The pointer), rule 2: "A primary press edge inside no
//   rectangle does nothing."
//   specs/ui.md (`title`): "`menuIndex` is `0` on arriving", and the three
//   items of `TITLE_ITEMS` are the only things a confirmation takes.
//   specs/instrumentation.md (Menus): `menuRects` reports "the rectangles of
//   the current screen's vertical menu", `tabRects` "an empty list" on every
//   screen but `almanac`.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. The screen and the highlight
// after the click. A build that treated any press as a confirmation of the
// highlighted item would be on `playing` here; one that answered the whole
// stage would have moved the highlight.
//
// WHERE THE POINT COMES FROM. Derived, never named: `outsidePoint` walks the
// whole stage and keeps the candidate furthest from every rectangle the build
// reported, so the press lands somewhere this build itself says holds no item.
// The specification fixes no coordinate for any menu, so a stage point written
// into this file would be a fact about one build's layout.
//
// THE DRIVE. The title through `setScreen`, "exactly as the real transition
// into it enters it" (specs/instrumentation.md); then a primary press at the
// derived point and the one frame that reads it, the rules being "applied on
// every frame, after that frame's press edges and before its update"
// (specs/controls.md).
//
// THE TOLERANCE. The margin the derived point keeps from every rectangle,
// `OUTSIDE_MARGIN` (8 stage units), slack in the build's favour so a hit test
// with inclusive edges is judged on the rule rather than on a rounding.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { IDLE_RUN } from "../constants";
import {
  captureStill,
  createHarness,
  poseScene,
  runFields,
  type Harness,
} from "../harness";
import { clickAtWithoutTick, outsidePoint } from "./pointing";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves the title and its highlight untouched by a click inside no rectangle", async () => {
  const before = poseScene(h, "title");
  assertEqual(before.screen, "title", "the screen the click lands on");
  assertEqual(before.menuIndex, 0, "the highlight before the click");

  const at = outsidePoint(h);
  const after = await clickAtWithoutTick(h, at.x, at.y);
  captureStill(h, "outside");

  assertEqual(
    after.screen,
    "title",
    "the screen the click left the game on, which specs/controls.md says a press inside no rectangle changes nothing about",
  );
  assertEqual(after.menuIndex, 0, "the highlight after the click");
  assertDeepEqual(
    runFields(after.run),
    IDLE_RUN,
    "the run the title still holds, as specs/state.md's idle table fixes it",
  );
});
