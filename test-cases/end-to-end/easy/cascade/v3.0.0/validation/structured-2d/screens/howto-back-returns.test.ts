// screens/howto-back-returns — the how-to screen's BACK returns to the title.
//
// specs/screens.md: the how-to screen "carries one control, labelled
// `HOWTO_BACK_LABEL` (`BACK`) and drawn inside the `HOWTO_BACK` rectangle. It
// returns to `title`." specs/controls.md fixes that rectangle at `{ x: 480,
// y: 600, w: 320, h: 52 }` and states that a click activates the control whose
// hit rectangle contains its press point. Without it a player who opened the
// instructions can never start a game.
//
// THE SCREEN IS POSED WITH `setScreen`, not reached through the title's menu, so
// what this decides is the return alone: whether HOW TO PLAY opens the screen is
// `screens/title-how-to-opens`'s requirement, and a build that cannot open the
// how-to screen and one that cannot leave it grade differently.
//
// The gesture is a real click at the rectangle's centre — a press and a release
// at the same point, inside `DRAG_THRESHOLD` (specs/controls.md) — through the
// surface's pointer operations, which feed the same input path a player's pointer
// feeds (specs/instrumentation.md).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOWTO_BACK_ITEM } from "../constants";
import {
  captureStill,
  clickAt,
  createHarness,
  menuPoint,
  resetTo,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title when BACK is clicked on the how-to screen", async () => {
  resetTo(h);
  h.debug.setScreen("howto");
  assertEqual(
    h.snapshot().screen,
    "howto",
    "posing: setScreen puts the how-to screen up, which is the screen this " +
      "control belongs to (specs/instrumentation.md)",
  );

  // The middle of the region the build reports for the how-to screen's BACK item.
  clickAt(h, menuPoint(h, HOWTO_BACK_ITEM).x, menuPoint(h, HOWTO_BACK_ITEM).y);
  await h.advance(1);
  captureStill(h, "title");

  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen a click inside the region the build reports for it reaches (specs/screens.md)",
  );
});
