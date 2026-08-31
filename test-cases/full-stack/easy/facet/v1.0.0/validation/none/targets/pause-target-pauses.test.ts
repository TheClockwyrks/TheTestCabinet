// Facet — targets/pause-target-pauses: taking the pause control pauses the
// board.
//
// specs/controls.md gives the `playing` screen one target, `pause`, and says what
// taking it does: "`pause` — The same as the `pause` action." The action's own
// row reads "Enters and leaves `paused` from `playing`", and specs/ui.md fixes
// the arrival: `paused` is "reached from `playing` with the `pause` action or the
// `pause` pointer target", with "`menuIndex` … `0` on arriving."
//
// WHY IT IS ITS OWN POINT RATHER THAN AN INSTANCE OF `release-takes-target`.
// That point is read on a menu item, and a build wires its menu targets and its
// on-screen controls at different places: one screen's targets are a menu's rows,
// this one's is a single control drawn beside a live board. A build can answer
// the menus and never reach this, and then a player with no keyboard has no way
// off the board at all — the board is the one screen with no menu to fall back
// on.
//
// AND IT IS THE POINTER'S HALF OF `keyboard/pause-key`. That point presses the
// key; this one takes the control. specs/ui.md offers both, so a build owes both.
//
// THE GESTURE IS A PRESS AND A RELEASE at the reported target's center, which
// specs/instrumentation.md guarantees is inside the rectangle the game
// hit-tests — "pressing and releasing at a listed target's center takes that
// target" — so nothing here asserts where the build drew its control. Where the
// control may NOT be is `targets/target-clear-of-board`'s point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { quietRowsWithEscape } from "../board";
import {
  captureStill,
  createHarness,
  loadBoard,
  takeTarget,
  targetById,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises the pause menu when the pause control is taken", async () => {
  // A posed board puts the game on `playing` with a settled position, which is
  // the screen the effect table says `pause` is entered FROM. The filler carries
  // a spare legal swap, so the round cannot end out from under the check.
  const opened = await loadBoard(h, quietRowsWithEscape([]));
  assertEqual(opened.screen, "playing", "the screen the control is taken on");

  const pause = targetById(opened, "pause");
  const paused = await takeTarget(h, pause);

  // The frame the pause menu is drawn on, and the picture of it.
  await h.advance(1);
  await captureStill(h, "paused");

  assertEqual(
    paused.screen,
    "paused",
    "the screen taking the pause control reached",
  );
  assertEqual(
    paused.menuIndex,
    0,
    "the highlighted item on arriving at paused",
  );
  assertEqual(
    paused.armedTarget,
    null,
    "the armed target the release disarmed as it took the control",
  );
});
