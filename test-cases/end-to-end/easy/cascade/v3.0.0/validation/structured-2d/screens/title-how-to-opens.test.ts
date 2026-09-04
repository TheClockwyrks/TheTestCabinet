// screens/title-how-to-opens — the title's HOW TO PLAY opens the how-to screen.
//
// specs/screens.md: "`HOW TO PLAY` — Moves to `howto`." specs/controls.md fixes
// the rectangle it answers, `TITLE_HOW_TO` at `{ x: 480, y: 516, w: 320, h: 52 }`,
// and states that a click "activates the control whose hit rectangle contains the
// press point". It is the only way a player reaches the instructions.
//
// ONE DIRECTION. This point decides the way IN; `screens/howto-back-returns`
// decides the way back out, and a build that opens the how-to screen and cannot
// leave it grades apart from one that never opens it.
//
// The gesture is a real click at the rectangle's centre — a press and a release
// at the same point, inside `DRAG_THRESHOLD` (specs/controls.md) — through the
// surface's pointer operations, which feed the same input path a player's pointer
// feeds (specs/instrumentation.md). The screen it lands on is read off the
// snapshot; what that screen SHOWS is `screens/howto-copy`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_HOW_TO_ITEM } from "../constants";
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

it("reaches the how-to screen when HOW TO PLAY is clicked on the title", async () => {
  resetTo(h);
  assertEqual(
    h.snapshot().screen,
    "title",
    "posing: reset restores the title screen, which is the screen this " +
      "control belongs to (specs/controls.md)",
  );

  // The middle of the region the build reports for the title's HOW TO PLAY item.
  clickAt(
    h,
    menuPoint(h, TITLE_HOW_TO_ITEM).x,
    menuPoint(h, TITLE_HOW_TO_ITEM).y,
  );
  await h.advance(1);
  captureStill(h, "howto");

  assertEqual(
    h.snapshot().screen,
    "howto",
    "the screen a click inside the region the build reports for it reaches (specs/screens.md)",
  );
});
